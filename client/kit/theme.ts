import type { PluginTheme } from "@getpaseo/plugin";
import type { TextStyle } from "react-native";
import { withAlpha } from "../../shared/piggery/palette.ts";

export const SPACING = { 0.5: 2, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 } as const;

const FONT_SIZE = { code: 12, sm: 12, section: 13, base: 14, lg: 16 } as const;

export const ICON_SIZE = { sm: 14, md: 16 } as const;

export const RADIUS = { md: 6, lg: 8 } as const;

export const ROW_MIN = 44;

export const ROW_ONE = 36;

export const DOT = 8;

export const SEGMENT = { height: 32, inset: 2, paddingX: 8 } as const;

export const CARD_RADIUS = 12;

export const ORG_CARD = 216;

export const READABLE = 680;

export const KEY_WIDTH = 96;

export type Colour = keyof PluginTheme["colors"];

const ROLES = {
  label: { fontSize: FONT_SIZE.sm, lineHeight: 16, fontWeight: "400", colour: "foregroundMuted" },
  rowTitle: { fontSize: FONT_SIZE.base, lineHeight: 20, fontWeight: "400", colour: "foreground" },
  section: { fontSize: FONT_SIZE.section, lineHeight: 18, fontWeight: "600", colour: "foreground" },
  stat: { fontSize: 20, lineHeight: 24, fontWeight: "500", colour: "foreground" },
  detailTitle: { fontSize: FONT_SIZE.lg, lineHeight: 22, fontWeight: "500", colour: "foreground" },
  meta: { fontSize: FONT_SIZE.base, lineHeight: 20, fontWeight: "400", colour: "foregroundMuted" },
  code: { fontSize: FONT_SIZE.code, lineHeight: 18, fontWeight: "400", colour: "foreground", fontFamily: "monospace" },
} as const satisfies Record<string, TextStyle & { colour: Colour }>;

type Role = keyof typeof ROLES;

export function text(theme: PluginTheme, role: Role, colour?: Colour): TextStyle {
  const { colour: base, ...style } = ROLES[role];
  return { ...style, color: theme.colors[colour ?? base] };
}

export const COMPACT_BELOW = 720;

export const CHAT_SPLIT_MIN = 680;

export const LIST_WIDTH = 300;

export const LIST_MIN_WIDTH = 200;

export const AVATAR_LG = 36;

export const ROW_CHAT = 60;

function channels(colour: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{6})/i.exec(colour)?.[1];
  if (!hex) return null;
  return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
}

export function mix(from: string, to: string, amount: number): string {
  const a = channels(from);
  const b = channels(to);
  if (!a || !b) return from;
  return `#${a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}

export function hostColours(theme: PluginTheme) {
  return {
    surface3: mix(theme.colors.surface2, theme.colors.foreground, 0.1),
    foregroundExtraMuted: mix(theme.colors.foregroundMuted, theme.colors.surface0, 0.3),
    borderAccent: mix(theme.colors.border, theme.colors.foreground, 0.04),
  };
}

export const CONTENT_FONT = 15;
export const CONTENT_LINE = Math.round(CONTENT_FONT * 1.4);
export const STREAM_METADATA_FONT = 13;
export const MAX_CONTENT_WIDTH = 820;

export function tint(colour: string, alpha = "22"): string {
  return withAlpha(colour, alpha);
}
