import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { taskWords, type Row } from "../../shared/piggery/view.ts";
import { hovered } from "../kit/press.tsx";
import { CARD_RADIUS, DOT, SPACING, text, tint } from "../kit/theme.ts";
import { paint, statusColour, usePalette } from "./palette.tsx";
import { RoleAvatar } from "./role.tsx";

export function AgentCard({ theme, row, task, onPress }: { theme: PluginTheme; row: Row; task?: string; onPress: () => void }) {
  const palette = usePalette(theme);
  const dim = row.dim === true;
  const colour = dim ? theme.colors.foregroundMuted : paint(palette, row.role, row.id);
  const doing = task ? taskWords(task) : "";
  const fallback = row.kind === "solo" ? `${row.harness ?? "agent"} session` : "No task yet";
  const status = statusColour(palette, row.status, dim);
  const busy = row.status === "working" || row.status === "waiting";
  const style = (state: PressableStateCallbackType) => {
    return {
      borderRadius: CARD_RADIUS,
      borderWidth: 1,
      borderColor: hovered(state) || state.pressed ? tint(colour, "99") : busy ? tint(status, "66") : theme.colors.border,
      backgroundColor: state.pressed ? theme.colors.surface1 : theme.colors.surface2,
      overflow: "hidden" as const,
      opacity: dim ? 0.7 : 1,
    };
  };
  const word = row.state_text.replace(/^[^\p{L}]+/u, "");
  const foot = [row.ctx && row.ctx !== "-" ? `${row.ctx} ctx` : "", row.since ? `for ${row.since}` : ""].filter(Boolean).join(" · ");
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${row.name}, ${row.role ?? "solo"}, ${row.state_text}${doing ? `, ${doing}` : ""}`} style={style}>
      <View style={{ height: 2, backgroundColor: busy ? status : "transparent" }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingHorizontal: SPACING[3], paddingTop: SPACING[2], paddingBottom: SPACING[2] }}>
        <RoleAvatar theme={theme} name={row.name} role={row.role} id={row.id} size={24} dim={dim} />
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5] }}>
            <Text style={[text(theme, "rowTitle", dim ? "foregroundMuted" : "foreground"), { fontWeight: "600", flexShrink: 1, minWidth: 0, lineHeight: 18 }]} numberOfLines={1}>
              {row.name}
            </Text>
            {row.gate ? <Icon name="DoorOpen" size={11} color={theme.colors.foregroundMuted} /> : null}
          </View>
          <Text style={[text(theme, "label"), { color: colour, lineHeight: 14, fontWeight: dim ? "400" : "500" }]} numberOfLines={1}>
            {row.role ?? "solo"}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1] }} accessibilityLabel={row.state_text}>
          <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: status, borderWidth: 2, borderColor: tint(status, "44") }} />
          <Text style={[text(theme, "label"), { color: status, lineHeight: 14 }]} numberOfLines={1}>
            {word}
          </Text>
        </View>
      </View>
      <View style={{ height: 1, backgroundColor: theme.colors.border }} />
      <View style={{ paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], gap: SPACING[1] }}>
        <Text style={[text(theme, "label", dim || !doing ? "foregroundMuted" : "foreground"), { fontStyle: doing ? "normal" : "italic" }]} numberOfLines={2}>
          {doing || fallback}
        </Text>
        {foot ? (
          <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"] }]} numberOfLines={1}>
            {foot}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
