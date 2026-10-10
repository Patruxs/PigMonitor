import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import { headlineOf, readAgo } from "../shared/events.ts";
import type { ColourKey } from "../shared/palette.ts";
import { tileWidth } from "../shared/tiles.ts";
import type { Daemon, Summary } from "../shared/view.ts";
import { tint } from "./kit/chat.tsx";
import { DOT, RADIUS, SPACING, text } from "./kit/theme.ts";
import { usePalette } from "./palette.tsx";
import { GRACE_MS, pollEvery } from "./poll.ts";

type Colour = keyof PluginTheme["colors"];

type StatKey = "waiting" | "working" | "idle" | "unacked" | "held" | "teams";

const STATS: { key: StatKey; label: string; colour: ColourKey; icon?: string; always?: boolean }[] = [
  { key: "waiting", label: "need you", colour: "waiting" },
  { key: "working", label: "working", colour: "working" },
  { key: "idle", label: "idle", colour: "idle" },
  { key: "unacked", label: "unread mail", colour: "mail", icon: "Mail" },
  { key: "held", label: "held mail", colour: "mailHeld", icon: "Inbox" },
  { key: "teams", label: "teams", colour: "team", icon: "Users", always: true },
];

const HEADLINE_COLOUR: Record<"warning" | "success" | "muted", Colour> = { warning: "statusWarning", success: "foreground", muted: "foregroundMuted" };

const TILE_MIN = 88;
const TILE_MAX = 220;

function StatTile({ theme, n, label, colour: c, icon, width }: { theme: PluginTheme; n: number; label: string; colour: string; icon?: string; width: number | undefined }) {
  const lit = n > 0;
  return (
    <View accessibilityLabel={`${n} ${label}`} style={{ width, minWidth: width === undefined ? TILE_MIN : undefined, paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], borderRadius: RADIUS.lg, borderWidth: 1, borderColor: lit ? tint(c, "55") : theme.colors.border, backgroundColor: lit ? tint(c, "14") : theme.colors.surface1, gap: SPACING[0.5] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5] }}>
        {icon ? <Icon name={icon} size={13} color={lit ? c : theme.colors.foregroundMuted} /> : <View style={{ width: DOT, height: DOT, borderRadius: DOT, backgroundColor: lit ? c : tint(theme.colors.foregroundMuted, "88") }} />}
        <Text style={[text(theme, "stat"), { color: lit ? c : theme.colors.foreground, fontSize: 22, lineHeight: 26, fontWeight: "600", fontVariant: ["tabular-nums"] }]}>{n}</Text>
      </View>
      <Text style={text(theme, "label")} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function Header({ theme, summary, daemon, at, now }: { theme: PluginTheme; summary: Summary; daemon: Daemon | undefined; at: number | null; now: number }) {
  const [rowW, setRowW] = useState(0);
  const palette = usePalette(theme);
  const count = (key: StatKey) => summary[key] ?? 0;
  const stats = STATS.filter((s) => s.always || count(s.key) > 0);
  const tileW = rowW > 0 ? tileWidth(rowW, stats.length, TILE_MIN, TILE_MAX, SPACING[2]) : undefined;
  const fresh = at !== null && now - at <= pollEvery(count("working") + count("waiting") > 0) + GRACE_MS;
  const note = daemon?.version_mismatch ? daemon.version_notes?.[0] : undefined;
  const headline = headlineOf(summary);
  const line = [at !== null && `updated ${readAgo(Math.max(0, Math.round((now - at) / 1000)))}`, daemon && `daemon up ${daemon.age}`].filter(Boolean).join(" · ");
  return (
    <View style={{ gap: SPACING[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: SPACING[3] }}>
        <Text accessibilityRole="header" style={[text(theme, "detailTitle", HEADLINE_COLOUR[headline.tone]), { fontSize: 20, lineHeight: 26, fontWeight: "600", flexShrink: 1 }]}>
          {headline.text}
        </Text>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5] }}>
          {at !== null ? <View accessibilityLabel={fresh ? "up to date" : "overdue"} style={{ width: DOT, height: DOT, borderRadius: DOT, backgroundColor: fresh ? theme.colors.statusSuccess : theme.colors.statusWarning }} /> : null}
          <Text style={text(theme, "label")} numberOfLines={1}>
            {line}
            {note ? <Text style={text(theme, "label", "statusWarning")}>{` · ${note}`}</Text> : null}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACING[2] }} onLayout={(e) => setRowW(e.nativeEvent.layout.width)}>
        {stats.map((s) => (
          <StatTile key={s.key} theme={theme} n={count(s.key)} label={s.label} colour={palette[s.colour]} icon={s.icon} width={tileW} />
        ))}
      </View>
      {daemon?.outdated ? <Text style={text(theme, "label", "statusWarning")}>{daemon.outdated}</Text> : null}
    </View>
  );
}
