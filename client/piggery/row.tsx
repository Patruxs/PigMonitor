import type { PluginTheme } from "@getpaseo/plugin";
import type { ReactNode } from "react";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { NAME_MIN, SHARE, STATE_MIN, tailWidth, type Columns } from "./row-layout.ts";
import { taskWords, type Row } from "../../shared/view.ts";
import { Pill } from "../kit/pill.tsx";
import { hovered, PressRow } from "../kit/press.tsx";
import { CARD_RADIUS, DOT, ROW_ONE, SPACING, text, tint } from "../kit/theme.ts";
import { paint, statusColour, usePalette } from "./palette.tsx";
import { RoleAvatar } from "./role.tsx";
import { StatusPill } from "./status.tsx";

export function Lead({ left, children }: { left: number; children: ReactNode }) {
  return <View style={{ flex: 1, minWidth: left + NAME_MIN, flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingLeft: left, paddingRight: SPACING[2], overflow: "hidden" }}>{children}</View>;
}

export function Tail({ theme, row, columns, dim }: { theme: PluginTheme; row: Row; columns: Columns; dim?: boolean }) {
  const palette = usePalette(theme);
  const num = { fontVariant: ["tabular-nums" as const] };
  const cell = { minWidth: 0 };
  const faded = dim ?? row.dim === true;
  return (
    <View style={{ width: tailWidth(columns), flexShrink: 0, flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
      {columns === "both" ? (
        <View style={{ flex: SHARE.role, minWidth: 0, flexDirection: "row" }}>{row.role ? <Pill theme={theme} label={row.role} colour={faded ? theme.colors.foregroundMuted : paint(palette, row.role, row.id)} filled={!faded} /> : null}</View>
      ) : null}
      <View style={{ flex: SHARE.state, minWidth: STATE_MIN, flexDirection: "row" }}>
        <StatusPill theme={theme} status={row.status} word={row.state_text} dim={faded} />
      </View>
      {columns !== "none" ? <Text style={[text(theme, "label"), cell, num, { flex: SHARE.ctx, textAlign: "right" }]} numberOfLines={1}>{row.ctx ?? ""}</Text> : null}
      <Text style={[text(theme, "label"), cell, num, { flex: SHARE.since, textAlign: "right" }]} numberOfLines={1}>{row.since ? `for ${row.since}` : ""}</Text>
    </View>
  );
}

export function AgentRow({ theme, row, left, slot, columns, onPress }: { theme: PluginTheme; row: Row; left: number; slot: number; columns: Columns; onPress: () => void }) {
  const palette = usePalette(theme);
  const dim = row.dim === true;
  return (
    <PressRow theme={theme} onPress={onPress} label={`${row.name}, ${row.state_text}`} style={{ flexDirection: "row", minHeight: ROW_ONE + SPACING[1] }}>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row" }}>
        <Lead left={left}>
          <RoleAvatar theme={theme} name={row.name} role={row.role} id={row.id} size={24} dim={dim} />
          <Text style={[text(theme, "rowTitle", dim ? "foregroundMuted" : "foreground"), { fontWeight: dim ? "400" : "500", flexShrink: 1, minWidth: 0 }]} numberOfLines={1}>
            {row.name}
          </Text>
          {row.gate ? <Pill theme={theme} label="gate" icon="DoorOpen" /> : null}
          {columns !== "both" && row.role ? <Text style={[text(theme, "label"), { color: dim ? theme.colors.foregroundMuted : paint(palette, row.role, row.id) }]} numberOfLines={1}>{row.role}</Text> : null}
        </Lead>
        <Tail theme={theme} row={row} columns={columns} />
      </View>
      <View style={{ width: slot }} />
    </PressRow>
  );
}

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
