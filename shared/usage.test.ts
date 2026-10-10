import assert from "node:assert/strict";
import test from "node:test";
import { replaceReport, reportMessages, resolveAgentUsageView, resolveBalance, usedPercent, windowTone, type UsageReportEntryData } from "./usage.ts";

const now = new Date("2026-10-01T12:00:00Z");

const entry = (id: string, fetchedAt = "2026-10-01T11:00:00Z"): UsageReportEntryData => ({ id, account: {}, fetchedAt, sourceId: "claude", sourceLabel: "Claude", report: { status: "available", windows: [] } });

test("a window shows the share used, or derives it from the share left", () => {
  assert.equal(usedPercent({ id: "w", label: "W", usedPct: 31 }), 31);
  assert.equal(usedPercent({ id: "w", label: "W", remainingPct: 69 }), 31);
  assert.equal(usedPercent({ id: "w", label: "W" }), null);
});

test("a window without the source's tone warns from 70% and turns danger above 90%", () => {
  assert.deepEqual([69, 70, 90, 91].map((usedPct) => windowTone({ id: "w", label: "W", usedPct })), ["default", "warning", "warning", "danger"]);
  assert.equal(windowTone({ id: "w", label: "W", usedPct: 99, tone: "ok" }), "ok");
});

test("a balance with a limit fills its bar by the share used, and one without has no bar", () => {
  assert.equal(resolveBalance({ id: "b", label: "B", unit: "usd", used: 25, limit: 100 }, "en").usedPct, 25);
  assert.equal(resolveBalance({ id: "b", label: "B", unit: "usd", remaining: 75, limit: 100 }, "en").usedPct, 25);
  assert.equal(resolveBalance({ id: "b", label: "B", unit: "credits", remaining: 12345 }, "en").usedPct, null);
});

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
