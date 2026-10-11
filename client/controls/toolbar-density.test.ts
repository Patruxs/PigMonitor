import assert from "node:assert/strict";
import test from "node:test";
import { resolveControlDensity } from "./toolbar-density.ts";

test("density narrows full → condensed → tight with hysteresis against churn", () => {
  const controls = { hasModel: true, hasThinking: true, hasMode: true, features: [{ type: "toggle" as const }], fontScale: 1 };
  const at = (availableWidth: number, currentDensity: "full" | "condensed" | "tight") => resolveControlDensity({ availableWidth, currentDensity, controls });
  assert.deepEqual([at(420, "full"), at(380, "full"), at(290, "condensed"), at(280, "condensed"), at(300, "tight"), at(312, "tight")], ["full", "condensed", "condensed", "tight", "tight", "condensed"]);
  assert.equal(resolveControlDensity({ availableWidth: 430, currentDensity: "full", controls: { ...controls, features: [{ type: "select", label: "A much longer localized feature label" }] } }), "condensed");
});
