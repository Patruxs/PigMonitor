import { useSyncExternalStore } from "react";
import { createQueueDrainer, splitAttachmentsForSubmit, type QueuedComposerMessage, type QueueWriter } from "../shared/composer.ts";
import { sendToAgent, type PaseoApi } from "./native.tsx";
import { BUSY_MS } from "./poll.ts";

const EMPTY: QueuedComposerMessage[] = [];

let queues = new Map<string, QueuedComposerMessage[]>();
const listeners = new Set<() => void>();

export const queueWriter: QueueWriter = {
  read: (agentId) => queues.get(agentId) ?? EMPTY,
  write: (updater) => {
    queues = updater(queues);
    for (const listener of listeners) listener();
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useQueuedMessages(agentId: string | undefined): QueuedComposerMessage[] {
  return useSyncExternalStore(
    subscribe,
    () => (agentId ? queueWriter.read(agentId) : EMPTY),
    () => EMPTY,
  );
}

const drainer = createQueueDrainer(queueWriter);

export function drainWhenIdle(paseo: PaseoApi, agentId: string): void {
  const handle = paseo.agents.ref(agentId);
  drainer.watch(
    agentId,
    {
      status: () => handle.current()?.status ?? null,
      subscribe: (listener) => {
        const unsubscribe = handle.subscribe((update) => {
          if (update.kind === "upsert") listener(update.agent.status);
        });
        const timer = setInterval(() => {
          void handle.refresh().then(
            (result) => result && listener(result.agent.status),
            () => undefined,
          );
        }, BUSY_MS);
        return () => {
          clearInterval(timer);
          unsubscribe();
        };
      },
    },
    async (message) => {
      const wire = splitAttachmentsForSubmit(message.attachments);
      const failed = await sendToAgent(paseo, agentId, message.text, wire.images, wire.attachments, message.id);
      if (failed) throw new Error(failed);
    },
  );
}
