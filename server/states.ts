import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { pruneHistories, recentSegments, recordSightings, sightingsOf, WIDEST_WINDOW_MS, type Histories, type Segment } from "../shared/segments.ts";
import { readView } from "../shared/view.ts";
import type { Result } from "./piggery.ts";

export const STATES_FILE = path.join(homedir(), ".paseo", "plugin-data", "pigmonitor", "states.json");

const RECORD_EVERY_MS = 5000;
const WATCH_GAP_MS = 3 * RECORD_EVERY_MS;
const KEEP_MS = 7 * 86_400_000;
const MAX_SEGMENTS = 1000;
const SAVE_SEEN_EVERY_MS = 60_000;
const FILE_VERSION = 1;

export type Snapshot = { ok: true; view: Record<string, unknown> } | { ok: false; code: "missing" | "down" | "older" | "failed"; error: string };

export class StateRecorder {
  private histories: Histories = {};
  private latest: { at: number; snapshot: Snapshot } | null = null;
  private reading: Promise<Snapshot> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private savedAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private readonly loaded: Promise<void>;
  private readonly file: string;
  private readonly runPs: () => Promise<Result>;

  constructor(file: string, runPs: () => Promise<Result>) {
    this.file = file;
    this.runPs = runPs;
    this.loaded = this.load();
  }

  start(): void {
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  async snapshot(): Promise<Snapshot> {
    if (this.latest && Date.now() - this.latest.at < RECORD_EVERY_MS) return this.latest.snapshot;
    return this.read();
  }

  segments(now = Date.now()): Record<string, Segment[]> {
    return recentSegments(this.histories, now, WIDEST_WINDOW_MS);
  }

  private async loop(): Promise<void> {
    if (this.stopped) return;
    await this.read();
    if (!this.stopped) this.timer = setTimeout(() => void this.loop(), RECORD_EVERY_MS);
  }

  private read(): Promise<Snapshot> {
    this.reading ??= this.readNow().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  private async readNow(): Promise<Snapshot> {
    await this.loaded;
    const r = await this.runPs();
    const at = Date.now();
    const snapshot = parsed(r);
    this.latest = { at, snapshot };
    if (snapshot.ok) this.record(snapshot.view, at);
    return snapshot;
  }

  private record(doc: Record<string, unknown>, at: number): void {
    const view = readView(doc);
    if (!view.ok) return;
    const { histories, changed } = recordSightings(this.histories, sightingsOf(view.view, at), at, WATCH_GAP_MS);
    this.histories = histories;
    if (changed || at - this.savedAt >= SAVE_SEEN_EVERY_MS) this.save(at);
  }

  private async load(): Promise<void> {
    try {
      const doc = JSON.parse(await readFile(this.file, "utf8")) as { version?: number; members?: Histories };
      if (doc.version === FILE_VERSION && doc.members) this.histories = pruneHistories(doc.members, Date.now(), KEEP_MS, MAX_SEGMENTS);
    } catch {}
  }

  private save(at: number): void {
    this.savedAt = at;
    this.histories = pruneHistories(this.histories, at, KEEP_MS, MAX_SEGMENTS);
    const body = JSON.stringify({ version: FILE_VERSION, members: this.histories });
    this.saving = this.saving.then(async () => {
      try {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(`${this.file}.tmp`, body);
        await rename(`${this.file}.tmp`, this.file);
      } catch (error) {
        console.log(`pigmonitor: could not save the state history: ${String((error as Error).message ?? error)}`);
      }
    });
  }
}

function parsed(r: Result): Snapshot {
  if (!r.ok) return r;
  try {
    return { ok: true, view: JSON.parse(r.out) as Record<string, unknown> };
  } catch {
    return { ok: false, code: "failed", error: "piggery ps --view did not print JSON." };
  }
}
