import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text } from "react-native";
import { hovered } from "./press.tsx";
import { RADIUS, SPACING, text } from "./theme.ts";

/** A filter chip with its count; the chosen one is filled. */
export function Chip({ theme, label, count, on, onPress }: { theme: PluginTheme; label: string; count?: number; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={(state) => ({ flexDirection: "row", alignItems: "center", gap: SPACING[1.5], paddingHorizontal: SPACING[2], paddingVertical: SPACING[1], borderRadius: RADIUS.md, borderWidth: 1, borderColor: on ? theme.colors.accent : theme.colors.border, backgroundColor: on || state.pressed ? theme.colors.surface2 : hovered(state) ? theme.colors.surface1 : "transparent" })}
    >
      <Text style={text(theme, "label", on ? "foreground" : "foregroundMuted")} numberOfLines={1}>
        {label}
      </Text>
      {count === undefined ? null : <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"] }]}>{count}</Text>}
    </Pressable>
  );
}

export { statusColour } from "../piggery/status.tsx";
