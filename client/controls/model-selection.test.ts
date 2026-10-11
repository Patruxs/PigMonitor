import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderEntry } from "./control-options.ts";
import { allProviderModelRows, buildSelectorProviders, filterAndRankModelRows, resolveAgentModelSelection, resolveInitialModelBrowserView, resolveModelBrowserAllView, resolveSelectedModelLabel } from "./model-selection.ts";

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
