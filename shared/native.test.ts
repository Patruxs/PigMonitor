import assert from "node:assert/strict";
import test from "node:test";
import { nativeOf, type Session } from "./native.ts";

const claude = (over: Partial<Session>): Session => ({ id: "p", ref: "s1", harness: "claude", mode: "interactive", cwd: "/w", gone: false, ...over });

test("a session opens its Paseo agent when one exists, and only an ended claude session is imported", () => {
  assert.deepEqual(nativeOf(claude({}), "a1"), { kind: "open", agentId: "a1" });
  assert.deepEqual(nativeOf(claude({ gone: true }), "a1"), { kind: "open", agentId: "a1" });
  assert.equal(nativeOf(claude({ gone: true }), undefined).kind, "resume");
  assert.equal(nativeOf(claude({}), undefined).kind, "mail");
  assert.equal(nativeOf(claude({ mode: "headless" }), undefined).kind, "mail");
  assert.equal(nativeOf(claude({ gone: true, harness: "pi" }), undefined).kind, "mail");
});
