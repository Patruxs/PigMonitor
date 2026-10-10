import assert from "node:assert/strict";
import test from "node:test";
import { formatSessionCost, formatTokenCount, halfRingArc, meterState, progressTone, usagePercentage } from "./context-meter.ts";

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

test("without usage the meter hides unless the agent is starting or running", () => {
  assert.deepEqual([meterState(null, "idle"), meterState({}, "closed"), meterState(null, "running"), meterState({ contextWindowMaxTokens: 0, contextWindowUsedTokens: 5 }, "initializing")], [{ kind: "hidden" }, { kind: "hidden" }, { kind: "pending" }, { kind: "pending" }]);
  assert.deepEqual(meterState({ contextWindowMaxTokens: 1_000_000, contextWindowUsedTokens: 250_000 }, "idle"), { kind: "ready", percentage: 25, usedTokens: 250_000, maxTokens: 1_000_000 });
});

test("the native arc starts at twelve o'clock and sweeps clockwise by the percentage", () => {
  assert.equal(halfRingArc(0, 20, 2), null);
  const quarter = halfRingArc(25, 20, 2);
  assert.deepEqual([quarter?.rightRotation, quarter?.leftRotation], [-90, null]);
  assert.deepEqual(quarter?.caps.map((cap) => [Math.round(cap.left * 1000) / 1000, Math.round(cap.top * 1000) / 1000]), [[9, 0], [18, 9]]);
  const threeQuarters = halfRingArc(75, 20, 2);
  assert.deepEqual([threeQuarters?.rightRotation, threeQuarters?.leftRotation], [0, 90]);
  const overflow = halfRingArc(140, 20, 2);
  assert.deepEqual([overflow?.rightRotation, overflow?.leftRotation], [0, 180]);
});
