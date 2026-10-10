export interface Session {
  id: string;
  ref: string | null;
  harness: string | null;
  mode: string | null;
  cwd: string;
  gone: boolean;
}

export type Native = { kind: "open"; agentId: string } | { kind: "resume" } | { kind: "mail"; why: string };

export function resumable(session: Session): boolean {
  return session.gone && session.harness === "claude" && !!session.ref && !!session.cwd;
}

export function nativeOf(session: Session | undefined, agentId: string | undefined): Native {
  if (agentId) return { kind: "open", agentId };
  if (!session) return { kind: "mail", why: "a session piggery knows no harness session for" };
  if (resumable(session)) return { kind: "resume" };
  if (session.gone) return { kind: "mail", why: `an ended ${session.harness ?? "agent"} session` };
  if (session.mode === "headless") return { kind: "mail", why: "a headless piggery worker" };
  if (session.harness !== "claude") return { kind: "mail", why: `a ${session.harness ?? "non-claude"} session outside Paseo` };
  return { kind: "mail", why: "a claude session running outside Paseo" };
}

export function agentsBySession(entries: { agent: { id: string; provider: string; persistence?: { sessionId?: string } | null } }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const { agent } of entries) {
    const ref = agent.persistence?.sessionId;
    if (ref && agent.provider.startsWith("claude") && !out.has(ref)) out.set(ref, agent.id);
  }
  return out;
}

export function abortable(state: string): boolean {
  return state === "working" || state === "awaiting_permission";
}
