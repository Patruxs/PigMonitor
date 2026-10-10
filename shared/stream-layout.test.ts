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

test("piggery mail starts a new turn like a prompt, and pasted image lines become image attachments", () => {
  const stream = streamOfTranscript([
    { i: 1, kind: "user", at: 0, text: "look\n[image: /tmp/a.png]", note: "Sent" },
    { i: 2, kind: "assistant", at: 1000, text: "seen" },
    { i: 3, kind: "mail", at: 2000, text: "from the lead", from: "squid", ref: "#4" },
    { i: 4, kind: "assistant", at: 3000, text: "ok" },
  ]);
  const user = stream[0];
  assert.equal(user.kind === "user_message" && user.text, "look");
  assert.deepEqual(user.kind === "user_message" && user.images?.map((image) => image.path), ["/tmp/a.png"]);
  const layout = layoutStream({ isTurnActive: false, history: stream, liveHead: [], timing: new Map() });
  assert.equal(layout.history[1].completedFooter?.itemId, "assistant::2");
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
  const [call] = streamOfTranscript([{ i: 1, kind: "tool", at: 0, text: "Bash", tool: "Bash", input: "command=ls", result: "a", detail: { type: "shell", command: "ls", output: "a" }, status: "completed" }]);
  assert.equal(call.kind === "tool_call" && call.payload.data.detail.type, "shell");
  assert.equal(call.kind === "tool_call" && call.payload.data.status, "completed");
});
