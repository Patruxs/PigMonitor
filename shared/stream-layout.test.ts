import assert from "node:assert/strict";
import test from "node:test";
import type { StreamItem } from "./stream.ts";
import { streamOfTranscript } from "./stream-mail.ts";
import { createReadingAnchor, deriveStreamTurnTiming, layoutStream } from "./stream-layout.ts";

const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));

test("a finished turn's footer hangs under its last answer, with the time from the prompt to the turn's last item", () => {
  const items: StreamItem[] = [
    { kind: "user_message", id: "u1", text: "go", timestamp: at(0) },
    { kind: "assistant_message", id: "a1", text: "working", timestamp: at(1) },
    { kind: "tool_call", id: "t1", timestamp: at(5), payload: { source: "agent", data: { provider: "claude", callId: "t1", name: "Bash", status: "completed", error: null, detail: { type: "shell", command: "ls" } } } },
    { kind: "user_message", id: "u2", text: "again", timestamp: at(9) },
    { kind: "assistant_message", id: "a2", text: "done", timestamp: at(12) },
  ];
  const timing = deriveStreamTurnTiming({ isTurnActive: false, activeTurnStartedAt: null, tail: items, head: [] });
  const layout = layoutStream({ isTurnActive: false, history: items, liveHead: [], timing: timing.byAssistantId });
  assert.equal(layout.history[2].completedFooter?.itemId, "a1");
  assert.equal(layout.history[2].completedFooter?.timing?.durationMs, 5000);
  assert.equal(layout.auxiliaryTurnFooter?.itemId, "a2");
  assert.equal(layout.history[4].completedFooter, null);
});

test("piggery mail starts a new turn like a prompt, and a message's parsed images and image marks become its attachments", () => {
  const stream = streamOfTranscript([
    { i: 1, kind: "user", at: 0, text: "look\n[image: /tmp/a.png]", images: ["/tmp/b.png"], note: "Sent" },
    { i: 2, kind: "assistant", at: 1000, text: "seen" },
    { i: 3, kind: "mail", at: 2000, text: "from the lead", from: "squid", ref: "#4" },
    { i: 4, kind: "assistant", at: 3000, text: "ok" },
  ]);
  const user = stream[0];
  assert.equal(user.kind === "user_message" && user.text, "look");
  assert.deepEqual(user.kind === "user_message" && user.images?.map((image) => image.path), ["/tmp/b.png", "/tmp/a.png"]);
  const layout = layoutStream({ isTurnActive: false, history: stream, liveHead: [], timing: new Map() });
  assert.equal(layout.history[1].completedFooter?.itemId, "assistant::2");
});

test("a worker's turn takes its duration and cost from its result, and mail arriving mid-turn does not split it", () => {
  const stream = streamOfTranscript([
    { i: 0, kind: "session", at: 0, text: "run" },
    { i: 1, kind: "mail", at: 1000, text: "brief", from: "lead", ref: "#1" },
    { i: 2, kind: "assistant", at: 2000, text: "on it" },
    { i: 3, kind: "mail", at: 3000, text: "also this", from: "lead", ref: "#2" },
    { i: 4, kind: "assistant", at: 4000, text: "done" },
    { i: 5, kind: "turn", at: 4000, text: "", durationMs: 758000, costUsd: 3.93 },
    { i: 6, kind: "mail", at: 5000, text: "thanks", from: "lead", ref: "#3" },
    { i: 7, kind: "assistant", at: 6000, text: "ok" },
    { i: 8, kind: "turn", at: 6000, text: "", durationMs: 1000 },
  ]);
  const timing = deriveStreamTurnTiming({ isTurnActive: false, activeTurnStartedAt: null, tail: stream, head: [] });
  assert.deepEqual(timing.byAssistantId.get("assistant::4"), { completedAt: new Date(4000), durationMs: 758000, costUsd: 3.93 });
  assert.equal(timing.byAssistantId.get("assistant::2")?.durationMs, 758000);
  const layout = layoutStream({ isTurnActive: false, history: stream, liveHead: [], timing: timing.byAssistantId });
  assert.deepEqual(layout.history.map((row) => row.completedFooter?.itemId ?? null), [null, null, null, null, null, "assistant::4", null, null, null]);
});

test("a reader scrolled up keeps the same row in view when older history is prepended above it", () => {
  const anchor = createReadingAnchor();
  anchor.reconcile(0, [{ id: "a", top: 0, height: 100 }, { id: "b", top: 100, height: 100 }]);
  anchor.scroll(120);
  const corrected = anchor.reconcile(120, [{ id: "old", top: 0, height: 300 }, { id: "a", top: 300, height: 100 }, { id: "b", top: 400, height: 100 }]);
  assert.equal(corrected, 420);
  assert.equal(anchor.getReadingRowId(corrected), "b");
});

test("a piggery tool row carries the parsed Claude detail and status when the transcript has them", () => {
  const [call] = streamOfTranscript([{ i: 1, kind: "tool", at: 0, text: "Bash", tool: "Bash", detail: { type: "shell", command: "ls", output: "a" }, status: "completed" }]);
  assert.equal(call.kind === "tool_call" && call.payload.data.detail.type, "shell");
  assert.equal(call.kind === "tool_call" && call.payload.data.status, "completed");
});
