import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { ICON_SIZE, SPACING, text } from "./theme.ts";

/** A section's heading: a 14px icon beside the 13px semibold title, then what the caller adds (a count). */
export function SectionTitle({ theme, icon, title, children }: { theme: PluginTheme; icon: string; title: string; children?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5], paddingHorizontal: SPACING[4], paddingVertical: SPACING[2] }}>
      <Icon name={icon} size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />
      <Text accessibilityRole="header" style={text(theme, "section")}>
        {title}
      </Text>
      {children}
    </View>
  );
}
