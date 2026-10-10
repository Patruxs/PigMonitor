import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { HUMAN, roleColour, roleWord } from "../../shared/mail.ts";
import type { Status } from "../../shared/view.ts";
import { statusColour } from "./badge.tsx";
import { ICON_SIZE, RADIUS, SPACING, text } from "./theme.ts";

export type Colour = keyof PluginTheme["colors"];

export const AVATAR = 28;
export const AVATAR_SM = 20;
export const BUBBLE_RADIUS = 14;

export function tint(colour: string, alpha = "22"): string {
  return /^#[0-9a-fA-F]{6}$/.test(colour) ? `${colour}${alpha}` : colour;
}

export function paint(theme: PluginTheme, role: string | undefined, id: string): string {
  const p = roleColour(role, id);
  return p.kind === "hex" ? p.value : theme.colors[p.value];
}

export function initials(name: string): string {
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

export function RoleAvatar({ theme, name, role, id, size, dim }: { theme: PluginTheme; name: string; role: string | undefined; id: string; size?: number; dim?: boolean }) {
  return <Avatar theme={theme} name={name} colour={paint(theme, role, id)} size={size} icon={role === HUMAN ? "User" : undefined} dim={dim} />;
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

export function RolePill({ theme, role, id }: { theme: PluginTheme; role: string | undefined; id: string }) {
  return <Pill theme={theme} label={roleWord(role, id)} colour={paint(theme, role, id)} filled />;
}

export function StatusPill({ theme, status, word, dim }: { theme: PluginTheme; status: Status; word: string; dim?: boolean }) {
  const c = statusColour(theme, status, dim);
  const plain = word.replace(/^[^\p{L}]+/u, "");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5], paddingHorizontal: SPACING[2], height: 22, borderRadius: 11, backgroundColor: tint(c, "16"), borderWidth: 1, borderColor: tint(c, "44") }} accessibilityLabel={word}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} />
      <Text style={[text(theme, "label"), { color: c, lineHeight: 14 }]} numberOfLines={1}>
        {plain}
      </Text>
    </View>
  );
}

export const STATUS_WORD: Record<Status, string> = { working: "working", waiting: "waiting", idle: "idle", gone: "ended" };

function usePulse(on: boolean): Animated.Value {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!on) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [on, opacity]);
  return opacity;
}

export function StatusDot({ theme, status, dim, size = 12 }: { theme: PluginTheme; status: Status; dim?: boolean; size?: number }) {
  const c = statusColour(theme, status, dim);
  const opacity = usePulse(status === "working" && !dim);
  const hollow = status === "idle" || status === "gone";
  return (
    <View style={{ position: "absolute", right: -2, bottom: -2, width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors.surface0, padding: 2 }}>
      <Animated.View style={{ flex: 1, borderRadius: size / 2, opacity, backgroundColor: hollow ? theme.colors.surface0 : c, borderWidth: hollow ? 1.5 : 0, borderColor: c }} />
    </View>
  );
}

export function StatusWord({ theme, status, dim }: { theme: PluginTheme; status: Status; dim?: boolean }) {
  const c = statusColour(theme, status, dim);
  const busy = !dim && (status === "working" || status === "waiting");
  return (
    <Text style={[text(theme, "label"), { color: c, fontWeight: busy ? "600" : "400", flexShrink: 0 }]} numberOfLines={1}>
      {STATUS_WORD[status]}
    </Text>
  );
}

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

export function DayDivider({ theme, label }: { theme: PluginTheme; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[3], paddingVertical: SPACING[4] }}>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
      <View style={{ paddingHorizontal: SPACING[3], height: 22, borderRadius: 11, backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border, justifyContent: "center" }}>
        <Text style={text(theme, "label")}>{label}</Text>
      </View>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
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

export function StatCard({ theme, value, label, colour }: { theme: PluginTheme; value: string | number; label: string; colour?: Colour }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 96, minWidth: 96, paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], borderRadius: RADIUS.lg, backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border, gap: SPACING[0.5] }} accessibilityLabel={`${value} ${label}`}>
      <Text style={[text(theme, "stat", colour ?? "foreground"), { fontVariant: ["tabular-nums"] }]}>{value}</Text>
      <Text style={text(theme, "label")}>{label}</Text>
    </View>
  );
}
