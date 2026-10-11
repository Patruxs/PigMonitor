import assert from "node:assert/strict";
import test from "node:test";
import { isFeatureActive, nextModeId } from "./control-options.ts";

test("a select feature is active only on a non-default option", () => {
  const feature = { type: "select" as const, id: "service_tier", label: "Speed", value: "fast", options: [{ id: "normal", label: "Normal", isDefault: true }, { id: "fast", label: "Fast" }] };
  assert.equal(isFeatureActive(feature), true);
  assert.equal(isFeatureActive({ ...feature, value: "normal" }), false);
});

test("the next mode follows the current one and wraps to the first", () => {
  const modes = [{ id: "default", label: "Default" }, { id: "acceptEdits", label: "Accept edits" }, { id: "plan", label: "Plan" }];
  assert.deepEqual([nextModeId(modes, "default"), nextModeId(modes, "plan"), nextModeId(modes, "unknown"), nextModeId(modes.slice(0, 1), "default")], ["acceptEdits", "default", "acceptEdits", null]);
});
