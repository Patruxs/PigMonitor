import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type { Histories, Segment } from "../shared/piggery/segments.ts";
import type { Status } from "../shared/piggery/view.ts";
import type { Result } from "./piggery.ts";
import { StateRecorder } from "./states.ts";

const NOW = Date.UTC(2026, 9, 1);
const DAY = 86_400_000;

function psOut(members: { id: string; status: Status; since: number }[]): Result {
  const rows = members.map((m) => ({ kind: "member", id: m.id, depth: 0, name: m.id, state: m.status, state_text: m.status, status: m.status, unacked: 0, state_since: m.since }));
  return { ok: true, out: JSON.stringify({ version: 1, all: { dirs: [{ path: "/work", label: "work", blocks: [{ rows }] }] }, closed: { dirs: [] } }) };
}

function statesFile(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "states-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "states.json");
}

async function saved(file: string, ready: (members: Histories) => boolean): Promise<Histories> {
  for (let tries = 0; tries < 200; tries++) {
    try {
      const members = (JSON.parse(readFileSync(file, "utf8")) as { members: Histories }).members;
      if (ready(members)) return members;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${file} never held the expected history`);
}

test("a state change closes the member's open segment at the change and opens one for the new state", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const file = statesFile(t);
  let ps = psOut([{ id: "a", status: "working", since: NOW - 60_000 }]);
  const recorder = new StateRecorder(file, async () => ps);
  await recorder.snapshot();
  ps = psOut([{ id: "a", status: "idle", since: NOW + 3000 }]);
  t.mock.timers.tick(6000);
  await recorder.snapshot();
  await saved(file, (members) => members.a?.segments.length === 2);
  assert.deepEqual(recorder.segments(), {
    a: [
      { state: "working", start: NOW - 60_000, end: NOW + 3000 },
      { state: "idle", start: NOW + 3000, end: null },
    ],
  });
});

test("a new recorder reads back the saved history and carries on from it", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const file = statesFile(t);
  let ps = psOut([{ id: "a", status: "working", since: NOW - 60_000 }]);
  const first = new StateRecorder(file, async () => ps);
  await first.snapshot();
  ps = psOut([{ id: "a", status: "idle", since: NOW + 3000 }]);
  t.mock.timers.tick(6000);
  await first.snapshot();
  await saved(file, (members) => members.a?.segments.length === 2);
  t.mock.timers.tick(6000);
  const next = new StateRecorder(file, async () => ps);
  await next.snapshot();
  await saved(file, (members) => members.a?.seen === NOW + 12_000);
  assert.deepEqual(next.segments(), first.segments());
});

test("the saved history keeps seven days and drops members not seen within them", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const file = statesFile(t);
  const kept: Segment[] = [
    { state: "idle", start: NOW - 8 * DAY, end: NOW - 2 * DAY },
    { state: "working", start: NOW - 2 * DAY, end: null },
  ];
  const members: Histories = {
    stale: { seen: NOW - 8 * DAY, segments: [{ state: "idle", start: NOW - 9 * DAY, end: null }] },
    a: { seen: NOW - 1000, segments: [{ state: "working", start: NOW - 10 * DAY, end: NOW - 8 * DAY }, ...kept] },
  };
  writeFileSync(file, JSON.stringify({ version: 1, members }));
  const recorder = new StateRecorder(file, async () => psOut([{ id: "a", status: "working", since: NOW - 2 * DAY }]));
  await recorder.snapshot();
  assert.deepEqual(await saved(file, (m) => m.a?.seen === NOW), { a: { seen: NOW, segments: kept } });
});
