import assert from "node:assert/strict";
import test from "node:test";
import { meterState, progressTone, usagePercentage } from "./context-meter.ts";

test("the meter fills by used over max tokens and has no value without valid numbers", () => {
  assert.equal(usagePercentage(200_000, 50_000), 25);
  assert.equal(usagePercentage(0, 10), null);
  assert.equal(usagePercentage(100, -1), null);
  assert.equal(usagePercentage(null, 10), null);
});

test("the ring turns warning from 70% and danger above 90%", () => {
  assert.deepEqual([progressTone(69.9), progressTone(70), progressTone(90), progressTone(90.1)], ["muted", "warning", "warning", "destructive"]);
});

test("without usage the meter hides unless the agent is starting or running", () => {
  assert.deepEqual([meterState(null, "idle"), meterState({}, "closed"), meterState(null, "running"), meterState({ contextWindowMaxTokens: 0, contextWindowUsedTokens: 5 }, "initializing")], [{ kind: "hidden" }, { kind: "hidden" }, { kind: "pending" }, { kind: "pending" }]);
  assert.deepEqual(meterState({ contextWindowMaxTokens: 1_000_000, contextWindowUsedTokens: 250_000 }, "idle"), { kind: "ready", percentage: 25, usedTokens: 250_000, maxTokens: 1_000_000 });
  assert.deepEqual(meterState({ contextWindowUsedTokens: 19_609 }, "running"), { kind: "used", usedTokens: 19_609 });
});
