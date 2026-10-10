import { closeSync, existsSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface AgentSession {
  agentId: string;
  sessionId: string;
  archived: boolean;
}

export interface KnownSession {
  id: string;
  ref: string | null;
  transcript: string | null;
}

export interface Link {
  participantId: string;
  agentId: string;
}

export interface LinkState {
  links: Link[];
  formerly: string[];
}

export interface LinkStoreIo {
  load: () => LinkState;
  save: (state: LinkState) => void;
}

const isLink = (value: unknown): value is Link => typeof (value as Link)?.participantId === "string" && typeof (value as Link)?.agentId === "string";

const SCAN_CHUNK_BYTES = 64 << 10;
const SCAN_OVERLAP_CHARS = 512;
const MAX_FORK_HOPS = 8;
const FORKED_FROM = /(?<!\\)"forkedFrom"\s*:\s*\{[^{}]*?"sessionId"\s*:\s*"([^"\\]+)"/;

export function forkParentOf(file: string): string | null {
  if (!existsSync(file)) return null;
  const fd = openSync(file, "r");
  try {
    const chunk = Buffer.alloc(SCAN_CHUNK_BYTES);
    let carry = "";
    let offset = 0;
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, offset);
      if (read === 0) return null;
      offset += read;
      const text = carry + chunk.toString("latin1", 0, read);
      const newline = text.indexOf("\n");
      const match = FORKED_FROM.exec(newline >= 0 ? text.slice(0, newline) : text);
      if (match) return match[1] ?? null;
      if (newline >= 0) return null;
      carry = text.slice(-SCAN_OVERLAP_CHARS);
    }
  } finally {
    closeSync(fd);
  }
}

export function linkStore(file: string): LinkStoreIo {
  return {
    load: () => {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
        if (Array.isArray(parsed)) return { links: parsed.filter(isLink), formerly: [] };
        const state = parsed as Partial<LinkState>;
        return { links: Array.isArray(state.links) ? state.links.filter(isLink) : [], formerly: Array.isArray(state.formerly) ? state.formerly.filter((id): id is string => typeof id === "string") : [] };
      } catch {
        return { links: [], formerly: [] };
      }
    },
    save: (state) => {
      try {
        writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
      } catch {}
    },
  };
}

export function createLinker({ store, readParent = forkParentOf }: { store: LinkStoreIo; readParent?: (file: string) => string | null }) {
  const ancestry = new Map<string, string[]>();
  const loaded = store.load();
  let links = new Map(loaded.links.map((link) => [link.participantId, link.agentId]));
  let everLinked = new Set([...loaded.formerly, ...links.keys()]);

  const ancestorsOf = (agent: AgentSession, dirs: string[], knownRefs: Set<string>): string[] => {
    const key = `${agent.agentId}:${agent.sessionId}`;
    const known = ancestry.get(key);
    if (known) return known;
    const found: string[] = [];
    for (const dir of dirs) {
      let session = agent.sessionId;
      for (let hop = 0; hop < MAX_FORK_HOPS; hop++) {
        const parent = readParent(path.join(dir, `${session}.jsonl`));
        if (!parent || found.includes(parent)) break;
        found.push(parent);
        if (knownRefs.has(parent)) break;
        session = parent;
      }
      if (found.length > 0) break;
    }
    ancestry.set(key, found);
    return found;
  };

  return {
    links(agents: AgentSession[], sessions: KnownSession[], missing: readonly string[] = []): LinkState {
      const exactAgent = new Map<string, string>();
      for (const agent of agents) if (!exactAgent.has(agent.sessionId)) exactAgent.set(agent.sessionId, agent.agentId);
      const next = new Map(links);
      const claimed = new Set<string>();
      const exactlyHeld = new Set<string>();
      for (const session of sessions) {
        const agentId = session.ref ? exactAgent.get(session.ref) : undefined;
        if (!agentId) continue;
        next.set(session.id, agentId);
        claimed.add(agentId);
        exactlyHeld.add(session.id);
      }
      for (const [participantId, agentId] of next) if (!exactlyHeld.has(participantId) && claimed.has(agentId)) next.delete(participantId);
      const deleted = new Set(missing);
      const forgotten = new Set<string>();
      for (const [participantId, agentId] of next) {
        if (exactlyHeld.has(participantId) || !deleted.has(agentId)) continue;
        next.delete(participantId);
        forgotten.add(participantId);
      }
      const unmatched = sessions.filter((session) => session.ref && !exactAgent.has(session.ref) && !next.has(session.id));
      if (unmatched.length > 0) {
        const byRef = new Map(unmatched.map((session) => [session.ref as string, session]));
        const dirs = [...new Set(unmatched.flatMap((session) => (session.transcript ? [path.dirname(session.transcript)] : [])))];
        const refs = new Set(sessions.flatMap((session) => (session.ref ? [session.ref] : [])));
        const linkedAgents = new Set(next.values());
        for (const agent of agents) {
          if (agent.archived || refs.has(agent.sessionId) || linkedAgents.has(agent.agentId)) continue;
          const participant = ancestorsOf(agent, dirs, refs).map((ancestor) => byRef.get(ancestor)).find((candidate) => candidate !== undefined);
          if (!participant || next.has(participant.id)) continue;
          next.set(participant.id, agent.agentId);
          linkedAgents.add(agent.agentId);
        }
      }
      const nextEver = new Set([...[...everLinked].filter((participantId) => !forgotten.has(participantId)), ...next.keys()]);
      const changed = nextEver.size !== everLinked.size || next.size !== links.size || [...next].some(([participantId, agentId]) => links.get(participantId) !== agentId);
      links = next;
      everLinked = nextEver;
      const state: LinkState = { links: [...links].map(([participantId, agentId]) => ({ participantId, agentId })), formerly: [...everLinked].filter((participantId) => !links.has(participantId)) };
      if (changed) store.save(state);
      return state;
    },
  };
}
