import { z } from "zod";
import { ROLE_KEYS, type RoleKey } from "./palette.ts";

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

export const MailPage = z.object({ messages: z.array(MailMessage), teams: z.record(z.string(), MailTeam) });

export type MailPage = z.infer<typeof MailPage>;

export const MailFilter = z.object({
  participants: z.array(z.string()).optional(),
  participant: z.string().optional(),
  held: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});

export type MailFilter = z.output<typeof MailFilter>;

export const HUMAN = "human";

export type Paint = { kind: "role"; value: RoleKey } | { kind: "token"; value: "accent" | "foregroundMuted" };

export function roleColour(role: string | undefined, id: string): Paint {
  if (role === HUMAN) return { kind: "token", value: "accent" };
  if (PSEUDO_IDS.has(id) || !role) return { kind: "token", value: "foregroundMuted" };
  const key = ROLE_KEYS[role];
  return key ? { kind: "role", value: key } : { kind: "token", value: "foregroundMuted" };
}

export function roleWord(role: string | undefined, id: string): string {
  if (role === HUMAN) return "Human";
  if (PSEUDO_IDS.has(id)) return id;
  return role ?? "solo";
}

export function previewOf(body: string): string {
  return body.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

export interface Me {
  id: string;
  name: string;
}

export function replyTarget(messages: MailMessage[], id: string): MailMessage | undefined {
  return messages.filter((m) => m.from === id).sort((a, b) => b.seq - a.seq)[0];
}
