import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text } from "react-native";
import type { Status } from "../../shared/view.ts";
import { RADIUS, SPACING, text } from "./theme.ts";

/** A status's colour: working success, waiting warning, gone danger, idle muted (as piggery top). */
export function statusColour(theme: PluginTheme, status: Status, dim?: boolean): string {
  if (dim) return theme.colors.foregroundMuted;
  const c = theme.colors;
  return { working: c.statusSuccess, idle: c.foregroundMuted, waiting: c.statusWarning, gone: c.statusDanger }[status];
}

/** The state as piggery says it ("● working", "◐ waiting"): its glyph is the shape, so it never rests on colour alone. */
export function StateWord({ theme, status, word, dim }: { theme: PluginTheme; status: Status; word: string; dim?: boolean }) {
  return <Text style={[text(theme, "meta"), { color: statusColour(theme, status, dim) }]} numberOfLines={1}>{word}</Text>;
}

/** A filter chip with its count; the chosen one is filled. */
export function Chip({ theme, label, count, on, onPress }: { theme: PluginTheme; label: string; count?: number; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={(state) => {
        const hovered = (state as typeof state & { hovered?: boolean }).hovered === true;
        return { flexDirection: "row", alignItems: "center", gap: SPACING[1.5], paddingHorizontal: SPACING[2], paddingVertical: SPACING[1], borderRadius: RADIUS.md, borderWidth: 1, borderColor: on ? theme.colors.accent : theme.colors.border, backgroundColor: on || state.pressed ? theme.colors.surface2 : hovered ? theme.colors.surface1 : "transparent" };
      }}
    >
      <Text style={text(theme, "label", on ? "foreground" : "foregroundMuted")} numberOfLines={1}>
        {label}
      </Text>
      {count === undefined ? null : <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"] }]}>{count}</Text>}
    </Pressable>
  );
}
