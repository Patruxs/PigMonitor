import { messageOf } from "../../shared/errors.ts";
import type { ComposerAttachment } from "./attachment.ts";
import { FAILED_TO_SEND } from "./submit.ts";

export interface QueuedComposerMessage {
  id: string;
  text: string;
  attachments: ComposerAttachment[];
}

export interface QueueWriter {
  read: (queueKey: string) => QueuedComposerMessage[];
  write: (updater: (prev: Map<string, QueuedComposerMessage[]>) => Map<string, QueuedComposerMessage[]>) => void;
}

function withQueue(queueKey: string, update: (queue: QueuedComposerMessage[]) => QueuedComposerMessage[]) {
  return (prev: Map<string, QueuedComposerMessage[]>) => {
    const next = new Map(prev);
    next.set(queueKey, update(prev.get(queueKey) ?? []));
    return next;
  };
}

export function queueComposerMessage(input: { queueKey: string; id: string; text: string; attachments: ComposerAttachment[]; queue: QueueWriter }): QueuedComposerMessage | null {
  const trimmed = input.text.trim();
  if (!trimmed && input.attachments.length === 0) return null;
  const item: QueuedComposerMessage = { id: input.id, text: trimmed, attachments: input.attachments };
  input.queue.write(withQueue(input.queueKey, (queue) => [...queue, item]));
  return item;
}

export function editQueuedComposerMessage(input: { queueKey: string; messageId: string; queue: QueueWriter }): { text: string; attachments: ComposerAttachment[] } | null {
  const item = input.queue.read(input.queueKey).find((q) => q.id === input.messageId);
  if (!item) return null;
  input.queue.write(withQueue(input.queueKey, (queue) => queue.filter((q) => q.id !== input.messageId)));
  return { text: item.text, attachments: item.attachments };
}

export type SendQueuedNowResult = { status: "missing" } | { status: "submitted" } | { status: "failed"; errorMessage: string };

export async function sendQueuedComposerMessageNow(input: { queueKey: string; messageId: string; queue: QueueWriter; submitMessage: (input: { text: string; attachments: ComposerAttachment[] }) => Promise<void> }): Promise<SendQueuedNowResult> {
  const item = input.queue.read(input.queueKey).find((q) => q.id === input.messageId);
  if (!item) return { status: "missing" };
  input.queue.write(withQueue(input.queueKey, (queue) => queue.filter((q) => q.id !== input.messageId)));
  try {
    await input.submitMessage({ text: item.text, attachments: item.attachments });
    return { status: "submitted" };
  } catch (error) {
    input.queue.write(withQueue(input.queueKey, (queue) => [item, ...queue]));
    return { status: "failed", errorMessage: messageOf(error, FAILED_TO_SEND) };
  }
}

export interface AgentStatusFeed {
  status: () => string | null;
  subscribe: (listener: (status: string | null) => void) => () => void;
}

export function createQueueDrainer(queue: QueueWriter) {
  const watches = new Map<string, { source: string; stop: () => void }>();
  return {
    watch(queueKey: string, source: string, feed: AgentStatusFeed, submit: (message: QueuedComposerMessage) => Promise<void>): void {
      const watching = watches.get(queueKey);
      if (watching?.source === source) return;
      watching?.stop();
      let last = feed.status();
      let inFlight = false;
      let unsubscribe = () => {};
      const stop = () => {
        unsubscribe();
        if (watches.get(queueKey)?.stop === stop) watches.delete(queueKey);
      };
      const drain = () => {
        if (inFlight) return;
        const next = queue.read(queueKey)[0];
        if (!next) return stop();
        inFlight = true;
        void sendQueuedComposerMessageNow({ queueKey, messageId: next.id, queue, submitMessage: ({ text, attachments }) => submit({ id: next.id, text, attachments }) })
          .then((result) => {
            if (result.status === "failed") console.error("[PigMonitor] failed to drain queued agent message", { queueKey, source, error: result.errorMessage });
          })
          .finally(() => {
            inFlight = false;
            if (queue.read(queueKey).length === 0) stop();
          });
      };
      watches.set(queueKey, { source, stop });
      unsubscribe = feed.subscribe((status) => {
        const stoppedRunning = last === "running" && status !== "running";
        last = status;
        if (stoppedRunning) drain();
      });
      if (last !== null && last !== "running") drain();
    },
  };
}
