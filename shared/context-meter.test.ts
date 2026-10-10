import assert from "node:assert/strict";
import test from "node:test";
import { formatSessionCost, formatTokenCount, progressTone, usagePercentage } from "./context-meter.ts";

test("the meter fills by used over max tokens and has no value without valid numbers", () => {
  assert.equal(usagePercentage(200_000, 50_000), 25);
  assert.equal(usagePercentage(0, 10), null);
  assert.equal(usagePercentage(100, -1), null);
  assert.equal(usagePercentage(null, 10), null);
});

test("the ring turns warning from 70% and danger above 90%", () => {
  assert.deepEqual([progressTone(69.9), progressTone(70), progressTone(90), progressTone(90.1)], ["muted", "warning", "warning", "destructive"]);
});

test("session cost shows four decimals under a cent, two above, nothing at zero", () => {
  assert.deepEqual([formatSessionCost(0.004), formatSessionCost(1.234), formatSessionCost(0), formatSessionCost(undefined)], ["$0.0040", "$1.23", null, null]);
});

test("token counts round to k and m", () => {
  assert.deepEqual([formatTokenCount(999), formatTokenCount(150_400), formatTokenCount(1_000_000)], ["999", "150k", "1m"]);
});
