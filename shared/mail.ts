import { z } from "zod";

const PSEUDO_IDS = new Set(["notify", "board", "engine"]);

export const MailMessage = z.object({
  id: z.string(),
  seq: z.number().int(),
  team: z.string().optional(),
  from: z.string(),
  from_name: z.string(),
  from_role: z.string().optional(),
  to: z.string(),
  to_name: z.string(),
  to_role: z.string().optional(),
  kind: z.string().optional(),
  op: z.string().optional(),
  reply_to: z.string().optional(),
  reply_seq: z.number().int().optional(),
  body: z.string(),
  created_at: z.number(),
  acked_at: z.number().optional(),
  held: z.string().optional(),
});

export type MailMessage = z.infer<typeof MailMessage>;

export const MailTeam = z.object({ id: z.string(), name: z.string(), dir: z.string(), closed: z.number().optional() });

export type MailTeam = z.infer<typeof MailTeam>;

export const MailPage = z.object({ messages: z.array(MailMessage), teams: z.record(z.string(), MailTeam), total: z.number().int() });

export type MailPage = z.infer<typeof MailPage>;

export const MailFilter = z.object({
  teams: z.array(z.string()).optional(),
  participants: z.array(z.string()).optional(),
  participant: z.string().optional(),
  before: z.number().int().optional(),
  held: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});

export type MailFilter = z.output<typeof MailFilter>;

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
