import { useSyncExternalStore } from "react";
import type { QueuedComposerMessage, QueueWriter } from "../shared/composer.ts";

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
