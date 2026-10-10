import assert from "node:assert/strict";
import test from "node:test";
import { formatMessageTimestamp, readView, VIEW_VERSION } from "./view.ts";

test("the view is read only at this plugin's version: none or older says update piggery, newer says update the plugin", () => {
  assert.deepEqual([readView(null), readView({}), readView({ version: VIEW_VERSION - 1 }), readView({ version: VIEW_VERSION + 1 })].map((r) => (r.ok ? "ok" : r.code)), ["older", "older", "older", "newer"]);
  const doc = { version: VIEW_VERSION, summary: {} };
  const read = readView(doc);
  assert.equal(read.ok && read.view, doc);
});

test("a message stamp is the time today, adds the weekday within six days, and the full date from the seventh day on", () => {
  const now = new Date(2026, 9, 10, 15, 0);
  const daysAgo = (days: number) => new Date(2026, 9, 10 - days, 9, 30);
  const weekday = (date: Date) => date.toLocaleDateString(undefined, { weekday: "long" });
  assert.equal(formatMessageTimestamp(daysAgo(0), now).includes(weekday(daysAgo(0))), false);
  assert.equal(formatMessageTimestamp(daysAgo(6), now).startsWith(weekday(daysAgo(6))), true);
  assert.equal(formatMessageTimestamp(daysAgo(7), now).includes("2026"), true);
});
