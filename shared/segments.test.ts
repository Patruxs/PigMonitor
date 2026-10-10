import assert from "node:assert/strict";
import { test } from "node:test";
import { piecesIn, pruneHistories, recordSighting, type MemberHistory, type Sighting } from "./segments.ts";

const GAP = 15_000;

function replay(sightings: [number, Sighting][]): MemberHistory | undefined {
  let history: MemberHistory | undefined;
  for (const [at, sighting] of sightings) history = recordSighting(history, sighting, at, GAP);
  return history;
}

test("the first sighting backfills the current state from state_since", () => {
  assert.deepEqual(replay([[5_000, { status: "working", since: 1_000 }]])?.segments, [{ state: "working", start: 1_000, end: null }]);
});

test("each transition closes the previous segment at the new state_since", () => {
  const history = replay([
    [1_000, { status: "idle", since: 0 }],
    [6_000, { status: "working", since: 4_000 }],
    [11_000, { status: "working", since: 4_000 }],
    [16_000, { status: "waiting", since: 13_000 }],
  ]);
  assert.deepEqual(history?.segments, [
    { state: "idle", start: 0, end: 4_000 },
    { state: "working", start: 4_000, end: 13_000 },
    { state: "waiting", start: 13_000, end: null },
  ]);
});

test("a member that exits ends its last segment at the exit time", () => {
  const history = replay([
    [1_000, { status: "working", since: 0 }],
    [6_000, { status: "gone", since: 5_000 }],
  ]);
  assert.deepEqual(history?.segments, [
    { state: "working", start: 0, end: 5_000 },
    { state: "gone", start: 5_000, end: null },
  ]);
});

test("a transition seen after an unwatched stretch ends the old state where it was last seen, not at the new one", () => {
  const history = replay([
    [1_000, { status: "working", since: 0 }],
    [3_600_000, { status: "idle", since: 3_500_000 }],
  ]);
  assert.deepEqual(history?.segments, [
    { state: "working", start: 0, end: 1_000 },
    { state: "idle", start: 3_500_000, end: null },
  ]);
});

test("pieces are clipped to the window, drop gone, and merge touching pieces of one state", () => {
  const segments = [
    { state: "idle" as const, start: 0, end: 100 },
    { state: "working" as const, start: 100, end: 200 },
    { state: "working" as const, start: 200, end: 300 },
    { state: "idle" as const, start: 300, end: 400 },
    { state: "gone" as const, start: 400, end: null },
  ];
  assert.deepEqual(piecesIn(segments, 50, 350, 1_000), [
    { state: "idle", start: 50, end: 100 },
    { state: "working", start: 100, end: 300 },
    { state: "idle", start: 300, end: 350 },
  ]);
});

test("pruning keeps the recent past and drops members gone for longer than the cap", () => {
  const day = 86_400_000;
  const now = 10 * day;
  const pruned = pruneHistories(
    {
      live: { segments: [{ state: "idle", start: 0, end: 2 * day }, { state: "working", start: 2 * day, end: null }], seen: now },
      exited: { segments: [{ state: "working", start: 0, end: day }, { state: "gone", start: day, end: null }], seen: now },
    },
    now,
    7 * day,
    100,
  );
  assert.deepEqual(Object.keys(pruned), ["live"]);
  assert.deepEqual(pruned.live.segments, [{ state: "working", start: 2 * day, end: null }]);
});
