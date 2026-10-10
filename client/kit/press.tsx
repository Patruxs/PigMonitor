// One pressable row for everything that opens or folds something: it moves one surface step on hover
// and one more on press (the progress plugin's rowTint, progress/client/row.tsx), instantly, with no
// animation, so reduced motion has nothing to turn off.
import type { PluginTheme } from "@getpaseo/plugin";
import type { ReactNode } from "react";
import { Pressable, type PressableStateCallbackType, type ViewStyle } from "react-native";

export function hovered(state: PressableStateCallbackType): boolean {
  return (state as PressableStateCallbackType & { hovered?: boolean }).hovered === true;
}

export function PressRow({ theme, onPress, expanded, label, style, children }: { theme: PluginTheme; onPress?: () => void; expanded?: boolean; label?: string; style?: ViewStyle; children: ReactNode }) {
  const tint = (state: PressableStateCallbackType) => {
    if (onPress === undefined) return "transparent";
    return state.pressed ? theme.colors.surface2 : hovered(state) ? theme.colors.surface1 : "transparent";
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      style={(state) => [style, { backgroundColor: tint(state) }]}
    >
      {children}
    </Pressable>
  );
}
