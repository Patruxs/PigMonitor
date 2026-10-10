import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { ICON_SIZE, RADIUS, SPACING, text, tint } from "./theme.ts";

export type ButtonTone = "primary" | "danger";

export function Button({ theme, label, icon, tone, busy, disabled, onPress }: { theme: PluginTheme; label: string; icon?: string; tone?: ButtonTone; busy?: boolean; disabled?: boolean; onPress: () => void }) {
  const colour = tone === "danger" ? theme.colors.statusDanger : tone === "primary" ? theme.colors.accentForeground : theme.colors.foreground;
  const fill = tone === "danger" ? tint(theme.colors.statusDanger, "22") : tone === "primary" ? theme.colors.accent : theme.colors.surface2;
  const off = disabled || busy;
  return (
    <Pressable onPress={onPress} disabled={off} accessibilityRole="button" accessibilityLabel={label} style={(state) => ({ flexDirection: "row", alignItems: "center", gap: SPACING[1.5], paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], borderRadius: RADIUS.md, borderWidth: 1, borderColor: tone === "danger" ? theme.colors.statusDanger : tone === "primary" ? theme.colors.accent : theme.colors.border, backgroundColor: fill, opacity: off ? 0.5 : state.pressed ? 0.85 : 1 })}>
      {busy ? <ActivityIndicator size="small" color={colour} /> : icon ? <Icon name={icon} size={ICON_SIZE.sm} color={colour} /> : null}
      <Text style={[text(theme, "label"), { color: colour }]}>{label}</Text>
    </Pressable>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: SPACING[2], marginTop: SPACING[2] }}>{children}</View>;
}
