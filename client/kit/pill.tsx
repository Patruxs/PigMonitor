import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View } from "react-native";
import { SPACING, text, tint } from "./theme.ts";

export function Pill({ theme, label, colour, icon, filled, mono, onPress }: { theme: PluginTheme; label: string; colour?: string; icon?: string; filled?: boolean; mono?: boolean; onPress?: () => void }) {
  const c = colour ?? theme.colors.foregroundMuted;
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1], paddingHorizontal: SPACING[2], height: 22, borderRadius: 11, backgroundColor: filled ? tint(c, "1f") : theme.colors.surface1, borderWidth: 1, borderColor: filled ? tint(c, "66") : theme.colors.border }}>
      {icon ? <Icon name={icon} size={11} color={c} /> : null}
      <Text style={[mono ? text(theme, "code") : text(theme, "label"), { color: c, lineHeight: 14 }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={SPACING[1]}>
      {body}
    </Pressable>
  );
}
