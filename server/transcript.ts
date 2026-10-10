import { randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import path from "node:path";
import type { MailMessage } from "../shared/mail.ts";
import { Parser, usageOf, type ContextReading, type SaveImage } from "../shared/claude-log.ts";
import { mergeMail } from "../shared/transcript-mail.ts";
import type { Item, Transcript } from "../shared/transcript.ts";
import type { MailReader, Participant } from "./mail.ts";
import { claudeToolCall } from "./tool-detail.ts";

export interface Cursor {
  epoch: string;
  rev: number;
}

export type TranscriptResult = ({ ok: true } & Transcript & Cursor) | { ok: false; code: "nodb" | "failed" | "nolog"; error: string };

interface RunLog {
  file: string;
  ino: number;
  offset: number;
  rest: Buffer;
  parser: Parser;
}

interface Logs {
  epoch: string;
  runs: RunLog[];
  shown: string[];
  revs: number[];
}

const NEWLINE = 0x0a;

export function logsDirOf(dbFile: string, id: string): string {
  return path.join(path.dirname(dbFile), "logs", id);
}

export function runLogs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => path.join(dir, f));
}

export function page(items: Item[], before: number | undefined, limit: number): Item[] {
  const end = before === undefined ? items.length : Math.max(0, Math.min(before, items.length));
  return items.slice(Math.max(0, end - limit), end);
}

export class TranscriptReader {
  private logs = new Map<string, Logs>();
  private rev = 0;
  private stamps = new WeakMap<Item, number>();
  private readonly mail: MailReader;
  private readonly saveImage: SaveImage | undefined;

  constructor(mail: MailReader, saveImage?: SaveImage) {
    this.mail = mail;
    this.saveImage = saveImage;
  }

  private feed(run: RunLog, text: string, rev: number): void {
    for (const line of text.split("\n")) run.parser.line(line);
    run.parser.stamp();
    for (const i of run.parser.changed) {
      this.stamps.set(run.parser.items[i], rev);
    }
    run.parser.changed.clear();
  }

  private grow(run: RunLog, size: number, rev: number): void {
    if (size > run.offset) {
      const chunk = Buffer.allocUnsafe(size - run.offset);
      const fd = openSync(run.file, "r");
      try {
        readSync(fd, chunk, 0, chunk.length, run.offset);
      } finally {
        closeSync(fd);
      }
      run.offset = size;
      const buf = run.rest.length > 0 ? Buffer.concat([run.rest, chunk]) : chunk;
      const end = buf.lastIndexOf(NEWLINE);
      run.rest = buf.subarray(end + 1);
      if (end >= 0) this.feed(run, buf.subarray(0, end).toString("utf8"), rev);
    }
    if (run.rest.length === 0) return;
    const last = run.rest.toString("utf8");
    try {
      JSON.parse(last);
    } catch {
      return;
    }
    run.rest = Buffer.alloc(0);
    this.feed(run, last, rev);
  }

  private synced(key: string, files: string[], rev: number): Logs {
    let logs = this.logs.get(key);
    const stats = files.map((file) => statSync(file));
    const kept = logs !== undefined && logs.runs.length <= files.length && logs.runs.every((run, k) => run.file === files[k] && run.ino === stats[k].ino && run.offset <= stats[k].size);
    if (!logs || !kept) {
      logs = { epoch: randomUUID(), runs: [], shown: [], revs: [] };
      this.logs.set(key, logs);
    }
    files.forEach((file, k) => {
      const run = (logs.runs[k] ??= { file, ino: stats[k].ino, offset: 0, rest: Buffer.alloc(0), parser: new Parser(path.basename(file, ".jsonl"), this.saveImage, claudeToolCall) });
      this.grow(run, stats[k].size, rev);
    });
    return logs;
  }

  private keyOf(item: Item): string {
    return this.stamps.has(item) || !item.ref ? `${item.run ?? ""}:${item.i}` : `mail:${item.ref}`;
  }

  private shownAs(item: Item): string {
    const stamp = this.stamps.get(item);
    return stamp === undefined ? JSON.stringify(item) : `${this.keyOf(item)}:${stamp}`;
  }

  read(dbFile: string, id: string, before: number | undefined, limit: number, person?: string, since?: Cursor): TranscriptResult {
    let who: Participant | null = null;
    try {
      who = this.mail.participant(dbFile, id);
    } catch {}
    const files = runLogs(logsDirOf(dbFile, id));
    if (who?.transcript && existsSync(who.transcript) && !files.includes(who.transcript)) files.unshift(who.transcript);
    if (files.length === 0) {
      return { ok: false, code: "nolog", error: `No session log for ${who?.name ?? id} yet. piggery keeps a worker's log under its logs directory, and a session's where its harness writes it.` };
    }
    try {
      const rev = ++this.rev;
      const logs = this.synced(`${dbFile}\0${id}`, files, rev);
      const logged: Item[] = [];
      const context: ContextReading = { windows: {} };
      for (const run of logs.runs) {
        logged.push(...run.parser.items);
        context.used = run.parser.context.used;
        Object.assign(context.windows, run.parser.context.windows);
      }
      const usage = usageOf(context);
      let messages: MailMessage[] = [];
      try {
        messages = this.mail.involving(dbFile, id);
      } catch {}
      const merged = mergeMail(logged, messages, id, person);
      const shown = merged.map((item) => this.shownAs(item));
      logs.revs = shown.map((seen, k) => (seen === logs.shown[k] ? logs.revs[k] : rev));
      logs.shown = shown;
      let roles: Record<string, string> | undefined;
      if (who?.team_id) {
        try {
          roles = this.mail.teammates(dbFile, who.team_id);
        } catch {}
      }
      const changed = since?.epoch === logs.epoch && before === undefined ? logs.revs.findIndex((at) => at > since.rev) : undefined;
      const from = changed === undefined ? undefined : changed < 0 ? merged.length : changed;
      const end = from === undefined && before !== undefined ? Math.max(0, Math.min(before, merged.length)) : merged.length;
      const start = from ?? Math.max(0, end - limit);
      const items = merged.slice(start, end).map((item, k) => ({ ...item, i: start + k, key: this.keyOf(item) }));
      return { ok: true, items, total: merged.length, name: who?.name ?? id, role: who?.role ?? undefined, files: files.length, ...(roles ? { roles } : {}), ...(usage ? { usage } : {}), epoch: logs.epoch, rev, ...(from === undefined ? {} : { from }) };
    } catch (error) {
      return { ok: false, code: "failed", error: `Could not read the session log: ${String((error as Error).message ?? error)}` };
    }
  }
}
