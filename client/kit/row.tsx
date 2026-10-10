// A participant as one line, however many there are: a table across the line's width. Its columns are
// shares of it (theme.ts SHARE), so they line up down the list for every kind of line (members, solos,
// gone lines, team lines): the lead (the avatar, the name, the `gate` tag) takes
// what the tail leaves, and the tail (role, state, ctx, since) is a fixed fraction of the line. The
// name shortens before its tag does. Narrow, the role goes first, then ctx (see columnsFor). Everything
// else (harness, model, turns, age, unacked) is in the row's dialog.
import type { PluginTheme } from "@getpaseo/plugin";
import type { ReactNode } from "react";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import type { Row } from "../../shared/view.ts";
import { paint, statusColour, usePalette } from "../palette.tsx";
import { Pill, RoleAvatar, StatusPill, tint } from "./chat.tsx";
import { PressRow } from "./press.tsx";
import { BOTH_MIN, CARD_RADIUS, CTX_MIN, DOT, NAME_MIN, ROW_ONE, SHARE, SPACING, STATE_MIN, text } from "./theme.ts";

/** Which muted columns a line this wide (px) has room for: the role goes first, then ctx. */
export type Columns = "both" | "ctx" | "none";
export const columnsFor = (width: number): Columns => (width >= BOTH_MIN ? "both" : width >= CTX_MIN ? "ctx" : "none");

/** The tail's width as a share of the line: the same for every line, so its columns start at one x. */
function tailWidth(columns: Columns, state: boolean): `${number}%` {
  const tail = (state ? SHARE.state : 0) + SHARE.since + (columns !== "none" ? SHARE.ctx : 0) + (columns === "both" ? SHARE.role : 0);
  return `${(100 * tail) / (SHARE.name + tail)}%`;
}

/** The left part of a line: `left` px of indent (and the chevron's room), then what the caller puts, then the gap every column has, so a tag never touches the state; never narrower than the name needs. */
export function Lead({ left, children }: { left: number; children: ReactNode }) {
  return <View style={{ flex: 1, minWidth: left + NAME_MIN, flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingLeft: left, paddingRight: SPACING[2], overflow: "hidden" }}>{children}</View>;
}

/** The columns after the name: role, state, ctx, since (a line without a role or ctx leaves its cells empty). */
export function Tail({ theme, row, columns, dim, noState }: { theme: PluginTheme; row: Row; columns: Columns; dim?: boolean; /** The state is said elsewhere (a Board column's heading): leave its cell out. */ noState?: boolean }) {
  const palette = usePalette(theme);
  const num = { fontVariant: ["tabular-nums" as const] };
  const cell = { minWidth: 0 };
  const faded = dim ?? row.dim === true;
  return (
    <View style={{ width: tailWidth(columns, !noState), flexShrink: 0, flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
      {columns === "both" ? (
        <View style={{ flex: SHARE.role, minWidth: 0, flexDirection: "row" }}>{row.role ? <Pill theme={theme} label={row.role} colour={faded ? theme.colors.foregroundMuted : paint(palette, row.role, row.id)} filled={!faded} /> : null}</View>
      ) : null}
      {noState ? null : (
        <View style={{ flex: SHARE.state, minWidth: STATE_MIN, flexDirection: "row" }}>
          <StatusPill theme={theme} status={row.status} word={row.state_text} dim={faded} />
        </View>
      )}
      {columns !== "none" ? <Text style={[text(theme, "label"), cell, num, { flex: SHARE.ctx, textAlign: "right" }]} numberOfLines={1}>{row.ctx ?? ""}</Text> : null}
      <Text style={[text(theme, "label"), cell, num, { flex: SHARE.since, textAlign: "right" }]} numberOfLines={1}>{row.since ? `for ${row.since}` : ""}</Text>
    </View>
  );
}

/**
 * The Overview's participant line; the Board's card is the same with `columns` "none", no indent and no
 * slot. `slot` is what stays free at the right edge (the room of a line's info button), the same for
 * every kind of line at a width.
 */
export function AgentRow({ theme, row, left, slot, columns, noState, onPress }: { theme: PluginTheme; row: Row; left: number; slot: number; columns: Columns; noState?: boolean; onPress: () => void }) {
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
        <Tail theme={theme} row={row} columns={columns} noState={noState} />
      </View>
      <View style={{ width: slot }} />
    </PressRow>
  );
}

/** A task's title as mail titles it, without its leading #N: what the card says the agent is doing. */
export function taskWords(title: string): string {
  return title.replace(/^#\d+\s*/, "").trim();
}

/**
 * A Board card, one node of a team's org chart: who (avatar, name, the gate's door), then its role
 * and its state as pills, so what was spawned and what it is in read without the card's place; then
 * what it is doing (its task's title, one line; without one, what kind of session it is) and, muted,
 * its context size and how long it has been in this state. A bar at the left
 * carries the state's colour; hover marks the border in the role's colour.
 */
export function AgentCard({ theme, row, task, onPress }: { theme: PluginTheme; row: Row; task?: string; onPress: () => void }) {
  const palette = usePalette(theme);
  const dim = row.dim === true;
  const colour = dim ? theme.colors.foregroundMuted : paint(palette, row.role, row.id);
  const doing = task ? taskWords(task) : "";
  const fallback = row.kind === "solo" ? `${row.harness ?? "agent"} session` : "No task yet";
  const status = statusColour(palette, row.status, dim);
  const busy = row.status === "working" || row.status === "waiting";
  const style = (state: PressableStateCallbackType) => {
    const hovered = (state as PressableStateCallbackType & { hovered?: boolean }).hovered === true;
    return {
      borderRadius: CARD_RADIUS,
      borderWidth: 1,
      borderColor: hovered || state.pressed ? tint(colour, "99") : busy ? tint(status, "66") : theme.colors.border,
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
