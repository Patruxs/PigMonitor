// The host's look, copied: the plugin SDK (0.9.1) exports only colours (PluginTheme). What is shown is
// piggery top's (ps --view); its finish is Paseo's (Settings → Providers: small muted labels, rows split
// by dividers in the border colour). Sources, in Paseo packages/app/src, read 2026-09-28:
//   styles/theme.ts:544-600            SPACING, FONT_SIZE, ICON_SIZE, FONT_WEIGHT, BORDER_RADIUS
//   styles/settings.ts:4-58            section, sectionHeader(Title), card, row, rowBorder, rowTitle, rowHint
//   screens/settings/providers-section.tsx:476-545  row minHeight/gap, hover, status dot, statusLabel, separator
//   components/ui/control-geometry.ts:25-31,225-253  segmented control (sm): heights, inset, padding, radius
//   components/ui/segmented-control.tsx:167-230      segmented gap, selected/hover background, label colours
// Colours always come from the theme prop, never from here.
import type { PluginTheme } from "@getpaseo/plugin";
import type { TextStyle } from "react-native";

/** theme.ts:544 */
export const SPACING = { 0.5: 2, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 } as const;

/** theme.ts:561; `section` is the reference's card heading size (progress/client/section-title.tsx), 13 semibold. */
const FONT_SIZE = { code: 12, sm: 12, section: 13, base: 14, lg: 16 } as const;

/** theme.ts:577 */
export const ICON_SIZE = { sm: 14, md: 16 } as const;

/** theme.ts:591 */
export const RADIUS = { md: 6, lg: 8 } as const;

/** A line's least height (control-geometry.ts:27 FIELD_CONTROL_HEIGHT): a team, a dialog's button, a filter's option. */
export const ROW_MIN = 44;

/** The Board's band divider: one slim line. */
export const ROW_BAND = 28;

/** A fold mark hung in the panel's gutter (SPACING[4] wide): it must fit inside it. */
export const FOLD_MARK = 12;

/** An event's line: dense, as it is only a muted note. */
export const ROW_EVENT = 24;

/** A participant's line: one line, so a team of fifteen stays within a screen. */
export const ROW_ONE = 36;

/**
 * A line is a table across its width: its columns are shares of it, so they line up down the list
 * whatever the width. The name takes the rest after the tail (role, state, ctx, since), which is a
 * fixed fraction of the line (see row.tsx). NAME_MIN keeps the name legible; STATE_MIN fits "◐ waiting".
 */
export const SHARE = { name: 3, role: 1.5, state: 1.5, ctx: 1, since: 1 } as const;
export const NAME_MIN = 120;
export const STATE_MIN = 72;

/** The width a line needs for the role and ctx columns, or for ctx alone, beside the name, tags, state and time. */
export const BOTH_MIN = 560;
export const CTX_MIN = 440;

/** providers-section.tsx:522: the status dot. */
export const DOT = 8;

/** The thin bar at the left edge of an agent row or card: its status. */
export const BAR = 3;

/** control-geometry.ts:26,30,238-242: a segmented control's height and a segment's. */
export const SEGMENT = { height: 32, inset: 2, paddingX: 8 } as const;

/** One tree level's indent. */
export const INDENT = SPACING[4];

/** A disclosure's chevron and the gap after it: what a team's members are indented by, so their bars start under the team's icon. */
export const CHEVRON_SLOT = ICON_SIZE.sm + SPACING[2];

/** At least this wide, the Board is a row of columns; narrower, they stack. */
export const BOARD_COLUMNS_MIN = 720;

/** One Board column's least width. */
export const COLUMN_MIN = 220;

/** A Board card's corner, and its cell's. */
export const CARD_RADIUS = 12;

/** A Board org-chart card's width when cards sit side by side. */
export const ORG_CARD = 216;

/** What a line with an info button keeps at its right edge: participants' lines keep it too, so every state and time lines up. */
export const ASIDE = SPACING[2] + ICON_SIZE.md;

/** The widest a dialog's body reads: prose lines stay short. */
export const READABLE = 680;

/** The key column of a dialog's facts. */
export const KEY_WIDTH = 96;

type Colour = keyof PluginTheme["colors"];

const ROLES = {
  /** settings.ts:14 sectionHeaderTitle: project directories, column labels, Events. */
  label: { fontSize: FONT_SIZE.sm, lineHeight: 16, fontWeight: "400", colour: "foregroundMuted" },
  /** settings.ts:50 rowTitle: a row's name. */
  rowTitle: { fontSize: FONT_SIZE.base, lineHeight: 20, fontWeight: "400", colour: "foreground" },
  /** A card's or a section's heading, beside its 14px icon. */
  section: { fontSize: FONT_SIZE.section, lineHeight: 18, fontWeight: "600", colour: "foreground" },
  /** The header's counts: large figures over their small muted words. */
  stat: { fontSize: 20, lineHeight: 24, fontWeight: "500", colour: "foreground" },
  /** A selected row's name at the top of the detail. */
  detailTitle: { fontSize: FONT_SIZE.lg, lineHeight: 22, fontWeight: "500", colour: "foreground" },
  /** providers-section.tsx:526 statusLabel and separator: state word and the " · " fields. */
  meta: { fontSize: FONT_SIZE.base, lineHeight: 20, fontWeight: "400", colour: "foregroundMuted" },
    /** Tail lines, at the host's code size. */
  code: { fontSize: FONT_SIZE.code, lineHeight: 18, fontWeight: "400", colour: "foreground", fontFamily: "monospace" },
} as const satisfies Record<string, TextStyle & { colour: Colour }>;

export type Role = keyof typeof ROLES;

/** The style of a text role; `colour` swaps only its colour. */
export function text(theme: PluginTheme, role: Role, colour?: Colour): TextStyle {
  const { colour: base, ...style } = ROLES[role];
  return { ...style, color: theme.colors[colour ?? base] };
}

/** At least this wide, the Sessions tab is a conversation list beside the open session; narrower, one at a time. */
export const CHAT_SPLIT_MIN = 680;

/** The conversation list's width beside an open session. */
export const LIST_WIDTH = 300;

/** The least the user can drag the conversation list to; the most is half the pane. */
export const LIST_MIN_WIDTH = 200;

/** A conversation row's avatar, and the open session's. */
export const AVATAR_LG = 36;

/** A conversation row's least height: two lines (name, preview) with room around them. */
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
