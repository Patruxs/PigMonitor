import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import { HUMAN, roleWord } from "../../shared/piggery/mail.ts";
import { Avatar, AVATAR_SM } from "../kit/avatar.tsx";
import { Pill } from "../kit/pill.tsx";
import { SPACING, text } from "../kit/theme.ts";
import { paint, usePalette } from "./palette.tsx";

export function RoleAvatar({ theme, name, role, id, size, dim }: { theme: PluginTheme; name: string; role: string | undefined; id: string; size?: number; dim?: boolean }) {
  return <Avatar theme={theme} name={name} colour={paint(usePalette(theme), role, id)} size={size} icon={role === HUMAN ? "User" : undefined} dim={dim} />;
}

export function AvatarStack({ theme, people, max = 5 }: { theme: PluginTheme; people: { id: string; name: string; role?: string; dim?: boolean }[]; max?: number }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {shown.map((p, i) => (
        <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -6, borderRadius: AVATAR_SM / 2 + 1, borderWidth: 1.5, borderColor: theme.colors.surface0 }}>
          <RoleAvatar theme={theme} name={p.name} role={p.role} id={p.id} size={AVATAR_SM} dim={p.dim} />
        </View>
      ))}
      {rest > 0 ? <Text style={[text(theme, "label"), { marginLeft: SPACING[1] }]}>{`+${rest}`}</Text> : null}
    </View>
  );
}

export function RolePill({ theme, role, id }: { theme: PluginTheme; role: string | undefined; id: string }) {
  return <Pill theme={theme} label={roleWord(role, id)} colour={paint(usePalette(theme), role, id)} filled />;
}
