import assert from "node:assert/strict";
import test from "node:test";
import { abortable, nativeOf, releasable, stepInsOf, turnOf, type Session } from "./native.ts";

const claude = (over: Partial<Session>): Session => ({ id: "p", ref: "s1", harness: "claude", mode: "interactive", cwd: "/w", gone: false, state: "working", teamClosed: false, ...over });

test("a session opens its Paseo agent when one exists, and only an ended claude session is imported", () => {
  assert.deepEqual(nativeOf(claude({}), "a1"), { kind: "open", agentId: "a1" });
  assert.deepEqual(nativeOf(claude({ gone: true }), "a1"), { kind: "open", agentId: "a1" });
  assert.equal(nativeOf(claude({ gone: true }), undefined).kind, "resume");
  assert.equal(nativeOf(claude({}), undefined).kind, "mail");
  assert.equal(nativeOf(claude({ mode: "headless" }), undefined).kind, "mail");
  assert.equal(nativeOf(claude({ gone: true, harness: "pi" }), undefined).kind, "mail");
});

test("piggery can stop a turn that is running or waiting on a permission, not a queued, starting, parked, idle or gone one", () => {
  assert.deepEqual(["working", "awaiting_permission", "requested", "starting", "parked", "idle", "gone"].filter(abortable), ["working", "awaiting_permission"]);
});

test("kill and model follow piggery's own per-row actions; resume needs a stopped headless member of an open team", () => {
  const worker = (state: string, over: Partial<Session> = {}) => claude({ mode: "headless", state, gone: state === "gone", ...over });
  assert.deepEqual(stepInsOf({ kind: "member", actions: { kill: true, pick: true } }, worker("idle")), { kill: true, model: true, resume: false });
  assert.deepEqual(stepInsOf({ kind: "member", actions: {} }, worker("gone")), { kill: false, model: false, resume: true });
  assert.equal(stepInsOf({ kind: "member" }, worker("parked")).resume, true);
  assert.equal(stepInsOf({ kind: "member" }, worker("gone", { teamClosed: true })).resume, false);
  assert.equal(stepInsOf({ kind: "member" }, worker("gone", { mode: "interactive" })).resume, false);
  assert.equal(stepInsOf({ kind: "solo" }, worker("gone")).resume, false);
  assert.equal(stepInsOf({ kind: "member" }, undefined).resume, false);
});

test("a held message can be released unless its team is closed", () => {
  const teams = { open: {}, shut: { closed: 1 } };
  assert.equal(releasable({ held: "limit", team: "open" }, teams), true);
  assert.equal(releasable({ held: "limit" }, teams), true);
  assert.equal(releasable({ held: "limit", team: "shut" }, teams), false);
  assert.equal(releasable({ team: "open" }, teams), false);
});

test("a worker awaiting permission is mid-turn for both Stop and the turn indicator", () => {
  assert.deepEqual(turnOf({ state: "awaiting_permission", status: "waiting" }), { active: true, meterStatus: "running" });
  assert.deepEqual(turnOf({ state: "idle", status: "waiting" }), { active: false, meterStatus: "waiting" });
});
