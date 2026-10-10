import assert from "node:assert/strict";
import test from "node:test";
import { buildSelectorProviders, filterAndRankModelRows, allProviderModelRows, formatAgentModeLabel, formatThinkingOptionLabel, isFeatureActive, nextModeId, resolveAgentModelSelection, resolveControlDensity, resolveInitialModelBrowserView, resolveModelBrowserAllView, resolveSelectedModelLabel, type ProviderEntry } from "./controls.ts";

const selection = (input: Partial<Parameters<typeof resolveAgentModelSelection>[0]>) => resolveAgentModelSelection({ models: [], runtimeModelId: null, configuredModelId: null, runtimeThinkingOptionId: null, explicitThinkingOptionId: null, ...input });

test("a configured model alias resolves to its catalog model and that model's default thinking", () => {
  const s = selection({ models: [{ id: "claude-fable-5", aliases: ["claude-fable-5[1m]"], label: "Fable 5", thinkingOptions: [{ id: "high", label: "High" }], defaultThinkingOptionId: "high" }], configuredModelId: "claude-fable-5[1m]" });
  assert.deepEqual([s.activeModelId, s.displayModel, s.selectedThinkingId], ["claude-fable-5", "Fable 5", "high"]);
});

test("the runtime model wins over the configured one, and the configured one wins when the runtime model is not listed", () => {
  const models = [{ id: "default", label: "Default (Sonnet 4.6)", isDefault: true, thinkingOptions: [{ id: "low", label: "Low" }, { id: "medium", label: "Medium" }] }, { id: "a", label: "Model A" }];
  assert.equal(selection({ models, runtimeModelId: "a", configuredModelId: "default" }).activeModelId, "a");
  const s = selection({ models, runtimeModelId: "claude-sonnet-4-6-20260101", configuredModelId: "default" });
  assert.deepEqual([s.activeModelId, s.displayModel, s.selectedThinkingId, s.displayThinking], ["default", "Default (Sonnet 4.6)", "low", "Low"]);
});

test("thinking shows the runtime level when it is a model option, else the chosen one, else the model default", () => {
  const models = [{ id: "a", label: "Model A", thinkingOptions: [{ id: "low", label: "Low" }, { id: "medium", label: "Medium" }, { id: "high", label: "High" }], defaultThinkingOptionId: "medium" }];
  assert.equal(selection({ models, runtimeModelId: "a", runtimeThinkingOptionId: "high" }).selectedThinkingId, "high");
  assert.equal(selection({ models, runtimeModelId: "a", runtimeThinkingOptionId: "xhigh", explicitThinkingOptionId: "low" }).selectedThinkingId, "low");
  assert.equal(selection({ models, runtimeModelId: "a", explicitThinkingOptionId: "default" }).selectedThinkingId, "medium");
});

test("an agent on a model the catalog does not list shows its own model id and chosen thinking", () => {
  const s = selection({ models: [{ id: "gpt-6-sol", label: "GPT-6-Sol", isDefault: true, thinkingOptions: [{ id: "medium", label: "medium" }, { id: "max", label: "max" }], defaultThinkingOptionId: "medium" }], runtimeModelId: "gpt-6.1-sol", configuredModelId: "gpt-6.1-sol", explicitThinkingOptionId: "max" });
  assert.deepEqual([s.selectedModel, s.activeModelId, s.displayModel, s.displayThinking], [null, "gpt-6.1-sol", "gpt-6.1-sol", "Max"]);
});

test("labels are sentence-cased and split, with xhigh read as Extra high", () => {
  assert.equal(formatAgentModeLabel({ id: "bypassPermissions", label: null }), "Bypass permissions");
  assert.equal(formatAgentModeLabel({ id: "x", label: "Accept Edits" }), "Accept edits");
  assert.equal(formatThinkingOptionLabel({ id: "xhigh", label: "xhigh" }), "Extra high");
});

test("a select feature is active only on a non-default option", () => {
  const feature = { type: "select" as const, id: "service_tier", label: "Speed", value: "fast", options: [{ id: "normal", label: "Normal", isDefault: true }, { id: "fast", label: "Fast" }] };
  assert.equal(isFeatureActive(feature), true);
  assert.equal(isFeatureActive({ ...feature, value: "normal" }), false);
});

test("density narrows full → condensed → tight with hysteresis against churn", () => {
  const controls = { hasModel: true, hasThinking: true, hasMode: true, features: [{ type: "toggle" as const }], fontScale: 1 };
  const at = (availableWidth: number, currentDensity: "full" | "condensed" | "tight") => resolveControlDensity({ availableWidth, currentDensity, controls });
  assert.deepEqual([at(420, "full"), at(380, "full"), at(290, "condensed"), at(280, "condensed"), at(300, "tight"), at(312, "tight")], ["full", "condensed", "condensed", "tight", "tight", "condensed"]);
  assert.equal(resolveControlDensity({ availableWidth: 430, currentDensity: "full", controls: { ...controls, features: [{ type: "select", label: "A much longer localized feature label" }] } }), "condensed");
});

const entries: ProviderEntry[] = [
  { provider: "claude", label: "Claude", status: "ready", enabled: true, models: [{ id: "opus", label: "Opus" }, { id: "sonnet", label: "Sonnet", isDefault: true }, { id: "hidden", label: "Hidden", isSelectable: false }] },
  { provider: "codex", label: "Codex", status: "loading", enabled: true },
  { provider: "off", status: "ready", enabled: false, models: [{ id: "x", label: "X" }] },
];

test("the model picker offers only enabled providers' selectable models and labels the choice", () => {
  const providers = buildSelectorProviders(entries);
  assert.deepEqual(providers.map((p) => p.id), ["claude", "codex"]);
  assert.deepEqual(allProviderModelRows(providers).map((r) => r.modelId), ["opus", "sonnet"]);
  assert.equal(resolveSelectedModelLabel({ providers, selectedProvider: "claude", selectedModel: "", isLoading: false }), "Sonnet");
  assert.equal(resolveSelectedModelLabel({ providers, selectedProvider: "claude", selectedModel: "unlisted", isLoading: false }), "unlisted");
  assert.equal(resolveSelectedModelLabel({ providers, selectedProvider: "codex", selectedModel: "", isLoading: false }), "Loading...");
});

test("the picker opens a sole provider directly, and search ranks matches or reports none", () => {
  const providers = buildSelectorProviders(entries.slice(0, 1));
  assert.deepEqual(resolveInitialModelBrowserView({ providers, selectedProvider: "", selectedModel: "" }), { kind: "provider", providerId: "claude", providerLabel: "Claude" });
  assert.deepEqual(filterAndRankModelRows(allProviderModelRows(providers), "son").map((r) => r.modelId), ["sonnet"]);
  assert.deepEqual(resolveModelBrowserAllView({ providers, normalizedQuery: "zzz", isSearchFocused: false }), { kind: "noSearchMatches" });
});

test("the next mode follows the current one and wraps to the first", () => {
  const modes = [{ id: "default", label: "Default" }, { id: "acceptEdits", label: "Accept edits" }, { id: "plan", label: "Plan" }];
  assert.deepEqual([nextModeId(modes, "default"), nextModeId(modes, "plan"), nextModeId(modes, "unknown"), nextModeId(modes.slice(0, 1), "default")], ["acceptEdits", "default", "acceptEdits", null]);
});
