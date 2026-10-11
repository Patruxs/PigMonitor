import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import { notifyStatus } from "../shared/rpc.ts";
import { RADIUS, SPACING, text } from "./kit/theme.ts";
import { QUIET_MS, usePoll } from "./kit/poll.ts";

function useNotifySet(): boolean | null {
  const call = useRpc(notifyStatus);
  const { value } = usePoll(
    async () => {
      const r = await call({});
      return r.ok ? { ok: true as const, value: r.set } : r;
    },
    "notify",
    () => QUIET_MS,
  );
  return value;
}

export function NotifyHint({ theme }: { theme: PluginTheme }) {
  if (useNotifySet() !== false) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACING[2], padding: SPACING[3], borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.lg, backgroundColor: theme.colors.surface1 }}>
      <Icon name="Bell" size={14} color={theme.colors.foregroundMuted} />
      <View style={{ flex: 1, minWidth: 0, gap: SPACING[1] }}>
        <Text style={text(theme, "meta")}>Get told when a team finishes, fails, or its gate answers in its session:</Text>
        <Text selectable style={text(theme, "code")}>
          piggery setup notify add desktop
        </Text>
        <Text style={text(theme, "meta")}>Or ntfy:TOPIC for your phone, or herdr.</Text>
      </View>
    </View>
  );
}
