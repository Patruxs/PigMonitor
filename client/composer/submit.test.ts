import assert from "node:assert/strict";
import test from "node:test";
import { resolvePrimaryActionKind, submitAgentInput } from "./submit.ts";

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

test("compact layouts keep the send button with an empty input, but a running agent still shows stop", () => {
  const empty = { hasSendableContent: false, isSubmitLoading: false };
  assert.equal(resolvePrimaryActionKind({ ...empty, isAgentRunning: false, keepSendVisible: true }), "send");
  assert.equal(resolvePrimaryActionKind({ ...empty, isAgentRunning: false, keepSendVisible: false }), "none");
  assert.equal(resolvePrimaryActionKind({ ...empty, isAgentRunning: true, keepSendVisible: true }), "active");
});
