import { compareMatchScores, scoreTextFields } from "../../shared/match.ts";
import { formatThinkingOptionLabel, LABELS, type ModelDefinition, type ProviderEntry } from "./control-options.ts";

export function normalizeModelId(modelId: string | null | undefined): string | null {
  const normalized = typeof modelId === "string" ? modelId.trim() : "";
  return normalized || null;
}

function findModelById(models: ModelDefinition[] | null, modelId: string | null): ModelDefinition | null {
  if (!models || !modelId) return null;
  return models.find((model) => model.id === modelId) ?? models.find((model) => model.aliases?.includes(modelId)) ?? null;
}

export function filterSelectableModels(models: ModelDefinition[] | null): ModelDefinition[] | null {
  return models?.filter((model) => model.isSelectable !== false) ?? null;
}

export function resolveAgentModelSelection(input: { models: ModelDefinition[] | null; runtimeModelId: string | null | undefined; configuredModelId: string | null | undefined; runtimeThinkingOptionId: string | null | undefined; explicitThinkingOptionId: string | null | undefined }) {
  const { models } = input;
  const normalizedRuntimeModelId = normalizeModelId(input.runtimeModelId);
  const normalizedConfiguredModelId = normalizeModelId(input.configuredModelId);
  const runtimeSelectedModel = findModelById(models, normalizedRuntimeModelId);
  const preferredModelId = runtimeSelectedModel?.id ?? normalizedConfiguredModelId ?? normalizedRuntimeModelId;
  const fallbackModel = models?.find((model) => model.isDefault) ?? models?.[0] ?? null;
  const selectedModel = preferredModelId ? findModelById(models, preferredModelId) : fallbackModel;
  const activeModelId = selectedModel?.id ?? preferredModelId ?? null;
  const displayModel = selectedModel?.label ?? preferredModelId ?? fallbackModel?.label ?? LABELS.unknownModel;
  const thinkingOptions = selectedModel?.thinkingOptions ?? null;
  const runtimeThinkingOption = selectedModel?.thinkingOptions?.find((option) => option.id === input.runtimeThinkingOptionId);
  const explicit = input.explicitThinkingOptionId;
  const resolvedThinkingId = runtimeThinkingOption ? runtimeThinkingOption.id : explicit && explicit !== "default" ? explicit : (selectedModel?.defaultThinkingOptionId ?? null);
  const effectiveThinking = thinkingOptions?.find((option) => option.id === resolvedThinkingId) ?? thinkingOptions?.[0] ?? null;
  const selectedThinkingId = effectiveThinking?.id ?? resolvedThinkingId;
  const displayThinking = effectiveThinking ? formatThinkingOptionLabel(effectiveThinking) : selectedThinkingId ? formatThinkingOptionLabel({ id: selectedThinkingId }) : LABELS.unknownThinking;
  return { selectedModel, activeModelId, displayModel, thinkingOptions, selectedThinkingId, displayThinking };
}

export interface ModelRow {
  key: string;
  provider: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  description?: string;
  isDefault?: boolean;
}

export type ModelSelection = { kind: "models"; rows: ModelRow[] } | { kind: "loading" } | { kind: "error"; message: string };

export interface SelectorProvider {
  id: string;
  label: string;
  modelSelection: ModelSelection;
}

function buildModelSelection(provider: string, providerLabel: string, models: ModelDefinition[] | null): ModelSelection {
  if (models === null) return { kind: "loading" };
  const selectable = filterSelectableModels(models) ?? [];
  if (selectable.length === 0) return { kind: "models", rows: [{ key: `${provider}:`, provider, providerLabel, modelId: "", modelLabel: LABELS.defaultModel, description: undefined, isDefault: true }] };
  return { kind: "models", rows: selectable.map((model) => ({ key: `${provider}:${model.id}`, provider, providerLabel, modelId: model.id, modelLabel: model.label, description: model.description ?? model.id, isDefault: model.isDefault })) };
}

function entryModelSelection(entry: ProviderEntry, label: string): ModelSelection {
  if ((entry.models?.length ?? 0) > 0 || entry.status === "ready") return buildModelSelection(entry.provider, label, entry.models ?? null);
  if (entry.status === "loading") return { kind: "loading" };
  return { kind: "error", message: entry.error ?? (entry.status === "unavailable" ? LABELS.unavailable : LABELS.unknownError) };
}

export function buildSelectorProviders(entries: ProviderEntry[] | undefined): SelectorProvider[] {
  return (entries ?? [])
    .filter((entry) => entry.enabled)
    .map((entry) => {
      const label = entry.label ?? entry.provider;
      return { id: entry.provider, label, modelSelection: entryModelSelection(entry, label) };
    });
}

export function providerModelRows(provider: SelectorProvider): ModelRow[] {
  return provider.modelSelection.kind === "models" ? provider.modelSelection.rows : [];
}

