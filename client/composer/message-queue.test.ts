import assert from "node:assert/strict";
import test from "node:test";
import { createQueueDrainer, sendQueuedComposerMessageNow, type QueuedComposerMessage, type QueueWriter } from "./message-queue.ts";

function memoryQueue(initial: QueuedComposerMessage[]): QueueWriter & { items: () => QueuedComposerMessage[] } {
  let state = new Map([["a", initial]]);
  return { read: (id) => state.get(id) ?? [], write: (update) => (state = update(state)), items: () => state.get("a") ?? [] };
}

test("a queued message that fails to send goes back to the front of the queue", async () => {
  const queue = memoryQueue([{ id: "1", text: "first", attachments: [] }, { id: "2", text: "second", attachments: [] }]);
  const result = await sendQueuedComposerMessageNow({ queueKey: "a", messageId: "1", queue, submitMessage: async () => { throw new Error("busy"); } });
  assert.deepEqual(result, { status: "failed", errorMessage: "busy" });
  assert.deepEqual(queue.items().map((m) => m.id), ["1", "2"]);
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
