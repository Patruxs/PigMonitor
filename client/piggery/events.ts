import { readAge } from "../../shared/format.ts";

export type EventTone = "muted" | "warning" | "danger";

export interface EventInput {
  who: string;
  type: string;
  target?: string;
  tone: EventTone;
}
export interface Sentence {
  actor?: string;
  verb: string;
  object?: string;
  icon: string;
}

const VERBS: Record<string, { verb: string; icon: string; withTarget?: string }> = {
  team_up: { verb: "came up", icon: "Users" },
  team_down: { verb: "went down", icon: "Users" },
  closed: { verb: "closed", icon: "Archive", withTarget: "closed" },
  reopened: { verb: "reopened", icon: "Archive", withTarget: "reopened" },
  spawned: { verb: "spawned", icon: "Sparkles", withTarget: "spawned" },
  stopped: { verb: "stopped", icon: "Square" },
  exited: { verb: "exited unexpectedly", icon: "TriangleAlert" },
  killed: { verb: "was killed", icon: "Square", withTarget: "killed" },
  notice: { verb: "posted a notice", icon: "Bell", withTarget: "posted notice" },
  timeout: { verb: "timed out", icon: "Clock" },
  waiting: { verb: "is waiting on you", icon: "Hand" },
  permission: { verb: "asks for permission", icon: "Hand" },
  held: { verb: "held mail", icon: "Lock", withTarget: "held mail for" },
  released: { verb: "released mail", icon: "Unlock", withTarget: "released mail for" },
  joined: { verb: "joined", icon: "UserPlus", withTarget: "joined" },
  left: { verb: "left", icon: "UserMinus", withTarget: "left" },
  admitted: { verb: "admitted", icon: "UserPlus", withTarget: "admitted" },
  assign: { verb: "assigned work", icon: "Mail", withTarget: "assigned work to" },
  gc: { verb: "was cleaned up", icon: "Trash2" },
};

const TONE_ICON: Record<EventTone, string | undefined> = { muted: undefined, warning: "TriangleAlert", danger: "TriangleAlert" };
export function sentenceOf(e: EventInput): Sentence {
  const known = VERBS[e.type];
  const icon = known?.icon ?? TONE_ICON[e.tone] ?? "Activity";
  const actor = e.who || undefined;
  if (!known) {
    return { actor, verb: e.type.replace(/_/g, " "), object: e.target || undefined, icon };
  }
  if (e.type === "team_up" || e.type === "team_down") {
    return { actor: actor ?? e.target, verb: actor ? known.verb : e.target ? known.verb : `A team ${known.verb}`, object: actor && e.target ? e.target : undefined, icon };
  }
  if (!actor) {
    return { verb: `${capital(known.verb)}${e.target ? "" : ""}`, object: e.target || undefined, icon };
  }
  return { actor, verb: e.target && known.withTarget ? known.withTarget : known.verb, object: e.target || undefined, icon };
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface StatusCounts {
  working: number;
  waiting: number;
  idle: number;
  gone: number;
}

export const NO_COUNTS: StatusCounts = { working: 0, waiting: 0, idle: 0, gone: 0 };
export function countStatuses(rows: { kind: string; status: string }[]): StatusCounts {
  const out = { ...NO_COUNTS };
  for (const r of rows) {
    if (r.kind !== "member" && r.kind !== "solo") continue;
    if (r.status in out) out[r.status as keyof StatusCounts] += 1;
  }
  return out;
}
export function agents(n: number): string {
  return `${n} ${n === 1 ? "agent" : "agents"}`;
}
export function headlineOf(s: { working: number; idle: number; waiting?: number }): { text: string; tone: "warning" | "success" | "muted" } {
  const waiting = s.waiting ?? 0;
  if (waiting > 0) return { text: `${agents(waiting)} ${waiting === 1 ? "needs" : "need"} your attention`, tone: "warning" };
  if (s.working > 0) return { text: `${agents(s.working)} working${s.idle > 0 ? `, ${s.idle} idle` : ""}`, tone: "success" };
  if (s.idle > 0) return { text: `All quiet · ${agents(s.idle)} idle`, tone: "muted" };
  return { text: "Nothing is running", tone: "muted" };
}
export function basenameOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
export const readAgo = readAge;
