import { compareMatchScores, scoreTextFields } from "../../shared/match.ts";

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
