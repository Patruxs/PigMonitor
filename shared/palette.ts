export const PALETTE_KEYS = ["working", "waiting", "idle", "gone", "supervisor", "lead", "peer", "executor", "advisor", "mail", "mailHeld", "team", "teamHues"] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type ColourKey = Exclude<PaletteKey, "teamHues">;
export type RoleKey = "supervisor" | "lead" | "peer" | "executor" | "advisor";
export type PaletteValues = Record<PaletteKey, string>;
export type PaletteOverrides = Partial<PaletteValues>;

export const THEME_TOKENS = ["surface0", "surface1", "surface2", "border", "foreground", "foregroundMuted", "accent", "accentForeground", "statusSuccess", "statusWarning", "statusDanger"] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];

export const MAX_TEAM_HUES = 8;
export const DEFAULT_TEAM_HUES = ["#fbbf24", "#fb923c", "#f87171", "#a3e635", "#e879f9", "#818cf8", "#22d3ee", "#facc15"];

export const DEFAULT_PALETTE: PaletteValues = {
  working: "statusSuccess",
  waiting: "statusWarning",
  idle: "foregroundMuted",
  gone: "statusDanger",
  supervisor: "#a78bfa",
  lead: "#38bdf8",
  peer: "#34d399",
  executor: "#2dd4bf",
  advisor: "#f472b6",
  mail: "#f472b6",
  mailHeld: "#fb923c",
  team: "#a78bfa",
  teamHues: DEFAULT_TEAM_HUES.join(", "),
};

export const ROLE_KEYS: Record<string, RoleKey> = {
  supervisor: "supervisor",
  chair: "supervisor",
  lead: "lead",
  peer: "peer",
  executor: "executor",
  member: "executor",
  advisor: "advisor",
  oracle: "advisor",
  reviewer: "advisor",
};

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isHex(value: string): boolean {
  return HEX.test(value);
}

export function isThemeToken(value: string): value is ThemeToken {
  return (THEME_TOKENS as readonly string[]).includes(value);
}

export function parseTeamHues(value: string): string[] | null {
  const hues = value.split(",").map((hue) => hue.trim()).filter((hue) => hue !== "");
  if (hues.length < 1 || hues.length > MAX_TEAM_HUES) return null;
  return hues.every(isHex) ? hues : null;
}

export function valueError(key: PaletteKey, value: string): string | null {
  const trimmed = value.trim();
  if (key === "teamHues") return parseTeamHues(trimmed) ? null : `Team hues takes 1 to ${MAX_TEAM_HUES} hex colours separated by commas, e.g. #fbbf24, #22d3ee.`;
  if (isHex(trimmed) || isThemeToken(trimmed)) return null;
  return `"${trimmed}" is not a colour for ${key}: use #rgb, #rrggbb, #rrggbbaa or a theme token (${THEME_TOKENS.join(", ")}).`;
}

function isPaletteKey(key: string): key is PaletteKey {
  return (PALETTE_KEYS as readonly string[]).includes(key);
}

export function mergePalette(overrides: unknown): PaletteValues {
  const stored = typeof overrides === "object" && overrides !== null ? (overrides as Record<string, unknown>) : {};
  const out: PaletteValues = { ...DEFAULT_PALETTE };
  for (const key of PALETTE_KEYS) {
    const value = stored[key];
    if (typeof value === "string" && valueError(key, value) === null) out[key] = value.trim();
  }
  return out;
}

export type PaletteChange = { ok: true; overrides: PaletteOverrides } | { ok: false; error: string };

export function setPaletteValue(overrides: PaletteOverrides, key: PaletteKey, value: string): PaletteChange {
  const error = valueError(key, value);
  if (error) return { ok: false, error };
  const trimmed = value.trim();
  if (trimmed === DEFAULT_PALETTE[key]) return { ok: true, overrides: resetPaletteValue(overrides, key) };
  return { ok: true, overrides: { ...overrides, [key]: trimmed } };
}

export function resetPaletteValue(overrides: PaletteOverrides, key: PaletteKey): PaletteOverrides {
  const { [key]: _dropped, ...rest } = overrides;
  return rest;
}

export function resetPalette(): PaletteOverrides {
  return {};
}

export function teamHuesOf(values: PaletteValues): string[] {
  return parseTeamHues(values.teamHues) ?? DEFAULT_TEAM_HUES;
}

export function hueFor(key: string, hues: readonly string[]): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return hues[h % hues.length];
}

export function exportPalette(overrides: PaletteOverrides): string {
  return JSON.stringify(mergePalette(overrides), null, 2);
}

export function importPalette(text: string): PaletteChange {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: "That is not JSON. Paste what Copy palette as JSON gave." };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return { ok: false, error: "A palette is a JSON object of colour keys." };
  let overrides: PaletteOverrides = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!isPaletteKey(key)) return { ok: false, error: `"${key}" is not a palette key. Keys: ${PALETTE_KEYS.join(", ")}.` };
    if (typeof value !== "string") return { ok: false, error: `The value of ${key} must be text.` };
    const change = setPaletteValue(overrides, key, value);
    if (!change.ok) return change;
    overrides = change.overrides;
  }
  return { ok: true, overrides };
}

function alphaOf(hexPair: string): number {
  return Number.parseInt(hexPair, 16) / 255;
}

function twoHex(fraction: number): string {
  return Math.round(Math.max(0, Math.min(1, fraction)) * 255).toString(16).padStart(2, "0");
}

export function withAlpha(colour: string, alpha: string): string {
  const factor = alphaOf(alpha);
  const value = colour.trim();
  if (isHex(value)) {
    const digits = value.slice(1);
    const full = digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits;
    const base = full.slice(0, 6);
    const own = full.length === 8 ? alphaOf(full.slice(6)) : 1;
    return `#${base}${twoHex(own * factor)}`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(value);
  if (rgb) {
    const own = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? Number.parseFloat(rgb[4]) / 100 : Number.parseFloat(rgb[4]);
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${Number((own * factor).toFixed(3))})`;
  }
  return value;
}