export function allProviderModelRows(providers: SelectorProvider[]): ModelRow[] {
  return providers.flatMap(providerModelRows);
}

export function resolveSelectedModelLabel(input: { providers: SelectorProvider[]; selectedProvider: string; selectedModel: string; isLoading: boolean }): string {
  const selectedProvider = input.selectedProvider.trim();
  const provider = selectedProvider ? input.providers.find((entry) => entry.id === selectedProvider) : undefined;
  if (!provider) return input.isLoading ? LABELS.loading : LABELS.selectModel;
  if (provider.modelSelection.kind === "loading") return LABELS.loading;
  if (provider.modelSelection.kind === "error") return LABELS.error;
  const model = provider.modelSelection.rows.find((entry) => entry.modelId === input.selectedModel);
  const selectedModel = input.selectedModel.trim();
  if (!model && selectedModel) return selectedModel;
  const defaultModel = provider.modelSelection.rows.find((row) => row.isDefault);
  return model?.modelLabel ?? defaultModel?.modelLabel ?? provider.modelSelection.rows[0]?.modelLabel ?? LABELS.selectModel;
}

export function providerQualifiedDescription(row: ModelRow): string {
  return row.description ? `${row.providerLabel} · ${row.description}` : row.providerLabel;
}

export function shortModelLabel(label: string): string {
  const separatorIndex = label.lastIndexOf("/");
  return separatorIndex === -1 ? label : label.slice(separatorIndex + 1);
}

export function normalizeSearchQuery(value: string): string {
  return value.trim().toLowerCase();
}

export function filterAndRankModelRows(rows: ModelRow[], normalizedQuery: string): ModelRow[] {
  if (!normalizedQuery) return rows;
  const scored = rows.flatMap((row) => {
    const score = scoreTextFields(normalizedQuery, [row.modelLabel, row.modelId, row.providerLabel, row.description ?? ""]);
    return score ? [{ row, score }] : [];
  });
  scored.sort((a, b) => compareMatchScores(a.score, b.score) || a.row.modelLabel.localeCompare(b.row.modelLabel));
  return scored.map((entry) => entry.row);
}

export type ModelBrowserView = { kind: "all" } | { kind: "provider"; providerId: string; providerLabel: string };

export function resolveInitialModelBrowserView({ providers, selectedProvider, selectedModel }: { providers: SelectorProvider[]; selectedProvider: string; selectedModel: string }): ModelBrowserView {
  if (providers.length === 1) return { kind: "provider", providerId: providers[0].id, providerLabel: providers[0].label };
  if (selectedProvider.length > 0 && selectedModel.length > 0) {
    const provider = providers.find((entry) => entry.id === selectedProvider);
    if (provider) return { kind: "provider", providerId: provider.id, providerLabel: provider.label };
  }
  return { kind: "all" };
}

export type ModelBrowserAllView = { kind: "browse" } | { kind: "searchResults"; rows: ModelRow[] } | { kind: "noSearchMatches" };

export function resolveModelBrowserAllView({ providers, normalizedQuery, isSearchFocused }: { providers: SelectorProvider[]; normalizedQuery: string; isSearchFocused: boolean }): ModelBrowserAllView {
  if (!normalizedQuery && !isSearchFocused) return { kind: "browse" };
  const allRows = allProviderModelRows(providers);
  const rows = normalizedQuery ? filterAndRankModelRows(allRows, normalizedQuery) : allRows;
  return rows.length === 0 ? { kind: "noSearchMatches" } : { kind: "searchResults", rows };
}

const DESKTOP_PROVIDER_VIEW_MIN_HEIGHT = 220;
const DESKTOP_PROVIDER_VIEW_MAX_HEIGHT = 400;
const DESKTOP_PROVIDER_VIEW_BASE_HEIGHT = 80;
const DESKTOP_MODEL_ROW_HEIGHT = 40;

export function resolveDesktopFixedHeight(view: ModelBrowserView, providers: SelectorProvider[]): number {
  const provider = view.kind === "provider" ? providers.find((entry) => entry.id === view.providerId) : undefined;
  const modelCount = view.kind === "all" ? allProviderModelRows(providers).length : provider ? providerModelRows(provider).length : 0;
  return Math.min(Math.max(DESKTOP_PROVIDER_VIEW_MIN_HEIGHT, DESKTOP_PROVIDER_VIEW_BASE_HEIGHT + modelCount * DESKTOP_MODEL_ROW_HEIGHT), DESKTOP_PROVIDER_VIEW_MAX_HEIGHT);
}

export function selectorOpenRefetchDecision(input: { entries: ProviderEntry[] | undefined; selectedProvider: string | null | undefined }): "refetch-stale" | "refetch-always" {
  if (!input.selectedProvider) return "refetch-stale";
  const selectedEntry = input.entries?.find((entry) => entry.provider === input.selectedProvider);
  return !selectedEntry || selectedEntry.status === "loading" ? "refetch-always" : "refetch-stale";
}
