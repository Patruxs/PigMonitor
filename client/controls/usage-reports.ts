import { formatTokenCount } from "../../shared/context-meter.ts";
import { ageProse, levelOf } from "../../shared/format.ts";
import type { FailedData, UnavailableData, UsageBalanceData, UsageProblemData, UsageReportData, UsageReportEntryData, UsageTone, UsageWindowData } from "../../shared/usage-schema.ts";

export type { UsageReportEntryData, UsageWindowData, UsageBalanceData, UsageTone };

export const USAGE_COPY = {
  refresh: "Refresh",
  refreshFailed: "Unable to refresh usage",
  updated: "Updated",
  loading: "Loading usage...",
  agentError: (reason: string) => `Unable to load usage: ${reason}`,
} as const;

export function formatUsageFreshness(fetchedAt: string, now: Date = new Date()): string {
  return `${USAGE_COPY.updated} ${ageProse(new Date(fetchedAt).getTime(), now.getTime())}`;
}

export function problemText(problem: UsageProblemData, now: Date = new Date()): string {
  if (problem.kind === "no_quota") return problem.detail;
  const remedy = problem.refreshedBy ? `Run ${problem.refreshedBy} to refresh it.` : "Sign in again.";
  if (problem.kind === "rejected") return `Login rejected (HTTP ${problem.status}). ${remedy}`;
  return `Login expired ${ageProse(new Date(problem.expiresAt).getTime(), now.getTime())}. ${remedy}`;
}

export function usedPercent(window: UsageWindowData): number | null {
  if (window.usedPct != null) return window.usedPct;
  if (window.remainingPct != null) return 100 - window.remainingPct;
  return null;
}

export function windowTone(window: UsageWindowData): UsageTone {
  if (window.tone) return window.tone;
  const used = usedPercent(window);
  if (used == null) return "default";
  const level = levelOf(used);
  return level === "normal" ? "default" : level;
}

export function formatResetLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const diffMs = new Date(iso).getTime() - now.getTime();
  if (!Number.isFinite(diffMs)) return null;
  if (diffMs <= 0) return "resetting now";
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  return `resets ${days > 0 ? `${days}d` : hours > 0 ? `${hours}h` : `${minutes}m`}`;
}

export function windowTrailing(window: UsageWindowData, now: Date = new Date()): string | null {
  const isAtRisk = window.runsOutAt != null && window.shortfallPct != null;
  if (isAtRisk) return `runs out ${formatResetLabel(window.runsOutAt, now)?.replace("resets ", "") ?? ""}`.trim();
  return formatResetLabel(window.resetsAt, now);
}

export function formatAmount(value: number, unit: UsageBalanceData["unit"], locale: string): string {
  switch (unit) {
    case "usd":
      return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(value);
    case "tokens":
      return formatTokenCount(value);
    default:
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  }
}

export function resolveBalance(balance: UsageBalanceData, locale: string): { amountText: string; usedPct: number | null } {
  const { used, remaining, limit, unit } = balance;
  const format = (value: number) => formatAmount(value, unit, locale);
  if (limit != null && limit > 0) {
    const usedAmount = used ?? (remaining != null ? limit - remaining : null);
    return { amountText: `${usedAmount != null ? format(usedAmount) : "—"} / ${format(limit)}`, usedPct: usedAmount != null ? (usedAmount / limit) * 100 : null };
  }
  if (remaining != null) return { amountText: `${format(remaining)} left`, usedPct: null };
  if (used != null) return { amountText: format(used), usedPct: null };
  return { amountText: "—", usedPct: null };
}

export function statusText(report: UsageReportData): string | null {
  if (report.status === "available") return null;
  return report.status === "error" ? "Error" : "Unavailable";
}

function failureMessage(report: UnavailableData | FailedData, now: Date): string {
  return report.status === "unavailable" ? problemText(report.problem, now) : report.error;
}

export function reportContent(report: UsageReportData) {
  if (report.status === "available") return { windows: report.windows, balances: report.balances ?? [], details: report.details ?? [] };
  return { windows: [], balances: [], details: [] };
}

export function reportMessages(entry: UsageReportEntryData, now: Date = new Date()): string[] {
  if (entry.report.status === "available") return [];
  if (entry.loginErrors) return entry.loginErrors.map((login) => `${login.harness}: ${failureMessage(login.report, now)}`);
  return [failureMessage(entry.report, now)];
}

export function replaceReport(reports: readonly UsageReportEntryData[], reportId: string, refreshed: UsageReportEntryData | null): UsageReportEntryData[] {
  if (!refreshed) return reports.filter((report) => report.id !== reportId);
  return reports.map((report) => (report.id === reportId ? refreshed : report));
}

export type AgentUsageView = { kind: "none" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; reports: UsageReportEntryData[] };

export function resolveAgentUsageView(input: { canReport: boolean; data: UsageReportEntryData[] | undefined; error: string | null }): AgentUsageView {
  if (!input.canReport) return { kind: "none" };
  if (input.error) return { kind: "error", message: USAGE_COPY.agentError(input.error) };
  if (input.data) return input.data.length === 0 ? { kind: "none" } : { kind: "ready", reports: input.data };
  return { kind: "loading" };
}
