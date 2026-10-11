import { usePaseo } from "@getpaseo/plugin/client";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { AgentStatusFeed } from "../composer/composer-input.ts";
import { BUSY_MS } from "../kit/poll.ts";

export type PaseoApi = ReturnType<typeof usePaseo>;
export type AgentHandle = ReturnType<PaseoApi["agents"]["ref"]>;
export type PaseoAgent = NonNullable<ReturnType<AgentHandle["current"]>>;

interface LiveEntry {
  handle: AgentHandle;
  agent: PaseoAgent | null;
  listeners: Set<() => void>;
  detach: (() => void) | null;
}

const entries = new Map<string, LiveEntry>();

function entryOf(paseo: PaseoApi, agentId: string): LiveEntry {
  const known = entries.get(agentId);
  if (known) return known;
  const handle = paseo.agents.ref(agentId);
  const entry: LiveEntry = { handle, agent: handle.current(), listeners: new Set(), detach: null };
  entries.set(agentId, entry);
  return entry;
}

function publish(entry: LiveEntry, agent: PaseoAgent): void {
  if (entry.agent === agent) return;
  entry.agent = agent;
  for (const listener of [...entry.listeners]) listener();
}

function refreshEntry(entry: LiveEntry): Promise<void> {
  return entry.handle.refresh().then(
    (result) => {
      if (result) publish(entry, result.agent);
    },
    () => undefined,
  );
}

function attach(entry: LiveEntry, listener: () => void): () => void {
  entry.listeners.add(listener);
  if (!entry.detach) {
    const unsubscribe = entry.handle.subscribe((update) => {
      if (update.kind === "upsert") publish(entry, update.agent);
    });
    const timer = setInterval(() => void refreshEntry(entry), BUSY_MS);
    void refreshEntry(entry);
    entry.detach = () => {
      clearInterval(timer);
      unsubscribe();
    };
  }
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size > 0 || !entry.detach) return;
    entry.detach();
    entry.detach = null;
  };
}

const NOTHING = () => () => {};

interface LiveAgent {
  agent: PaseoAgent | null;
  refresh: () => Promise<void>;
  accept: (agent: PaseoAgent) => void;
}

export function useLiveAgent(agentId: string | null): LiveAgent {
  const paseo = usePaseo();
  const entry = useMemo(() => (agentId ? entryOf(paseo, agentId) : null), [paseo, agentId]);
  const subscribe = useCallback((listener: () => void) => (entry ? attach(entry, listener) : NOTHING()), [entry]);
  const agent = useSyncExternalStore(subscribe, () => entry?.agent ?? null, () => null);
  const actions = useMemo(() => ({ refresh: () => (entry ? refreshEntry(entry) : Promise.resolve()), accept: (next: PaseoAgent) => void (entry && publish(entry, next)) }), [entry]);
  return { agent, ...actions };
}

export function agentStatusFeed(paseo: PaseoApi, agentId: string): AgentStatusFeed {
  const entry = entryOf(paseo, agentId);
  return {
    status: () => entry.agent?.status ?? null,
    subscribe: (listener) => attach(entry, () => listener(entry.agent?.status ?? null)),
  };
}
