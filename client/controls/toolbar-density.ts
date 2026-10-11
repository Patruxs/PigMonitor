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
