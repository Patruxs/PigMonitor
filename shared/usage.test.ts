import assert from "node:assert/strict";
import test from "node:test";
import { formatAmount, formatResetLabel, formatUsageFreshness, problemText, replaceReport, reportMessages, resolveAgentUsageView, resolveBalance, usedPercent, windowTone, windowTrailing, type UsageReportEntryData } from "./usage.ts";

const now = new Date("2026-10-01T12:00:00Z");

test("a login problem reads as Paseo words it", () => {
  assert.equal(problemText({ kind: "expired", expiresAt: "2026-10-01T09:00:00Z", refreshedBy: "claude" }, now), "Login expired 3h ago. Run claude to refresh it.");
  assert.equal(problemText({ kind: "rejected", status: 401 }, now), "Login rejected (HTTP 401). Sign in again.");
  assert.equal(problemText({ kind: "no_quota", detail: "No active coding plan" }, now), "No active coding plan");
});

test("a window shows the share used, or derives it from the share left", () => {
  assert.equal(usedPercent({ id: "w", label: "W", usedPct: 31 }), 31);
  assert.equal(usedPercent({ id: "w", label: "W", remainingPct: 69 }), 31);
  assert.equal(usedPercent({ id: "w", label: "W" }), null);
});

test("a window without the source's tone warns from 70% and turns danger above 90%", () => {
  assert.deepEqual([69, 70, 90, 91].map((usedPct) => windowTone({ id: "w", label: "W", usedPct })), ["default", "warning", "warning", "danger"]);
  assert.equal(windowTone({ id: "w", label: "W", usedPct: 99, tone: "ok" }), "ok");
});

test("resets read in the largest whole unit, and an at-risk window says when it runs out", () => {
  assert.equal(formatResetLabel("2026-10-01T14:30:00Z", now), "resets 2h");
  assert.equal(formatResetLabel("2026-10-06T12:00:00Z", now), "resets 5d");
  assert.equal(formatResetLabel("2026-10-01T11:00:00Z", now), "resetting now");
  assert.equal(windowTrailing({ id: "w", label: "W", runsOutAt: "2026-10-01T12:40:00Z", shortfallPct: 10, resetsAt: "2026-10-02T12:00:00Z" }, now), "runs out 40m");
});

test("balances show used over limit with a bar, else what is left or used", () => {
  assert.deepEqual(resolveBalance({ id: "b", label: "B", unit: "usd", used: 25, limit: 100 }, "en"), { amountText: "$25.00 / $100.00", usedPct: 25 });
  assert.deepEqual(resolveBalance({ id: "b", label: "B", unit: "credits", remaining: 12345 }, "en"), { amountText: "12,345 left", usedPct: null });
  assert.equal(formatAmount(150_400, "tokens", "en"), "150k");
});

test("freshness says when the report was fetched", () => {
  assert.equal(formatUsageFreshness("2026-10-01T11:55:00Z", now), "Updated 5m ago");
  assert.equal(formatUsageFreshness("2026-10-01T11:59:40Z", now), "Updated just now");
});

const entry = (id: string, fetchedAt = "2026-10-01T11:00:00Z"): UsageReportEntryData => ({ id, account: {}, fetchedAt, sourceId: "claude", sourceLabel: "Claude", report: { status: "available", windows: [] } });

test("a refresh swaps its report in place, and drops one the daemon no longer knows", () => {
  const reports = [entry("a"), entry("b")];
  assert.deepEqual(replaceReport(reports, "a", entry("a", "2026-10-01T12:00:00Z")).map((r) => [r.id, r.fetchedAt]), [["a", "2026-10-01T12:00:00Z"], ["b", "2026-10-01T11:00:00Z"]]);
  assert.deepEqual(replaceReport(reports, "a", null).map((r) => r.id), ["b"]);
});

test("an unavailable report explains each login that failed", () => {
  const failed: UsageReportEntryData = { ...entry("a"), report: { status: "unavailable", problem: { kind: "rejected", status: 403 } }, loginErrors: [{ harness: "claude", report: { status: "error", error: "boom" } }] };
  assert.deepEqual(reportMessages(failed, now), ["claude: boom"]);
  assert.deepEqual(reportMessages({ ...failed, loginErrors: undefined }, now), ["Login rejected (HTTP 403). Sign in again."]);
});

test("the agent's usage shows nothing without a host or reports, loads, errors, or lists them", () => {
  assert.deepEqual(resolveAgentUsageView({ canReport: false, data: [entry("a")], error: null }), { kind: "none" });
  assert.deepEqual(resolveAgentUsageView({ canReport: true, data: undefined, error: null }), { kind: "loading" });
  assert.deepEqual(resolveAgentUsageView({ canReport: true, data: [], error: null }), { kind: "none" });
  assert.deepEqual(resolveAgentUsageView({ canReport: true, data: [entry("a")], error: "Agent not found" }), { kind: "error", message: "Unable to load usage: Agent not found" });
});
