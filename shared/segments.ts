import type { Status, View } from "./view.ts";

export interface Segment {
  state: Status;
  start: number;
  end: number | null;
}

export interface MemberHistory {
  segments: Segment[];
  seen: number;
}

export type Histories = Record<string, MemberHistory>;

export interface Sighting {
  status: Status;
  since: number;
}

export interface Piece {
  state: Status;
  start: number;
  end: number;
}

export const WIDEST_WINDOW_MS = 24 * 3_600_000;

export function sightingsOf(view: View, at: number): Map<string, Sighting> {
  const out = new Map<string, Sighting>();
  for (const list of [view.all, view.closed]) {
    for (const dir of list.dirs) {
      for (const block of dir.blocks) {
        for (const row of block.rows) {
          if (row.kind !== "member" && row.kind !== "solo") continue;
          out.set(row.id, { status: row.status, since: row.state_since ?? at });
        }
      }
    }
  }
  return out;
}

export function recordSighting(history: MemberHistory | undefined, sighting: Sighting, at: number, watchGapMs: number): MemberHistory {
  if (!history || history.segments.length === 0) return { segments: [{ state: sighting.status, start: sighting.since, end: null }], seen: at };
  const segments = history.segments;
  const open = segments[segments.length - 1];
  const changed = open.end !== null || sighting.status !== open.state || sighting.since > open.start;
  if (!changed) return { segments, seen: at };
  const watched = sighting.since <= history.seen + watchGapMs;
  const closeAt = Math.max(open.start, watched ? sighting.since : history.seen);
  const closed = open.end === null ? [...segments.slice(0, -1), { ...open, end: closeAt }] : segments;
  return { segments: [...closed, { state: sighting.status, start: Math.max(sighting.since, closeAt), end: null }], seen: at };
}

export function recordSightings(histories: Histories, sightings: Map<string, Sighting>, at: number, watchGapMs: number): { histories: Histories; changed: boolean } {
  const next: Histories = { ...histories };
  let changed = false;
  for (const [id, sighting] of sightings) {
    const before = histories[id];
    const after = recordSighting(before, sighting, at, watchGapMs);
    if (!before || after.segments !== before.segments) changed = true;
    next[id] = after;
  }
  return { histories: next, changed };
}

export function pruneHistories(histories: Histories, now: number, keepMs: number, maxSegments: number): Histories {
  const cutoff = now - keepMs;
  const out: Histories = {};
  for (const [id, history] of Object.entries(histories)) {
    if (history.seen < cutoff) continue;
    const kept = history.segments.filter((s) => s.end === null || s.end >= cutoff).slice(-maxSegments);
    const last = kept[kept.length - 1];
    if (!last || (last.state === "gone" && last.start < cutoff)) continue;
    out[id] = { segments: kept, seen: history.seen };
  }
  return out;
}

export function recentSegments(histories: Histories, now: number, spanMs: number): Record<string, Segment[]> {
  const cutoff = now - spanMs;
  const out: Record<string, Segment[]> = {};
  for (const [id, history] of Object.entries(histories)) out[id] = history.segments.filter((s) => (s.end ?? now) >= cutoff);
  return out;
}

export function piecesIn(segments: readonly Segment[], from: number, until: number, now: number): Piece[] {
  const out: Piece[] = [];
  for (const s of segments) {
    if (s.state === "gone") continue;
    const start = Math.max(s.start, from);
    const end = Math.min(s.end ?? now, until);
    if (end <= start) continue;
    const last = out[out.length - 1];
    if (last && last.state === s.state && last.end >= start) last.end = Math.max(last.end, end);
    else out.push({ state: s.state, start, end });
  }
  return out;
}
