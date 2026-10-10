import assert from "node:assert/strict";
import test from "node:test";
import { resolveComposerKey, resolvePrimaryActionKind, sendQueuedComposerMessageNow, submitAgentInput, type QueuedComposerMessage, type QueueWriter } from "./composer.ts";

function memoryQueue(initial: QueuedComposerMessage[]): QueueWriter & { items: () => QueuedComposerMessage[] } {
  let state = new Map([["a", initial]]);
  return { read: (id) => state.get(id) ?? [], write: (update) => (state = update(state)), items: () => state.get("a") ?? [] };
}

function harness(over: { isAgentRunning: boolean; forceSend?: boolean; fail?: boolean }) {
  const seen = { queued: [] as string[], sent: [] as string[], input: "draft", error: null as string | null, cleared: false };
  const run = submitAgentInput<string>({
    message: " hello ",
    attachments: ["img"],
    forceSend: over.forceSend,
    isAgentRunning: over.isAgentRunning,
    canSubmit: true,
    queueMessage: ({ message }) => seen.queued.push(message),
    submitMessage: async ({ message }) => {
      if (over.fail) throw new Error("down");
      seen.sent.push(message);
    },
    clearDraft: () => (seen.cleared = true),
    setUserInput: (text) => (seen.input = text),
    setAttachments: () => {},
    setSendError: (message) => (seen.error = message),
    setIsProcessing: () => {},
  });
  return { run, seen };
}

test("a running agent queues the message unless the send is forced, which steers it in", async () => {
  const queued = harness({ isAgentRunning: true });
  assert.equal(await queued.run, "queued");
  assert.deepEqual(queued.seen.queued, ["hello"]);
  const forced = harness({ isAgentRunning: true, forceSend: true });
  assert.equal(await forced.run, "submitted");
  assert.deepEqual(forced.seen.sent, ["hello"]);
  assert.equal(forced.seen.cleared, true);
});

test("a failed send puts the text back and shows the error", async () => {
  const { run, seen } = harness({ isAgentRunning: false, fail: true });
  assert.equal(await run, "failed");
  assert.equal(seen.input, "hello");
  assert.equal(seen.error, "down");
  assert.equal(seen.cleared, false);
});

test("a queued message that fails to send goes back to the front of the queue", async () => {
  const queue = memoryQueue([{ id: "1", text: "first", attachments: [] }, { id: "2", text: "second", attachments: [] }]);
  const result = await sendQueuedComposerMessageNow({ agentId: "a", messageId: "1", queue, submitMessage: async () => { throw new Error("busy"); } });
  assert.deepEqual(result, { status: "failed", errorMessage: "busy" });
  assert.deepEqual(queue.items().map((m) => m.id), ["1", "2"]);
});

test("compact layouts keep the send button with an empty input, but a running agent still shows stop", () => {
  const empty = { hasSendableContent: false, isSubmitLoading: false };
  assert.equal(resolvePrimaryActionKind({ ...empty, isAgentRunning: false, keepSendVisible: true }), "send");
  assert.equal(resolvePrimaryActionKind({ ...empty, isAgentRunning: false, keepSendVisible: false }), "none");
  assert.equal(resolvePrimaryActionKind({ ...empty, isAgentRunning: true, keepSendVisible: true }), "active");
});

const key = (over: Partial<Parameters<typeof resolveComposerKey>[0]>) => resolveComposerKey({ key: "Escape", primary: false, shift: false, alt: false, focus: "input", dictation: "idle", isAgentRunning: true, isCancelling: false, ...over });

test("Escape cancels a recording before it would stop the agent, and stops nothing from another input or dialog", () => {
  assert.equal(key({ dictation: "recording" }), "dictation-cancel");
  assert.equal(key({ focus: "pane" }), "interrupt");
  assert.equal(key({ focus: "outside" }), null);
});
