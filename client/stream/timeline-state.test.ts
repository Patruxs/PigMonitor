import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_TIMELINE, processAgentStreamEvents, processTimelineResponse, type TimelinePage, type TimelineResponseEntry } from "./timeline-state.ts";

const entry = (seq: number, item: Record<string, unknown>): TimelineResponseEntry => ({ seqStart: seq, seqEnd: seq, provider: "claude", item, timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString() });

function page(direction: TimelinePage["direction"], entries: TimelineResponseEntry[], hasOlder: boolean): TimelinePage {
  const seqs = entries.map((e) => e.seqStart);
  return { direction, projection: "projected", reset: false, epoch: "e1", window: { minSeq: 1, maxSeq: 10, nextSeq: 11 }, startCursor: { seq: Math.min(...seqs) }, endCursor: { seq: Math.max(...seqs) }, entries, error: null, hasNewer: false, hasOlder };
}

test("the first tail page replaces the stream, and an older page is prepended before it", () => {
  const tail = processTimelineResponse(page("tail", [entry(9, { type: "user_message", text: "second", messageId: "u2" }), entry(10, { type: "assistant_message", text: "reply" })], true), EMPTY_TIMELINE, []);
  assert.equal(tail.state.initialized, true);
  assert.equal(tail.state.hasOlder, true);
  assert.deepEqual(tail.sideEffects, [{ type: "catch_up", cursor: { epoch: "e1", endSeq: 10 } }]);
  const older = processTimelineResponse(page("before", [entry(8, { type: "user_message", text: "first", messageId: "u1" })], false), tail.state, []);
  assert.deepEqual(older.state.tail.map((item) => (item.kind === "user_message" || item.kind === "assistant_message" ? item.text : item.kind)), ["first", "second", "reply"]);
  assert.equal(older.state.hasOlder, false);
});

test("live events apply in sequence: a stale one is dropped and a gap asks to catch up instead of applying out of order", () => {
  const base = processTimelineResponse(page("tail", [entry(10, { type: "assistant_message", text: "a", messageId: "m" })], false), EMPTY_TIMELINE, []).state;
  const event = (text: string) => ({ type: "timeline" as const, provider: "claude", item: { type: "user_message" as const, text, messageId: text } });
  const stale = processAgentStreamEvents([{ event: event("old"), seq: 10, epoch: "e1", timestamp: new Date() }], base);
  assert.equal(stale.state.tail.length, base.tail.length);
  const gap = processAgentStreamEvents([{ event: event("later"), seq: 12, epoch: "e1", timestamp: new Date() }], base);
  assert.equal(gap.state.tail.length, base.tail.length);
  assert.deepEqual(gap.sideEffects, [{ type: "catch_up", cursor: { epoch: "e1", endSeq: 10 } }]);
  const next = processAgentStreamEvents([{ event: event("next"), seq: 11, epoch: "e1", timestamp: new Date() }], base);
  assert.equal(next.state.cursor?.endSeq, 11);
  assert.equal(next.state.tail.at(-1)?.kind, "user_message");
});
