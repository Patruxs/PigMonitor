import assert from "node:assert/strict";
import test from "node:test";
import { abortable, agentsById, agentsBySession, chatRouteOf, heldAgentOf, paseoBusyOf, releasable, sendTargetOf, stepInsOf, turnOf, withPaseoBusy, type ParticipantRecord } from "./chat-route.ts";

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

test("a participant keeps its Paseo agent after the agent's Claude session id changes, as a conversation rewind does", () => {
  const agent = { id: "fe6455cd", provider: "claude", status: "idle", activeTurn: null, archivedAt: null, persistence: { sessionId: "c0af857a" } };
  const tundra = { id: "tundra", ref: "ac2c96a6" };
  const held = heldAgentOf(tundra, agentsBySession([{ agent }]), new Map([["tundra", "fe6455cd"]]), agentsById([{ agent }]));
  assert.equal(held?.agentId, "fe6455cd");
  const archived = { ...agent, archivedAt: "2026-10-10T16:00:00Z" };
  assert.equal(heldAgentOf(tundra, agentsBySession([{ agent: archived }]), new Map([["tundra", "fe6455cd"]]), agentsById([{ agent: archived }])), undefined);
});

test("a message to a session with a Paseo agent is a prompt whatever piggery's state, mail needs no agent, and an unreachable agent is an error, never mail", () => {
  const gone = claude({ gone: true, state: "gone", mode: "headless" });
  assert.deepEqual(sendTargetOf(chatRouteOf(gone, "fe6455cd"), true), { kind: "prompt", agentId: "fe6455cd" });
  assert.deepEqual(sendTargetOf(chatRouteOf(claude({ state: "working" }), "fe6455cd"), true), { kind: "prompt", agentId: "fe6455cd" });
  assert.deepEqual(sendTargetOf(chatRouteOf(claude({ mode: "headless" }), undefined), true), { kind: "mail" });
  assert.equal(sendTargetOf(chatRouteOf(claude({}), "fe6455cd"), false).kind, "error");
});
