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

const HEAD_LIMIT_BYTES = 4 << 20;
const HEAD_CHUNK_BYTES = 64 << 10;
const MAX_FORK_HOPS = 8;

export function firstLine(file: string, limit = HEAD_LIMIT_BYTES): string | null {
  if (!existsSync(file)) return null;
  const fd = openSync(file, "r");
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total < limit) {
      const chunk = Buffer.alloc(Math.min(HEAD_CHUNK_BYTES, limit - total));
      const read = readSync(fd, chunk, 0, chunk.length, total);
      if (read === 0) break;
      const newline = chunk.subarray(0, read).indexOf(10);
      if (newline >= 0) {
        chunks.push(chunk.subarray(0, newline));
        return Buffer.concat(chunks).toString("utf8");
      }
      chunks.push(chunk.subarray(0, read));
      total += read;
    }
    return total < limit ? Buffer.concat(chunks).toString("utf8") : null;
  } finally {
    closeSync(fd);
  }
}

export function forkParentOf(file: string): string | null {
  const line = firstLine(file);
  if (!line) return null;
  try {
    const parent = (JSON.parse(line) as { forkedFrom?: { sessionId?: unknown } }).forkedFrom?.sessionId;
    return typeof parent === "string" ? parent : null;
  } catch {
    return null;
  }
}

export function linkStore(file: string): { load: () => Link[]; save: (links: Link[]) => void } {
  return {
    load: () => {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
        return Array.isArray(parsed) ? parsed.filter((link): link is Link => typeof link?.participantId === "string" && typeof link?.agentId === "string") : [];
      } catch {
        return [];
      }
    },
    save: (links) => {
      try {
        writeFileSync(file, JSON.stringify(links), { mode: 0o600 });
      } catch {}
    },
  };
}

export function createLinker({ store, readParent = forkParentOf }: { store: { load: () => Link[]; save: (links: Link[]) => void }; readParent?: (file: string) => string | null }) {
  const ancestry = new Map<string, string[]>();
  let links = new Map(store.load().map((link) => [link.participantId, link.agentId]));

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
    links(agents: AgentSession[], sessions: KnownSession[]): Link[] {
      const agentSessions = new Set(agents.map((agent) => agent.sessionId));
      const unmatched = sessions.filter((session) => session.ref && !agentSessions.has(session.ref));
      const byRef = new Map(unmatched.map((session) => [session.ref as string, session]));
      const dirs = [...new Set(unmatched.flatMap((session) => (session.transcript ? [path.dirname(session.transcript)] : [])))];
      const refs = new Set(sessions.flatMap((session) => (session.ref ? [session.ref] : [])));
      const next = new Map(links);
      const linkedAgents = new Set(next.values());
      if (unmatched.some((session) => !next.has(session.id))) {
        for (const agent of agents) {
          if (agent.archived || refs.has(agent.sessionId) || linkedAgents.has(agent.agentId)) continue;
          const participant = ancestorsOf(agent, dirs, refs).map((ancestor) => byRef.get(ancestor)).find((candidate) => candidate !== undefined);
          if (!participant || next.has(participant.id)) continue;
          next.set(participant.id, agent.agentId);
          linkedAgents.add(agent.agentId);
        }
      }
      const live = new Set(agents.filter((agent) => !agent.archived).map((agent) => agent.agentId));
      for (const [participantId, agentId] of next) if (!live.has(agentId)) next.delete(participantId);
      const changed = next.size !== links.size || [...next].some(([participantId, agentId]) => links.get(participantId) !== agentId);
      links = next;
      if (changed) store.save([...links].map(([participantId, agentId]) => ({ participantId, agentId })));
      return [...links].map(([participantId, agentId]) => ({ participantId, agentId }));
    },
  };
}
