import { z } from "zod";

const Tone = z.enum(["default", "ok", "warning", "danger"]);

const UsageWindow = z.object({
  id: z.string(),
  label: z.string(),
  shortLabel: z.string().optional(),
  summary: z.boolean().optional(),
  usedPct: z.number().nullable().optional(),
  remainingPct: z.number().nullable().optional(),
  resetsAt: z.string().nullable().optional(),
  runsOutAt: z.string().nullable().optional(),
  shortfallPct: z.number().nullable().optional(),
  tone: Tone.optional(),
});

const UsageBalance = z.object({
  id: z.string(),
  label: z.string(),
  used: z.number().nullable().optional(),
  remaining: z.number().nullable().optional(),
  limit: z.number().nullable().optional(),
  unit: z.enum(["usd", "credits", "requests", "tokens"]),
  resetsAt: z.string().nullable().optional(),
  tone: Tone.optional(),
});

const UsageDetail = z.object({ id: z.string(), label: z.string(), value: z.string(), tone: Tone.optional() });

const UsageProblem = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("expired"), expiresAt: z.string(), refreshedBy: z.string().optional() }),
  z.object({ kind: z.literal("rejected"), status: z.number().int(), refreshedBy: z.string().optional() }),
  z.object({ kind: z.literal("no_quota"), detail: z.string() }),
]);

const Unavailable = z.object({ status: z.literal("unavailable"), problem: UsageProblem });
const Failed = z.object({ status: z.literal("error"), error: z.string() });

const UsageReport = z.discriminatedUnion("status", [z.object({ status: z.literal("available"), planLabel: z.string().optional(), windows: z.array(UsageWindow), balances: z.array(UsageBalance).optional(), details: z.array(UsageDetail).optional() }), Unavailable, Failed]);

export const UsageReportEntry = z.object({
  id: z.string(),
  account: z.object({ label: z.string().optional() }),
  fetchedAt: z.string(),
  sourceId: z.string(),
  sourceLabel: z.string(),
  icon: z.string().optional(),
  report: UsageReport,
  loginErrors: z.array(z.object({ harness: z.string(), report: z.discriminatedUnion("status", [Unavailable, Failed]) })).optional(),
});

export type UsageReportEntryData = z.infer<typeof UsageReportEntry>;
export type UsageReportData = UsageReportEntryData["report"];
export type UsageWindowData = z.infer<typeof UsageWindow>;
export type UsageBalanceData = z.infer<typeof UsageBalance>;
export type UsageProblemData = z.infer<typeof UsageProblem>;
export type UsageTone = z.infer<typeof Tone>;
export type UnavailableData = z.infer<typeof Unavailable>;
export type FailedData = z.infer<typeof Failed>;
