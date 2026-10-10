import { z } from "zod";
import { Usage } from "./context-meter.ts";
import { ToolCallDetail, ToolError } from "./tool-call.ts";

const SHOWN_KINDS = ["run-start", "user", "wake", "assistant", "thinking", "tool", "mail", "turn-end", "compaction"] as const;

const TOOL_CALL_STATUSES = ["running", "completed", "failed", "canceled"] as const;

export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

export const ShownItem = z.object({
  i: z.number().int(),
  key: z.string().optional(),
  kind: z.enum(SHOWN_KINDS),
  at: z.number().optional(),
  text: z.string(),
  tool: z.string().optional(),
  error: z.boolean().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  ref: z.string().optional(),
  reply: z.string().optional(),
  run: z.string().optional(),
  note: z.string().optional(),
  detail: ToolCallDetail.optional(),
  status: z.enum(TOOL_CALL_STATUSES).optional(),
  toolError: ToolError.optional(),
  durationMs: z.number().optional(),
  costUsd: z.number().optional(),
  trigger: z.enum(["auto", "manual"]).optional(),
  preTokens: z.number().optional(),
  images: z.array(z.string()).optional(),
  outgoing: z.boolean().optional(),
});

export type ShownItem = z.infer<typeof ShownItem>;

export type ShownKind = ShownItem["kind"];

export type ItemKind = ShownKind | "delivery";

export type Item = Omit<ShownItem, "kind"> & { kind: ItemKind; redelivered?: boolean };

export interface ToolCall {
  detail: ToolCallDetail;
  status: ToolCallStatus;
  toolError?: unknown;
}

export const Transcript = z.object({
  items: z.array(ShownItem),
  total: z.number().int(),
  name: z.string(),
  role: z.string().optional(),
  files: z.number().int(),
  roles: z.record(z.string(), z.string()).optional(),
  usage: Usage.optional(),
  epoch: z.string().optional(),
  rev: z.number().int().optional(),
  from: z.number().int().optional(),
});

export type Transcript = z.infer<typeof Transcript>;

export function withIncrement(had: ShownItem[], next: { items: ShownItem[]; from?: number }, limit: number): ShownItem[] {
  if (next.from === undefined) return next.items;
  const from = next.from;
  if (next.items.length === 0 && (had[had.length - 1]?.i ?? -1) < from) return had;
  const merged = [...had.filter((item) => item.i < from), ...next.items];
  return merged.slice(Math.max(0, merged.length - limit));
}
