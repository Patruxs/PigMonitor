import assert from "node:assert/strict";
import test from "node:test";
import { createStreamPresentation, getStreamItemMessageId } from "./stream-presentation.ts";
import { appendSubmittedUserMessage, applyStreamEvent, createUserMessage, type AgentStreamEvent, type StreamItem } from "./stream.ts";

const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));
const timeline = (item: Extract<AgentStreamEvent, { type: "timeline" }>["item"], turnId?: string): AgentStreamEvent => ({ type: "timeline", provider: "claude", item, ...(turnId ? { turnId } : {}) });

function run(events: AgentStreamEvent[], start: { tail: StreamItem[]; head: StreamItem[] } = { tail: [], head: [] }) {
  return events.reduce((state, event, index) => applyStreamEvent({ ...state, event, timestamp: at(index) }), start);
}

test("streamed assistant text stays in the head until a tool call commits it, and a tool call's later status merges by call id", () => {
  const tool = (status: "running" | "completed") => timeline({ type: "tool_call", callId: "c1", name: "Bash", status, error: null, detail: { type: "shell", command: "ls", ...(status === "completed" ? { output: "a" } : {}) } });
  const streaming = run([timeline({ type: "assistant_message", text: "Hel" }), timeline({ type: "assistant_message", text: "lo" })]);
  assert.deepEqual(streaming.tail, []);
  assert.equal(streaming.head.length, 1);
  assert.equal((streaming.head[0] as { text: string }).text, "Hello");
  const done = run([tool("running"), tool("completed")], streaming);
  assert.deepEqual(done.tail.map((item) => item.kind), ["assistant_message", "tool_call"]);
  const call = done.tail[1];
  assert.equal(call.kind === "tool_call" && call.payload.data.status, "completed");
  assert.equal(call.kind === "tool_call" && call.payload.data.detail.type === "shell" && call.payload.data.detail.output, "a");
});

test("the agent's own copy of a message sent from the composer replaces the pending one instead of showing twice", () => {
  const pending = createUserMessage({ clientMessageId: "m1", text: "hi", timestamp: at(0) });
  const local = appendSubmittedUserMessage({ tail: [], head: [], message: pending });
  const result = applyStreamEvent({ ...local, event: timeline({ type: "user_message", text: "hi", messageId: "server-1", clientMessageId: "m1" }, "t1"), timestamp: at(1), source: "canonical", timelineCursor: { epoch: "e", seq: 1 } });
  const users = result.tail.filter((item) => item.kind === "user_message");
  assert.equal(users.length, 1);
  assert.equal(users[0].kind === "user_message" && users[0].messageId, "server-1");
  assert.deepEqual(result.acknowledgedClientMessageIds, ["m1"]);
});

test("a streaming answer's finished markdown blocks show as their own rows above the block still streaming, as Paseo's presentation splits them", () => {
  const present = createStreamPresentation();
  const result = run([timeline({ type: "assistant_message", text: "First block\n\nSecond" })]);
  assert.deepEqual(result.tail, []);
  const shown = present(result);
  assert.deepEqual(shown.tail.map((item) => item.kind === "assistant_message" && item.text), ["First block"]);
  assert.deepEqual(shown.head.map((item) => item.kind === "assistant_message" && item.text), ["Second"]);
  assert.equal(getStreamItemMessageId(shown.tail[0]), getStreamItemMessageId(shown.head[0]));
});
