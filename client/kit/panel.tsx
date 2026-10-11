import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { RADIUS, SPACING, text, tint } from "./theme.ts";

export function Legend({ theme, entries }: { theme: PluginTheme; entries: { label: string; colour: string }[] }) {
  if (entries.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACING[3] }}>
      {entries.map((e) => (
        <View key={e.label} style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5] }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: e.colour }} />
          <Text style={text(theme, "label")}>{e.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function Quiet({ theme, icon, label, colour }: { theme: PluginTheme; icon: string; label: string; colour?: string }) {
  const c = colour ?? theme.colors.foregroundMuted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING[1.5], paddingVertical: SPACING[2] }}>
      <Icon name={icon} size={11} color={c} />
      <Text style={[text(theme, "label"), { color: c, flexShrink: 1 }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

export function Panel({ theme, children, tone }: { theme: PluginTheme; children: ReactNode; tone?: string }) {
  return <View style={{ gap: SPACING[2], padding: SPACING[3], borderRadius: RADIUS.lg, backgroundColor: tone ? tint(tone, "0d") : theme.colors.surface1, borderWidth: 1, borderColor: tone ? tint(tone, "55") : theme.colors.border }}>{children}</View>;
}
