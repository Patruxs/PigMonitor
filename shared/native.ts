import type { Row } from "./view.ts";

export interface Session {
  id: string;
  ref: string | null;
  harness: string | null;
  mode: string | null;
  cwd: string;
  gone: boolean;
  state: string;
  teamClosed: boolean;
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

export interface StepIns {
  kill: boolean;
  model: boolean;
  resume: boolean;
}

export function stepInsOf(row: Pick<Row, "kind" | "actions">, session: Session | undefined): StepIns {
  const stopped = session?.state === "gone" || session?.state === "parked";
  return {
    kill: row.actions?.kill === true,
    model: row.actions?.pick === true,
    resume: row.kind === "member" && session?.mode === "headless" && !session.teamClosed && stopped,
  };
}

export function releasable(message: { held?: string; team?: string }, teams: Record<string, { closed?: number }>): boolean {
  return message.held !== undefined && !(message.team !== undefined && teams[message.team]?.closed !== undefined);
}
