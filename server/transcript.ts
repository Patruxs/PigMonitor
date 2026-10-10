import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { MailMessage } from "../shared/mail.ts";
import { Parser, usageOf, type ContextReading, type DescribeTool, type SaveImage } from "../shared/claude-log.ts";
import { mergeMail } from "../shared/transcript-mail.ts";
import type { Item, Transcript } from "../shared/transcript.ts";
import type { PiggeryDb, Participant } from "./db.ts";
import { JsonlTail } from "./jsonl-tail.ts";
import { claudeToolCall } from "./tool-detail.ts";
import { messageOf } from "../shared/errors.ts";

const exists = (file: string) => {
  try {
    return existsSync(file);
  } catch {
    return true;
  }
};

const describeTool: DescribeTool = (name, input, result, cwd) => claudeToolCall(name, input, result, cwd, exists);

export interface Cursor {
  epoch: string;
  rev: number;
}

export type TranscriptResult = ({ ok: true } & Transcript & Cursor) | { ok: false; code: "nodb" | "failed" | "nolog"; error: string };

interface RunLog {
  tail: JsonlTail;
  parser: Parser;
}

interface Logs {
  epoch: string;
  runs: RunLog[];
  shown: string[];
  revs: number[];
}

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

export class TranscriptReader {
  private logs = new Map<string, Logs>();
  private rev = 0;
  private stamps = new WeakMap<Item, number>();
  private readonly db: PiggeryDb;
  private readonly saveImage: SaveImage | undefined;

  constructor(db: PiggeryDb, saveImage?: SaveImage) {
    this.db = db;
    this.saveImage = saveImage;
  }

  private feed(run: RunLog, lines: string[], rev: number): void {
    if (lines.length === 0) return;
    for (const line of lines) run.parser.line(line);
    run.parser.stamp();
    for (const i of run.parser.changed) this.stamps.set(run.parser.items[i], rev);
    run.parser.changed.clear();
  }

  private synced(key: string, files: string[], rev: number): Logs {
    let logs = this.logs.get(key);
    const stats = files.map((file) => statSync(file));
    const kept = logs !== undefined && logs.runs.length <= files.length && logs.runs.every((run, k) => run.tail.file === files[k] && run.tail.continues(stats[k]));
    if (!logs || !kept) {
      logs = { epoch: randomUUID(), runs: [], shown: [], revs: [] };
      this.logs.set(key, logs);
    }
    files.forEach((file, k) => {
      const run = (logs.runs[k] ??= { tail: new JsonlTail(file, stats[k]), parser: new Parser(path.basename(file, ".jsonl"), this.saveImage, describeTool) });
      this.feed(run, run.tail.lines(stats[k]), rev);
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

  read(dbFile: string, id: string, { limit, person, since }: { limit: number; person?: string; since?: Cursor }): TranscriptResult {
    let who: Participant | null = null;
    try {
      who = this.db.participant(dbFile, id);
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
        messages = this.db.involving(dbFile, id);
      } catch {}
      const merged = mergeMail(logged, messages, id, person);
      const shown = merged.map((item) => this.shownAs(item));
      logs.revs = shown.map((seen, k) => (seen === logs.shown[k] ? logs.revs[k] : rev));
      logs.shown = shown;
      let roles: Record<string, string> | undefined;
      if (who?.team_id) {
        try {
          roles = this.db.teammates(dbFile, who.team_id);
        } catch {}
      }
      const changed = since?.epoch === logs.epoch ? logs.revs.findIndex((at) => at > since.rev) : undefined;
      const from = changed === undefined ? undefined : changed < 0 ? merged.length : changed;
      const start = from ?? Math.max(0, merged.length - limit);
      const items = merged.slice(start).map((item, k) => ({ ...item, i: start + k, key: this.keyOf(item) }));
      return { ok: true, items, total: merged.length, name: who?.name ?? id, role: who?.role ?? undefined, files: files.length, ...(roles ? { roles } : {}), ...(usage ? { usage } : {}), epoch: logs.epoch, rev, ...(from === undefined ? {} : { from }) };
    } catch (error) {
      return { ok: false, code: "failed", error: `Could not read the session log: ${messageOf(error)}` };
    }
  }
}
