const PSEUDO_IDS = new Set(["notify", "board", "engine"]);

export interface MailMessage {
  id: string;
  seq: number;
  team?: string;
  from: string;
  from_name: string;
  from_role?: string;
  to: string;
  to_name: string;
  to_role?: string;
  kind?: string;
  op?: string;
  reply_to?: string;
  reply_seq?: number;
  body: string;
  created_at: number;
  acked_at?: number;
  held?: string;
}

export interface MailTeam {
  id: string;
  name: string;
  dir: string;
  closed?: number;
}

export interface MailPage {
  messages: MailMessage[];
  teams: Record<string, MailTeam>;
  total: number;
}

export interface MailFilter {
  teams?: string[];
  participants?: string[];
  participant?: string;
  before?: number;
  held?: boolean;
  limit: number;
}

export const HUMAN = "human";

const ROLE_PALETTE: Record<string, string> = {
  supervisor: "#a78bfa",
  chair: "#a78bfa",
  lead: "#38bdf8",
  peer: "#34d399",
  executor: "#2dd4bf",
  member: "#2dd4bf",
  advisor: "#f472b6",
  oracle: "#f472b6",
  reviewer: "#f472b6",
};

export type Paint = { kind: "hex"; value: string } | { kind: "token"; value: "accent" | "foregroundMuted" };

export function roleColour(role: string | undefined, id: string): Paint {
  if (role === HUMAN) return { kind: "token", value: "accent" };
  if (PSEUDO_IDS.has(id) || !role) return { kind: "token", value: "foregroundMuted" };
  const hex = ROLE_PALETTE[role];
  return hex ? { kind: "hex", value: hex } : { kind: "token", value: "foregroundMuted" };
}

export function roleWord(role: string | undefined, id: string): string {
  if (role === HUMAN) return "Human";
  if (PSEUDO_IDS.has(id)) return id;
  return role ?? "solo";
}

export function previewOf(body: string): string {
  return body.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}
