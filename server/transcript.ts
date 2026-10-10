import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseLines, type Item, type SaveImage, type Transcript } from "../shared/transcript.ts";
import type { MailReader, Participant } from "./mail.ts";

export type TranscriptResult = ({ ok: true } & Transcript) | { ok: false; code: "nodb" | "failed" | "nolog"; error: string };

interface Cached {
  size: number;
  mtime: number;
  items: Item[];
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

export function page(items: Item[], before: number | undefined, limit: number): Item[] {
  const end = before === undefined ? items.length : Math.max(0, Math.min(before, items.length));
  return items.slice(Math.max(0, end - limit), end);
}

export class TranscriptReader {
  private cache = new Map<string, Cached>();
  private readonly mail: MailReader;
  private readonly saveImage: SaveImage | undefined;

  constructor(mail: MailReader, saveImage?: SaveImage) {
    this.mail = mail;
    this.saveImage = saveImage;
  }

  private parsed(file: string, run: string | undefined): Item[] {
    const st = statSync(file);
    const had = this.cache.get(file);
    if (had && had.size === st.size && had.mtime === st.mtimeMs) return had.items;
    const items = parseLines(readFileSync(file, "utf8"), run, this.saveImage);
    this.cache.set(file, { size: st.size, mtime: st.mtimeMs, items });
    return items;
  }

  read(dbFile: string, id: string, before: number | undefined, limit: number): TranscriptResult {
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
      const all: Item[] = [];
      for (const file of files) {
        for (const item of this.parsed(file, path.basename(file, ".jsonl"))) all.push({ ...item, i: all.length });
      }
      let roles: Record<string, string> | undefined;
      if (who?.team_id) {
        try {
          roles = this.mail.teammates(dbFile, who.team_id);
        } catch {}
      }
      return { ok: true, items: page(all, before, limit), total: all.length, name: who?.name ?? id, role: who?.role ?? undefined, files: files.length, ...(roles ? { roles } : {}) };
    } catch (error) {
      return { ok: false, code: "failed", error: `Could not read the session log: ${String((error as Error).message ?? error)}` };
    }
  }
}
