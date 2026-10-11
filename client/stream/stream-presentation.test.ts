import assert from "node:assert/strict";
import test from "node:test";
import { applyStreamEvent, type AgentStreamEvent, type StreamItem } from "../../shared/stream/stream.ts";
import { createStreamPresentation, getStreamItemMessageId } from "./stream-presentation.ts";

const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));
const timeline = (item: Extract<AgentStreamEvent, { type: "timeline" }>["item"], turnId?: string): AgentStreamEvent => ({ type: "timeline", provider: "claude", item, ...(turnId ? { turnId } : {}) });

function run(events: AgentStreamEvent[], start: { tail: StreamItem[]; head: StreamItem[] } = { tail: [], head: [] }) {
  return events.reduce((state, event, index) => applyStreamEvent({ ...state, event, timestamp: at(index) }), start);
}

test("a streaming answer's finished markdown blocks show as their own rows above the block still streaming, as Paseo's presentation splits them", () => {
  const present = createStreamPresentation();
  const result = run([timeline({ type: "assistant_message", text: "First block\n\nSecond" })]);
  assert.deepEqual(result.tail, []);
  const shown = present(result);
  assert.deepEqual(shown.tail.map((item) => item.kind === "assistant_message" && item.text), ["First block"]);
  assert.deepEqual(shown.head.map((item) => item.kind === "assistant_message" && item.text), ["Second"]);
  assert.equal(getStreamItemMessageId(shown.tail[0]), getStreamItemMessageId(shown.head[0]));
});
