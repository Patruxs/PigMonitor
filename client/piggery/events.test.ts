import assert from "node:assert/strict";
import test from "node:test";
import { countStatuses, headlineOf } from "./events.ts";

test("counts only count agents", () => {
  const c = countStatuses([
    { kind: "team", status: "gone" },
    { kind: "member", status: "working" },
    { kind: "member", status: "idle" },
    { kind: "solo", status: "idle" },
    { kind: "member", status: "gone" },
    { kind: "gone", status: "gone" },
  ]);
  assert.deepEqual(c, { working: 1, waiting: 0, idle: 2, gone: 1 });
});

test("the headline puts what needs the user first", () => {
  assert.deepEqual([headlineOf({ working: 3, idle: 5, waiting: 1 }), headlineOf({ working: 3, idle: 5 }), headlineOf({ working: 0, idle: 2 }), headlineOf({ working: 0, idle: 0 })].map((h) => h.tone), ["warning", "success", "muted", "muted"]);
});
