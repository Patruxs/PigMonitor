import assert from "node:assert/strict";
import test from "node:test";
import { basenameOf, countStatuses, countsText, headlineOf, readAgo, sentenceOf } from "./events.ts";

test("a spawn reads as who spawned whom", () => {
  assert.deepEqual(sentenceOf({ who: "lead", type: "spawned", target: "network-fixer", tone: "muted" }), { actor: "lead", verb: "spawned", object: "network-fixer", icon: "Sparkles" });
});

test("an exit is said plainly with a warning icon", () => {
  const s = sentenceOf({ who: "cleaner-fixer", type: "exited", tone: "danger" });
  assert.equal(s.actor, "cleaner-fixer");
  assert.equal(s.verb, "exited unexpectedly");
  assert.equal(s.icon, "TriangleAlert");
});

test("a notice names its number", () => {
  assert.deepEqual(sentenceOf({ who: "turtle", type: "notice", target: "#1467", tone: "muted" }), { actor: "turtle", verb: "posted notice", object: "#1467", icon: "Bell" });
});

test("a team coming up without an actor is a sentence of its own", () => {
  assert.equal(sentenceOf({ who: "", type: "team_up", tone: "muted" }).verb, "A team came up");
  assert.deepEqual(sentenceOf({ who: "", type: "team_up", target: "paseo", tone: "muted" }), { actor: "paseo", verb: "came up", object: undefined, icon: "Users" });
});

test("an unknown type reads as its words", () => {
  assert.deepEqual(sentenceOf({ who: "x", type: "some_new_thing", tone: "muted" }), { actor: "x", verb: "some new thing", object: undefined, icon: "Activity" });
  assert.equal(sentenceOf({ who: "x", type: "boom", tone: "danger" }).icon, "TriangleAlert");
});

test("counts only count agents and read in status order", () => {
  const c = countStatuses([
    { kind: "team", status: "gone" },
    { kind: "member", status: "working" },
    { kind: "member", status: "idle" },
    { kind: "solo", status: "idle" },
    { kind: "member", status: "gone" },
    { kind: "gone", status: "gone" },
  ]);
  assert.deepEqual(c, { working: 1, waiting: 0, idle: 2, gone: 1 });
  assert.equal(countsText(c), "1 working · 2 idle · 1 gone");
  assert.equal(countsText({ working: 0, waiting: 0, idle: 0, gone: 0 }), "");
});

test("the headline puts what needs the user first", () => {
  assert.deepEqual(headlineOf({ working: 3, idle: 5, waiting: 1 }), { text: "1 agent needs your attention", tone: "warning" });
  assert.deepEqual(headlineOf({ working: 3, idle: 5 }), { text: "3 agents working, 5 idle", tone: "success" });
  assert.deepEqual(headlineOf({ working: 1, idle: 0 }), { text: "1 agent working", tone: "success" });
  assert.deepEqual(headlineOf({ working: 0, idle: 2 }), { text: "All quiet · 2 agents idle", tone: "muted" });
  assert.deepEqual(headlineOf({ working: 0, idle: 0 }), { text: "Nothing is running", tone: "muted" });
});

test("a directory is named by its last part", () => {
  assert.equal(basenameOf("/mnt/Personal/03-Projects/utils/"), "utils");
  assert.equal(basenameOf("/home/pat/.piggery/paseo"), "paseo");
  assert.equal(basenameOf("/"), "/");
});

test("the read age is said in words", () => {
  assert.equal(readAgo(2), "just now");
  assert.equal(readAgo(12), "12s ago");
  assert.equal(readAgo(150), "3 min ago");
});
