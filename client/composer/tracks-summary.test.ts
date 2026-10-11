import assert from "node:assert/strict";
import test from "node:test";
import type { StreamItem } from "../../shared/stream/stream.ts";
import { hasComposerTracks, pillPresentation, type SubagentRow } from "./tracks-summary.ts";

const sub = (over: Partial<SubagentRow>): SubagentRow => ({ id: "s", title: null, status: "idle", turnOpen: false, createdAt: 0, ...over });

test("the subagent pill puts failed before working agents, and falls back to one plain segment when none is active", () => {
  const active = pillPresentation([sub({ turnOpen: true }), sub({ status: "error" }), sub({ status: "running", turnOpen: true }), sub({})]);
  assert.deepEqual(active.segments.map((segment) => segment.bucket), ["failed", "running"]);
  assert.deepEqual(pillPresentation([sub({}), sub({ status: "running" })]).segments.map((segment) => segment.bucket), [null]);
});

test("the tracks show for subagents, a task list or an archive in progress, and not otherwise", () => {
  const todo: StreamItem = { kind: "todo_list", id: "t", timestamp: new Date(0), provider: "claude", items: [{ text: "x", completed: false }], activity: { type: "created", count: 1 } };
  assert.deepEqual([hasComposerTracks([], 1), hasComposerTracks([todo], 0), hasComposerTracks([], 0, true), hasComposerTracks([], 0)], [true, true, true, false]);
});
