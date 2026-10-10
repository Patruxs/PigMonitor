import { z } from "zod";
import type { Row } from "./view.ts";

export const ParticipantRecord = z.object({ id: z.string(), ref: z.string().nullable(), harness: z.string().nullable(), mode: z.string().nullable(), cwd: z.string(), gone: z.boolean(), state: z.string(), teamClosed: z.boolean() });

export type ParticipantRecord = z.infer<typeof ParticipantRecord>;

export type ChatRoute = { kind: "open"; agentId: string } | { kind: "resume" } | { kind: "mail"; why: string };

export function resumable(participant: ParticipantRecord): boolean {
  return participant.gone && participant.harness === "claude" && !!participant.ref && !!participant.cwd;
}

export function chatRouteOf(participant: ParticipantRecord | undefined, agentId: string | undefined): ChatRoute {
  if (agentId) return { kind: "open", agentId };
  if (!participant) return { kind: "mail", why: "a session piggery knows no harness session for" };
  if (resumable(participant)) return { kind: "resume" };
  if (participant.gone) return { kind: "mail", why: `an ended ${participant.harness ?? "agent"} session` };
  if (participant.mode === "headless") return { kind: "mail", why: "a headless piggery worker" };
  if (participant.harness !== "claude") return { kind: "mail", why: `a ${participant.harness ?? "non-claude"} session outside Paseo` };
  return { kind: "mail", why: "a claude session running outside Paseo" };
}

export interface PaseoHeld {
  agentId: string;
  busy: boolean | null;
}

export function paseoBusyOf(agent: { status: string; activeTurn?: unknown } | null | undefined): boolean | null {
  if (!agent) return null;
  if (agent.status === "running" || agent.activeTurn) return true;
  return agent.status === "idle" || agent.status === "error" || agent.status === "closed" ? false : null;
}

export function agentsBySession(entries: { agent: { id: string; provider: string; status: string; activeTurn?: unknown; persistence?: { sessionId?: string } | null } }[]): Map<string, PaseoHeld> {
  const out = new Map<string, PaseoHeld>();
  for (const { agent } of entries) {
    const ref = agent.persistence?.sessionId;
    if (ref && agent.provider.startsWith("claude") && !out.has(ref)) out.set(ref, { agentId: agent.id, busy: paseoBusyOf(agent) });
  }
  return out;
}

export interface ListedAgent extends PaseoHeld {
  archived: boolean;
}

export function agentsById(entries: { agent: { id: string; status: string; activeTurn?: unknown; archivedAt?: string | null } }[]): Map<string, ListedAgent> {
  return new Map(entries.map(({ agent }) => [agent.id, { agentId: agent.id, busy: paseoBusyOf(agent), archived: Boolean(agent.archivedAt) }]));
}

export function heldAgentOf(participant: Pick<ParticipantRecord, "id" | "ref"> | undefined, byRef: ReadonlyMap<string, PaseoHeld>, linked: ReadonlyMap<string, string>, byAgent: ReadonlyMap<string, ListedAgent>): PaseoHeld | undefined {
  if (!participant) return undefined;
  const matched = participant.ref ? byRef.get(participant.ref) : undefined;
  if (matched) return matched;
  const agentId = linked.get(participant.id);
  return agentId ? { agentId, busy: byAgent.get(agentId)?.busy ?? null } : undefined;
}

export type SendTarget = { kind: "prompt"; agentId: string } | { kind: "mail" } | { kind: "error"; message: string };

export function sendTargetOf(route: ChatRoute, reachable: boolean, agentNowHeldBy: string | null = null): SendTarget {
  if (route.kind !== "open") return agentNowHeldBy !== null ? { kind: "error", message: `This session's Paseo agent now belongs to ${agentNowHeldBy}, so nothing was sent. Write to ${agentNowHeldBy} instead.` } : { kind: "mail" };
  return reachable ? { kind: "prompt", agentId: route.agentId } : { kind: "error", message: "This session's Paseo agent can't be reached right now, so nothing was sent." };
}

export function abortable(state: string): boolean {
  return state === "working" || state === "awaiting_permission";
}

export interface Turn {
  active: boolean;
  meterStatus: string;
}

export function withPaseoBusy<R extends Pick<Row, "state" | "status" | "state_text">>(row: R, paseoBusy: boolean | null): R {
  if (paseoBusy === null || row.status === "gone" || paseoBusy === abortable(row.state)) return row;
  return paseoBusy ? { ...row, state: "working", status: "working", state_text: "working" } : { ...row, state: "idle", status: "idle", state_text: "idle" };
}

export function turnOf(row: Pick<Row, "state" | "status">): Turn {
  const active = abortable(row.state);
  return { active, meterStatus: active ? "running" : row.status };
}

export interface StepIns {
  kill: boolean;
  model: boolean;
  resume: boolean;
}

export function stepInsOf(row: Pick<Row, "kind" | "actions">, participant: ParticipantRecord | undefined): StepIns {
  const stopped = participant?.state === "gone" || participant?.state === "parked";
  return {
    kill: row.actions?.kill === true,
    model: row.actions?.pick === true,
    resume: row.kind === "member" && participant?.mode === "headless" && !participant.teamClosed && stopped,
  };
}

export function releasable(message: { held?: string; team?: string }, teams: Record<string, { closed?: number }>): boolean {
  return message.held !== undefined && !(message.team !== undefined && teams[message.team]?.closed !== undefined);
}
