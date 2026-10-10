export interface SelectOption {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
}

export interface ModelDefinition {
  id: string;
  label: string;
  aliases?: string[];
  isSelectable?: boolean;
  description?: string;
  isDefault?: boolean;
  thinkingOptions?: SelectOption[];
  defaultThinkingOptionId?: string;
}

export interface Mode {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  colorTier?: string;
}

export function nextModeId(modes: readonly Mode[], selectedModeId: string | null | undefined): string | null {
  if (modes.length < 2) return null;
  const selected = modes.findIndex((mode) => mode.id === selectedModeId);
  return modes[((selected >= 0 ? selected : 0) + 1) % modes.length]?.id ?? null;
}

export type Feature =
  | { type: "toggle"; id: string; label: string; description?: string; tooltip?: string; icon?: string; value: boolean }
  | { type: "select"; id: string; label: string; description?: string; tooltip?: string; icon?: string; desktopTrigger?: "icon" | "label"; value: string | null; options: SelectOption[] };

export interface ProviderEntry {
  provider: string;
  status: "ready" | "loading" | "error" | "unavailable";
  enabled: boolean;
  error?: string;
  models?: ModelDefinition[];
  modes?: Mode[];
  label?: string;
  iconSvg?: string;
  defaultModeId?: string | null;
}

export const LABELS = {
  unknownModel: "Unknown model",
  unknownThinking: "Unknown",
  extraHigh: "Extra high",
  defaultModel: "Default",
  selectModel: "Select model",
  loading: "Loading...",
  error: "Error",
  unavailable: "Unavailable",
  unknownError: "Unknown error",
} as const;

function sentenceCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function splitCompactLabel(value: string, splitHyphen: boolean): string {
  const separatorPattern = splitHyphen ? /[_-]+/g : /_+/g;
  return value
    .replace(separatorPattern, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function formatControlLabel(option: { id: string; label?: string | null }, splitHyphen: boolean): string {
  return sentenceCase(splitCompactLabel((option.label ?? option.id).trim(), splitHyphen));
}

export function formatAgentModeLabel(mode: { id: string; label?: string | null }): string {
  return formatControlLabel(mode, mode.label == null);
}

export function formatThinkingOptionLabel(option: { id: string; label?: string | null }): string {
  const rawLabel = (option.label ?? option.id).trim();
  const compactId = option.id.replace(/[\s_-]+/g, "").toLowerCase();
  const compactLabel = rawLabel.replace(/[\s_-]+/g, "").toLowerCase();
  if (compactId === "xhigh" || compactLabel === "xhigh") return LABELS.extraHigh;
  return formatControlLabel(option, true);
}

export const PLAN_MODE_FEATURE_ID = "plan_mode";
export const FAST_MODE_FEATURE_ID = "fast_mode";
export const SPEED_FEATURE_ID = "service_tier";

export type FeatureHighlightColor = "blue" | "default" | "green" | "yellow";

export function getFeatureTooltip(feature: { label: string; tooltip?: string }): string {
  return feature.tooltip ?? feature.label;
}

export function isFeatureActive(feature: Feature): boolean {
  if (feature.type === "toggle") return feature.value;
  const selectedOption = feature.options.find((option) => option.id === feature.value);
  return selectedOption !== undefined && !selectedOption.isDefault;
}

export function getFeatureHighlightColor(featureId: string): FeatureHighlightColor {
  switch (featureId) {
    case FAST_MODE_FEATURE_ID:
    case SPEED_FEATURE_ID:
      return "yellow";
    case "auto_accept":
      return "green";
    case PLAN_MODE_FEATURE_ID:
      return "blue";
    default:
      return "default";
  }
}

const FEATURE_ICONS: Record<string, string> = { "list-todo": "ListTodo", "shield-check": "ShieldCheck", zap: "Zap" };

export function getAgentFeatureIcon(icon?: string): string {
  return (icon ? FEATURE_ICONS[icon] : undefined) ?? "Settings2";
}

const MODE_ICONS = new Set(["Bot", "Shield", "ShieldAlert", "ShieldCheck", "ShieldEllipsis", "ShieldOff", "ShieldPlus", "ShieldQuestionMark"]);

function modeVisualIcon(entry: ProviderEntry | null, modeId: string): string | undefined {
  const mode = entry?.modes?.find((m) => m.id === modeId);
  if (!mode) return undefined;
  return mode.icon ?? "ShieldCheck";
}

export function getAgentModeIcon(entry: ProviderEntry | null, modeId: string): string {
  const icon = modeVisualIcon(entry, modeId);
  return icon && MODE_ICONS.has(icon) ? icon : "Bot";
}

export function getAgentModeOptionIcon(entry: ProviderEntry | null, modeId: string): string | undefined {
  const icon = modeVisualIcon(entry, modeId);
  return icon && MODE_ICONS.has(icon) ? icon : undefined;
}

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

export type ControlDensity = "full" | "condensed" | "tight";

export type FeatureControlPresence = { type: "toggle" } | { type: "select"; label: string };

export interface ControlPresence {
  hasModel: boolean;
  hasThinking: boolean;
  hasMode: boolean;
  features: readonly FeatureControlPresence[];
  fontScale: number;
}

export interface ControlPresentation {
  showCarets: boolean;
  showThinkingLabel: boolean;
  showModeLabel: boolean;
  aggregateFeatures: boolean;
}

export const TOOLBAR_GEOMETRY = { controlSize: 28, controlGap: 4, iconLabelGap: 4, labelPadding: 8, caretSize: 14 } as const;

const DENSITY_HYSTERESIS = 12;

function normalizedFontScale(fontScale: number): number {
  return Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
}

function sumControlWidths(widths: number[]): number {
  if (widths.length === 0) return 0;
  return widths.reduce((total, width) => total + width, 0) + (widths.length - 1) * TOOLBAR_GEOMETRY.controlGap;
}

function featureControlWidth(feature: FeatureControlPresence, fontScale: number): number {
  if (feature.type === "toggle") return TOOLBAR_GEOMETRY.controlSize;
  return TOOLBAR_GEOMETRY.controlSize + TOOLBAR_GEOMETRY.iconLabelGap + TOOLBAR_GEOMETRY.labelPadding * 2 + Array.from(feature.label).length * 7 * fontScale;
}

function condensedFloor(controls: ControlPresence): number {
  const fontScale = normalizedFontScale(controls.fontScale);
  const widths: number[] = [];
  if (controls.hasModel) widths.push(36 + 60 * fontScale);
  if (controls.hasThinking) widths.push(TOOLBAR_GEOMETRY.controlSize);
  if (controls.hasMode) widths.push(36 + 96 * fontScale);
  if (controls.features.length > 0) widths.push(TOOLBAR_GEOMETRY.controlSize);
  return sumControlWidths(widths);
}

function fullFloor(controls: ControlPresence): number {
  const fontScale = normalizedFontScale(controls.fontScale);
  const widths: number[] = [];
  if (controls.hasModel) widths.push(50 + 70 * fontScale);
  if (controls.hasThinking) widths.push(54 + 48 * fontScale);
  if (controls.hasMode) widths.push(54 + 96 * fontScale);
  for (const feature of controls.features) widths.push(featureControlWidth(feature, fontScale));
  return sumControlWidths(widths);
}

export function resolveControlDensity(input: { availableWidth: number; currentDensity: ControlDensity; controls: ControlPresence }): ControlDensity {
  const full = fullFloor(input.controls);
  const condensed = condensedFloor(input.controls);
  if (input.currentDensity === "full") {
    if (input.availableWidth >= full - DENSITY_HYSTERESIS) return "full";
    return input.availableWidth >= condensed ? "condensed" : "tight";
  }
  if (input.currentDensity === "condensed") {
    if (input.availableWidth >= full + DENSITY_HYSTERESIS) return "full";
    if (input.availableWidth < condensed - DENSITY_HYSTERESIS) return "tight";
    return "condensed";
  }
  if (input.availableWidth >= full + DENSITY_HYSTERESIS) return "full";
  if (input.availableWidth >= condensed + DENSITY_HYSTERESIS) return "condensed";
  return "tight";
}

export function resolveControlPresentation(density: ControlDensity): ControlPresentation {
  if (density === "full") return { showCarets: true, showThinkingLabel: true, showModeLabel: true, aggregateFeatures: false };
  if (density === "condensed") return { showCarets: false, showThinkingLabel: false, showModeLabel: true, aggregateFeatures: true };
  return { showCarets: false, showThinkingLabel: false, showModeLabel: false, aggregateFeatures: true };
}

export function resolveToolbarGlyphSize(platform: "web" | "native"): number {
  return platform === "native" ? 20 : 16;
}

export const COMPACT_BREAKPOINT = 720;

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

interface MatchScore {
  tier: number;
  offset: number;
  spread?: number;
}

const TIER_EXACT = 0;
const TIER_WHOLE_WORD = 1;
const TIER_PREFIX = 2;
const TIER_WORD_START = 3;
const TIER_SUBSTRING = 4;
const TIER_SUBSEQUENCE = 5;

function isWordBoundaryChar(ch: string | undefined): boolean {
  if (ch === undefined) return true;
  return !/[a-z0-9]/.test(ch);
}

function scoreSubstringMatch(query: string, text: string): MatchScore | null {
  let best: MatchScore | null = null;
  let pos = 0;
  while (pos <= text.length - query.length) {
    const found = text.indexOf(query, pos);
    if (found === -1) break;
    const startsAtBoundary = found === 0 || isWordBoundaryChar(text[found - 1]);
    const endsAtBoundary = isWordBoundaryChar(text[found + query.length]);
    const tier = startsAtBoundary && endsAtBoundary ? TIER_WHOLE_WORD : found === 0 ? TIER_PREFIX : startsAtBoundary ? TIER_WORD_START : TIER_SUBSTRING;
    if (!best || tier < best.tier || (tier === best.tier && found < best.offset)) best = { tier, offset: found };
    pos = found + 1;
  }
  return best;
}

function scoreSubsequenceMatch(query: string, text: string): MatchScore | null {
  let queryIndex = 0;
  let firstIndex = -1;
  let lastIndex = -1;
  for (let textIndex = 0; textIndex < text.length && queryIndex < query.length; textIndex += 1) {
    if (/\s/u.test(text[textIndex])) {
      queryIndex = 0;
      firstIndex = -1;
      lastIndex = -1;
      continue;
    }
    if (text[textIndex] !== query[queryIndex]) continue;
    if (firstIndex === -1) firstIndex = textIndex;
    lastIndex = textIndex;
    queryIndex += 1;
  }
  if (queryIndex !== query.length || firstIndex === -1) return null;
  return { tier: TIER_SUBSEQUENCE, offset: firstIndex, spread: lastIndex - firstIndex + 1 };
}

function scoreMatch(query: string, text: string): MatchScore | null {
  if (!query) return { tier: TIER_EXACT, offset: 0 };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return { tier: TIER_EXACT, offset: 0 };
  return scoreSubstringMatch(q, t) ?? scoreSubsequenceMatch(q, t);
}

function compareMatchScores(a: MatchScore, b: MatchScore): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.offset !== b.offset) return a.offset - b.offset;
  return (a.spread ?? 0) - (b.spread ?? 0);
}

function scoreTextFields(query: string, fields: string[]): MatchScore | null {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return { tier: TIER_EXACT, offset: 0, spread: 0 };
  const aggregate: MatchScore = { tier: TIER_EXACT, offset: 0, spread: 0 };
  for (const token of tokens) {
    let best: MatchScore | null = null;
    for (const field of fields) {
      const score = scoreMatch(token, field);
      if (score && (!best || compareMatchScores(score, best) < 0)) best = score;
    }
    if (!best) return null;
    aggregate.tier += best.tier;
    aggregate.offset += best.offset;
    aggregate.spread = (aggregate.spread ?? 0) + (best.spread ?? token.length);
  }
  return aggregate;
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

export function filterAndRankOptions<T extends { id: string; label: string }>(options: T[], search: string): T[] {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return options;
  const scored = options.flatMap((option) => {
    const score = scoreTextFields(normalized, [option.label, option.id]);
    return score ? [{ option, score }] : [];
  });
  scored.sort((a, b) => compareMatchScores(a.score, b.score) || a.option.label.localeCompare(b.option.label));
  return scored.map((entry) => entry.option);
}
