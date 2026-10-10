import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { hovered } from "./press.tsx";
import { RADIUS, SEGMENT, SPACING, text } from "./theme.ts";

export function TabBar<T extends string>({ theme, tabs, active, onPick }: { theme: PluginTheme; tabs: { id: T; label: string; count?: number }[]; active: T; onPick: (id: T) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1], minHeight: SEGMENT.height }}>
      {tabs.map((tab) => {
        const on = tab.id === active;
        const style = (state: PressableStateCallbackType) => {
          return {
            minHeight: SEGMENT.height - SEGMENT.inset * 2,
            justifyContent: "center" as const,
            paddingHorizontal: SEGMENT.paddingX,
            borderRadius: RADIUS.md,
            backgroundColor: on || state.pressed ? theme.colors.surface2 : hovered(state) ? theme.colors.surface1 : "transparent",
          };
        };
        return (
          <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onPick(tab.id)} style={style}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5] }}>
              <Text style={text(theme, "meta", on ? "foreground" : "foregroundMuted")}>{tab.label}</Text>
              {tab.count === undefined ? null : <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"] }]}>{tab.count}</Text>}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
