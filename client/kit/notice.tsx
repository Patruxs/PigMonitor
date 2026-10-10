import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import { ICON_SIZE, SPACING, text } from "./theme.ts";

/** What the plugin says when there is nothing to draw: one icon, a title, one line of why, apart for each cause. */
const NOTICES: Record<string, { icon: string; title: string; warn?: boolean }> = {
  missing: { icon: "FileQuestion", title: "piggery is not installed", warn: true },
  down: { icon: "ServerOff", title: "The piggery daemon is not running", warn: true },
  older: { icon: "ArrowDownToLine", title: "This piggery is older than the plugin", warn: true },
  newer: { icon: "ArrowUpFromLine", title: "This piggery is newer than the plugin", warn: true },
  failed: { icon: "TriangleAlert", title: "piggery did not answer", warn: true },
  nodb: { icon: "DatabaseZap", title: "piggery's database was not found", warn: true },
  nomail: { icon: "MailOpen", title: "No mail" },
  nolog: { icon: "FileText", title: "No session log yet" },
  empty: { icon: "Inbox", title: "No teams or sessions" },
  loading: { icon: "Loader", title: "Reading piggery…" },
};

export function Notice({ theme, kind, detail }: { theme: PluginTheme; kind: string; detail?: string }) {
  const n = NOTICES[kind] ?? NOTICES.failed;
  const colour = n.warn ? theme.colors.statusWarning : theme.colors.foregroundMuted;
  return (
    <View style={{ padding: SPACING[6], gap: SPACING[2], alignItems: "flex-start" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
        <Icon name={n.icon} size={ICON_SIZE.md} color={colour} />
        <Text accessibilityRole="header" style={[text(theme, "rowTitle"), { flexShrink: 1 }]}>
          {n.title}
        </Text>
      </View>
      {detail ? <Text style={text(theme, "meta")}>{detail}</Text> : null}
    </View>
  );
}
