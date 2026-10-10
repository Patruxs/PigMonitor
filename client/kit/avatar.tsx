import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import { ICON_SIZE, tint } from "./theme.ts";

export const AVATAR = 28;
export const AVATAR_SM = 20;

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} _-]/gu, " ").split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Avatar({ theme, name, colour, size = AVATAR, icon, dim }: { theme: PluginTheme; name: string; colour: string; size?: number; icon?: string; dim?: boolean }) {
  const c = dim ? theme.colors.foregroundMuted : colour;
  const big = size >= AVATAR;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint(c, dim ? "14" : "2a"), borderWidth: 1, borderColor: tint(c, "66"), alignItems: "center", justifyContent: "center" }} accessibilityLabel={name}>
      {icon ? <Icon name={icon} size={big ? ICON_SIZE.sm : 11} color={c} /> : <Text style={{ fontSize: big ? 11 : 9, lineHeight: big ? 13 : 11, fontWeight: "600", color: c }}>{initials(name)}</Text>}
    </View>
  );
}
