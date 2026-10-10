import assert from "node:assert/strict";
import test from "node:test";
import { abortable, chatRouteOf, paseoBusyOf, releasable, stepInsOf, turnOf, withPaseoBusy, type ParticipantRecord } from "./chat-route.ts";

const claude = (over: Partial<ParticipantRecord>): ParticipantRecord => ({ id: "p", ref: "s1", harness: "claude", mode: "interactive", cwd: "/w", gone: false, state: "working", teamClosed: false, ...over });

test("a session opens its Paseo agent when one exists, and only an ended claude session is imported", () => {
  assert.deepEqual(chatRouteOf(claude({}), "a1"), { kind: "open", agentId: "a1" });
  assert.deepEqual(chatRouteOf(claude({ gone: true }), "a1"), { kind: "open", agentId: "a1" });
  assert.equal(chatRouteOf(claude({ gone: true }), undefined).kind, "resume");
  assert.equal(chatRouteOf(claude({}), undefined).kind, "mail");
  assert.equal(chatRouteOf(claude({ mode: "headless" }), undefined).kind, "mail");
  assert.equal(chatRouteOf(claude({ gone: true, harness: "pi" }), undefined).kind, "mail");
});

test("piggery can stop a turn that is running or waiting on a permission, not a queued, starting, parked, idle or gone one", () => {
  assert.deepEqual(["working", "awaiting_permission", "requested", "starting", "parked", "idle", "gone"].filter(abortable), ["working", "awaiting_permission"]);
});

test("kill and model follow piggery's own per-row actions; resume needs a stopped headless member of an open team", () => {
  const worker = (state: string, over: Partial<ParticipantRecord> = {}) => claude({ mode: "headless", state, gone: state === "gone", ...over });
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

test("an open Paseo agent decides busy or idle over piggery's state, and piggery's state stands without one", () => {
  const working = { state: "working", status: "working" as const, state_text: "working" };
  const idle = { state: "idle", status: "idle" as const, state_text: "idle" };
  const interrupted = withPaseoBusy(working, paseoBusyOf({ status: "idle", activeTurn: null }));
  assert.deepEqual({ status: interrupted.status, stop: turnOf(interrupted).active }, { status: "idle", stop: false });
  const started = withPaseoBusy(idle, paseoBusyOf({ status: "running", activeTurn: { turnId: "t" } }));
  assert.deepEqual({ status: started.status, stop: turnOf(started).active }, { status: "working", stop: true });
  assert.equal(withPaseoBusy(working, paseoBusyOf(null)), working);
});
