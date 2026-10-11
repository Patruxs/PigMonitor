import assert from "node:assert/strict";
import test from "node:test";
import { WIDEST_WINDOW_MS } from "../shared/piggery/segments.ts";
import { EventTimes } from "./event-times.ts";

const clockOf = (ms: number) => new Date(ms).toTimeString().slice(0, 8);

test("an event from 25h ago keeps its own date, so it falls outside the 24h window", async () => {
  const now = Date.UTC(2026, 9, 11, 12, 45, 10);
  const old = now - 25 * 3_600_000;
  const recent = now - 60_000;
  const doc = { events: [{ time: clockOf(recent), who: "vole", type: "spawned", tone: "muted" }, { time: clockOf(old), who: "reed", type: "exited", tone: "danger" }] };
  const times = new EventTimes(async () => [{ ts: old, type: "exited" }, { ts: recent, type: "spawned" }]);
  await times.stamp(doc);
  const [fresh, stale] = doc.events as { at?: number }[];
  assert.equal(fresh.at, recent);
  assert.equal(stale.at, old);
  assert.ok((stale.at as number) < now - WIDEST_WINDOW_MS);
});
