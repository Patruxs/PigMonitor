import assert from "node:assert/strict";
import test from "node:test";
import { createQueueDrainer, isMacLike, resolveComposerKey, resolvePrimaryActionKind, restoreComposerIfEmpty, rewoundImageOf, sendQueuedComposerMessageNow, submitAgentInput, type QueuedComposerMessage, type QueueWriter } from "./composer-input.ts";

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
  const result = await sendQueuedComposerMessageNow({ queueKey: "a", messageId: "1", queue, submitMessage: async () => { throw new Error("busy"); } });
  assert.deepEqual(result, { status: "failed", errorMessage: "busy" });
  assert.deepEqual(queue.items().map((m) => m.id), ["1", "2"]);
});

test("compact layouts keep the send button with an empty input, but a running agent still shows stop", () => {
  const empty = { hasSendableContent: false, isSubmitLoading: false };
  assert.equal(resolvePrimaryActionKind({ ...empty, isAgentRunning: false, keepSendVisible: true }), "send");
  assert.equal(resolvePrimaryActionKind({ ...empty, isAgentRunning: false, keepSendVisible: false }), "none");
  assert.equal(resolvePrimaryActionKind({ ...empty, isAgentRunning: true, keepSendVisible: true }), "active");
});

const key = (over: Partial<Parameters<typeof resolveComposerKey>[0]>) => resolveComposerKey({ key: "Escape", primary: false, shift: false, alt: false, focus: "input", dictation: "idle", isAgentRunning: true, isCancelling: false, canCycleMode: false, ...over });

test("Escape cancels a recording before it would stop the agent, and stops nothing from another input or dialog", () => {
  assert.equal(key({ dictation: "recording" }), "dictation-cancel");
  assert.equal(key({ focus: "pane" }), "interrupt");
  assert.equal(key({ focus: "outside" }), null);
});

test("Cmd/Ctrl+D toggles dictation and Enter while recording confirms and sends", () => {
  assert.equal(key({ key: "d", primary: true, focus: "pane" }), "dictation-toggle");
  assert.equal(key({ key: "Enter", dictation: "recording" }), "dictation-send");
  assert.equal(key({ key: "Enter" }), null);
});

test("Shift+Tab in the message box cycles the agent's mode when it has modes to cycle", () => {
  assert.equal(key({ key: "Tab", shift: true, canCycleMode: true }), "mode-cycle");
  assert.equal(key({ key: "Tab", shift: true, canCycleMode: true, focus: "pane" }), null);
  assert.equal(key({ key: "Tab", shift: true }), null);
});

test("a queued message is sent when its agent stops running, with no composer on screen", async () => {
  const queue = memoryQueue([{ id: "q1", text: "next task", attachments: [] }]);
  const listeners = new Set<(status: string | null) => void>();
  const sent: string[] = [];
  createQueueDrainer(queue).watch("a", "agent-1", { status: () => "running", subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)) }, async (message) => {
    sent.push(message.text);
  });
  assert.deepEqual(sent, []);
  for (const listener of [...listeners]) listener("idle");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual({ sent, left: queue.items().length, watching: listeners.size }, { sent: ["next task"], left: 0, watching: 0 });
});

test("after a resume the participant's queue drains to the new agent, not the old one", async () => {
  const queue = memoryQueue([{ id: "q1", text: "next task", attachments: [] }]);
  const feed = (status: string) => {
    const listeners = new Set<(status: string | null) => void>();
    return { listeners, feed: { status: () => status, subscribe: (listener: (status: string | null) => void) => (listeners.add(listener), () => listeners.delete(listener)) } };
  };
  const old = feed("running");
  const fresh = feed("running");
  const sent: string[] = [];
  const drainer = createQueueDrainer(queue);
  drainer.watch("a", "agent-1", old.feed, async (message) => void sent.push(`agent-1:${message.text}`));
  drainer.watch("a", "agent-2", fresh.feed, async (message) => void sent.push(`agent-2:${message.text}`));
  for (const listener of [...fresh.listeners]) listener("idle");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual({ sent, oldWatched: old.listeners.size }, { sent: ["agent-2:next task"], oldWatched: 0 });
});

test("Apple keyboards use ⌘ for find and focus on a Mac, an iPad and an iPhone alike, and Ctrl elsewhere", () => {
  assert.deepEqual([{ platform: "MacIntel" }, { platform: "iPad" }, { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }, { platform: "Win32" }, { platform: "Linux x86_64" }, undefined].map(isMacLike), [true, true, true, false, false, false]);
});

test("a rewind puts the prompt's text and images back into an empty composer and leaves a started draft alone", () => {
  const image = rewoundImageOf({ id: "i1" }, "data:image/jpeg;base64,AAAA", 0);
  assert.deepEqual(image.kind === "image" ? [image.metadata.mimeType, image.metadata.dataUrl] : null, ["image/jpeg", "data:image/jpeg;base64,AAAA"]);
  const rewound = { text: "look at this", attachments: [image] };
  assert.deepEqual(restoreComposerIfEmpty({ text: "", attachments: [] }, rewound), rewound);
  const draft = { text: "half typed", attachments: [] };
  assert.equal(restoreComposerIfEmpty(draft, rewound), draft);
});
