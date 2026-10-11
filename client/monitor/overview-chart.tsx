import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useRef, useState } from "react";
import { Animated, PanResponder, Text, View } from "react-native";
import { basenameOf, countStatuses } from "../piggery/events.ts";
import { keptAxisSteps, localTicks } from "./axis.ts";
import { currentBar, eventDots, EVENT_DOT, EXIT_DOT, exitMark, type Scale, xOf } from "./track-geometry.ts";
import { clockText, type Detail, type Dir, type Row, type Status, type Tone, type View as PigView } from "../../shared/piggery/view.ts";
import { barColours, PastSegments } from "./gantt.tsx";
import { piecesIn, uncoveredIn, type Segment } from "../../shared/piggery/segments.ts";
import { Pill } from "../kit/pill.tsx";
import { AvatarStack, RoleAvatar, RolePill } from "../piggery/role.tsx";
import { paint, statusColour, teamColour, usePalette } from "../piggery/palette.tsx";
import { PressRow } from "../kit/press.tsx";
import { DOT, ICON_SIZE, SPACING, text, tint } from "../kit/theme.ts";

interface Member {
  row: Row;
  detail?: Detail;
}

export interface Group {
  key: string;
  title: string;
  template?: string;
  where: string;
  solo: boolean;
  members: Member[];
  hidden: number;
  info?: string;
}

interface Sleeper {
  key: string;
  name: string;
  where: string;
  closed: boolean;
  agents: number;
  info: string;
}

const RANK: Record<Status, number> = { waiting: 0, working: 1, idle: 2, gone: 3 };

export function groupsOfView(view: PigView, dirs: Dir[], start: number): { groups: Group[]; sleepers: Sleeper[] } {
  const groups: Group[] = [];
  const sleepers: Sleeper[] = [];
  const member = (r: Row): Member => ({ row: r, detail: view.details[r.id] });
  const shown = (r: Row) => r.status !== "gone" || (r.state_since ?? 0) >= start;
  for (const dir of dirs) {
    const where = basenameOf(dir.path);
    const solos: Member[] = [];
    for (const b of dir.blocks) {
      const agents = b.rows.filter((r) => r.kind === "member");
      const live = agents.filter((r) => r.status !== "gone");
      const visible = agents.filter(shown);
      if (b.head) {
        if (live.length > 0) groups.push({ key: b.head.id, title: b.head.name, template: b.head.template, where, solo: false, members: visible.map(member), hidden: agents.length - visible.length, info: b.head.detail });
        else sleepers.push({ key: b.head.id, name: b.head.name, where, closed: false, agents: agents.length, info: b.head.detail });
        continue;
      }
      const first = b.rows[0];
      if (first?.kind === "team") {
        if (live.length > 0) groups.push({ key: first.id, title: first.name, where, solo: false, members: visible.map(member), hidden: agents.length - visible.length, info: first.id });
        else sleepers.push({ key: first.id, name: first.name, where, closed: Boolean(first.closed), agents: agents.length, info: first.id });
        continue;
      }
      for (const r of b.rows) if (r.kind === "solo" && shown(r)) solos.push(member(r));
    }
    if (solos.length > 0) groups.push({ key: `solo:${dir.path}`, title: where, where: dir.label.replace(/^…\//, ""), solo: true, members: solos, hidden: 0 });
  }
  for (const g of groups) if (g.solo) g.members.sort((x, y) => RANK[x.row.status] - RANK[y.row.status]);
  groups.sort((x, y) => Math.min(9, ...x.members.map((m) => RANK[m.row.status])) - Math.min(9, ...y.members.map((m) => RANK[m.row.status])));
  return { groups, sleepers };
}

export const WINDOWS: { label: string; ms: number; tick: number }[] = [
  { label: "30m", ms: 30 * 60_000, tick: 5 * 60_000 },
  { label: "2h", ms: 2 * 3_600_000, tick: 15 * 60_000 },
  { label: "6h", ms: 6 * 3_600_000, tick: 60 * 60_000 },
  { label: "24h", ms: 24 * 3_600_000, tick: 4 * 3_600_000 },
];

export const LABEL_W = 280;
export const LABEL_W_NARROW = 132;
const TREE_STEP = 18;
const TREE_INK = "77";
const TRACK_H = 52;
const BAR_H = 26;
const LIFE_H = 3;
export const NOW_PAD = 20;
export const MIN_TICK_PX = 64;
const SLIDER_H = 10;
const AXIS_H = 36;
const WORD_MIN = 88;
const DOING_MIN = 260;

export type { Scale };

const ticksOf = (scale: Scale, tick: number) => localTicks(scale.start, scale.now, tick);

const LABEL_GAP = SPACING[2];
const LABEL_BOX_W = 160;
const NOW_PILL_HALF = 20;

export function Axis({ theme, scale, tick }: { theme: PluginTheme; scale: Scale; tick: number }) {
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});
  const ticks = ticksOf(scale, tick).map(({ t, step }) => ({ t, step, x: xOf(scale, t), label: clockText(t, scale.now) }));
  const measured = ticks.flatMap((m) => (labelWidths[m.label] === undefined ? [] : [{ step: m.step, x: m.x - labelWidths[m.label] / 2, width: labelWidths[m.label] }]));
  const kept = new Set(keptAxisSteps(measured, scale.width - NOW_PILL_HALF - LABEL_GAP, LABEL_GAP));
  const measure = (label: string, width: number) => setLabelWidths((widths) => (widths[label] === width ? widths : { ...widths, [label]: width }));
  return (
    <View style={{ height: AXIS_H, position: "relative" }}>
      {ticks.map((m) => (
        <View key={m.t} style={{ position: "absolute", left: m.x - LABEL_BOX_W / 2, top: 0, bottom: 0, width: LABEL_BOX_W, alignItems: "center", justifyContent: "flex-end" }}>
          <Text onLayout={(e) => measure(m.label, e.nativeEvent.layout.width)} numberOfLines={1} aria-hidden={!kept.has(m.step)} style={[text(theme, "label"), { color: theme.colors.foreground, fontVariant: ["tabular-nums"], marginBottom: SPACING[2], opacity: kept.has(m.step) ? 1 : 0 }]}>{m.label}</Text>
          <View style={{ position: "absolute", left: LABEL_BOX_W / 2 - 1, bottom: 0, width: 2, height: SPACING[2], borderRadius: 1, backgroundColor: theme.colors.accent, opacity: kept.has(m.step) ? 0.8 : 0.4 }} />
        </View>
      ))}
      <View style={{ position: "absolute", left: scale.width, top: 0, bottom: 0, alignItems: "center", width: 0 }}>
        <View style={{ position: "absolute", top: SPACING[1.5], paddingHorizontal: SPACING[2], height: 20, borderRadius: 10, backgroundColor: theme.colors.accent, justifyContent: "center" }}>
          <Text style={{ color: theme.colors.accentForeground, fontWeight: "700", fontSize: 11, lineHeight: 13 }}>now</Text>
        </View>
        <View style={{ position: "absolute", top: SPACING[1.5] + 20, bottom: 0, width: 2, backgroundColor: theme.colors.accent }} />
      </View>
    </View>
  );
}

export function Grid({ theme, scale, tick }: { theme: PluginTheme; scale: Scale; tick: number }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>
      {ticksOf(scale, tick).map(({ t }) => (
        <View key={t} style={{ position: "absolute", left: xOf(scale, t), top: 0, bottom: 0, width: 1, backgroundColor: theme.colors.border, opacity: 0.7 }} />
      ))}
      <View style={{ position: "absolute", left: scale.width - 1, top: 0, bottom: 0, width: 2, backgroundColor: theme.colors.accent, opacity: 0.8 }} />
    </View>
  );
}

function stateWords(row: Row): { word: string; since: string } {
  return { word: row.state_text.replace(/^[^\p{L}]+/u, ""), since: row.since ?? "" };
}

export function currentWordFits(row: Row, scale: Scale): boolean {
  const since = row.state_since ?? row.created_at ?? scale.start;
  return xOf(scale, scale.now) - xOf(scale, Math.max(since, scale.start)) >= WORD_MIN;
}

export function Track({ theme, member, segments, scale, events, onPress }: { theme: PluginTheme; member: Member; segments: Segment[]; scale: Scale; events: { t: number; tone: Tone; type: string }[]; onPress: () => void }) {
  const palette = usePalette(theme);
  const { row } = member;
  const born = row.created_at ?? scale.start;
  const since = row.state_since ?? born;
  const gone = row.status === "gone";
  const end = gone ? since : scale.now;
  const lifeX = xOf(scale, Math.max(born, scale.start));
  const stateX = xOf(scale, Math.max(since, scale.start));
  const { left: stateLeft, width: stateW } = currentBar(scale, since);
  const { x: exitX, labelSide } = exitMark(scale, since);
  const exitLabelLeft = labelSide === "right";
  const { word, since: sinceText } = stateWords(row);
  const doing = member.detail?.task ? member.detail.task.title.replace(/^#\d+\s*/, "").trim() : "";
  const own = paint(palette, row.role, row.id);
  const colours = barColours(theme, palette, row.status, own);
  const top = TRACK_H / 2 - BAR_H / 2;
  const inside = currentWordFits(row, scale);
  const pieces = piecesIn(segments, scale.start, Math.min(since, scale.now), scale.now);
  const lifeGaps = uncoveredIn(Math.max(born, scale.start), end, gone ? pieces : [...pieces, { start: since, end: scale.now }]);
  return (
    <PressRow theme={theme} onPress={onPress} label={`${row.name}, ${row.state_text}`} style={{ height: TRACK_H, justifyContent: "center" }}>
      {lifeGaps.map((gap) => (
        <View key={gap.start} style={{ position: "absolute", left: xOf(scale, gap.start), width: Math.max(2, xOf(scale, gap.end) - xOf(scale, gap.start)), top: TRACK_H / 2 - LIFE_H / 2, height: LIFE_H, borderRadius: LIFE_H / 2, backgroundColor: own, opacity: gone ? 0.25 : 0.55 }} />
      ))}
      {born >= scale.start && !gone ? <View style={{ position: "absolute", left: lifeX - 1, top: TRACK_H / 2 - 7, width: 3, height: 14, borderRadius: 1.5, backgroundColor: own }} /> : null}
      <PastSegments theme={theme} pieces={pieces} xOf={(t) => xOf(scale, t)} until={gone ? exitX : stateLeft} top={top} height={BAR_H} own={own} />
      {!gone ? (
        <>
          <View style={{ position: "absolute", left: stateLeft, width: stateW, top, height: BAR_H, borderRadius: 6, backgroundColor: colours.fill, borderWidth: 1, borderColor: colours.border, overflow: "hidden", justifyContent: "center", paddingHorizontal: inside ? SPACING[2] : 0 }}>
            {inside ? (
              <Text style={[text(theme, "label"), { color: colours.ink, fontWeight: "700", lineHeight: 16 }]} numberOfLines={1}>
                {word}
                {sinceText ? <Text style={{ fontWeight: "500", opacity: 0.9 }}>{`  ${sinceText}`}</Text> : null}
                {doing && stateW >= DOING_MIN ? <Text style={{ fontWeight: "400", opacity: 0.85 }}>{`   ${doing}`}</Text> : null}
              </Text>
            ) : null}
          </View>
        </>
      ) : (
        <>
          <View style={[{ position: "absolute", top, height: BAR_H, flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING[2], borderRadius: 6, backgroundColor: tint(palette.gone, "1f"), borderWidth: 1, borderColor: tint(palette.gone, "88") }, exitLabelLeft ? { left: exitX + EXIT_DOT / 2 + SPACING[1] } : { right: scale.width - exitX + EXIT_DOT / 2 + SPACING[1] }]}>
            <Text style={[text(theme, "label"), { color: palette.gone, fontWeight: "600", lineHeight: 16, fontVariant: ["tabular-nums"] }]} numberOfLines={1}>{`exited ${clockText(since, scale.now)}`}</Text>
          </View>
          <View style={{ position: "absolute", left: exitX - EXIT_DOT / 2, top: TRACK_H / 2 - EXIT_DOT / 2, width: EXIT_DOT, height: EXIT_DOT, borderRadius: EXIT_DOT / 2, borderWidth: 2, borderColor: theme.colors.surface0, backgroundColor: palette.gone }} />
        </>
      )}
      {row.last_turn_end && row.last_turn_end >= scale.start && !gone && row.status === "idle" ? <View style={{ position: "absolute", left: xOf(scale, row.last_turn_end) - 1, top: top - 3, width: 2, height: BAR_H + 6, borderRadius: 1, backgroundColor: palette.waiting, opacity: 0.9 }} /> : null}
      {eventDots(events, (t) => xOf(scale, t)).map((dot) => (
        <View key={dot.x} pointerEvents="none" style={{ position: "absolute", left: dot.x - (EVENT_DOT - 1) / 2, top: top - 6, flexDirection: "row", alignItems: "center", gap: 2 }}>
          <View style={{ width: EVENT_DOT, height: EVENT_DOT, borderRadius: 6, borderWidth: 2, borderColor: theme.colors.surface0, backgroundColor: dot.tone === "danger" ? theme.colors.statusDanger : dot.tone === "warning" ? theme.colors.statusWarning : theme.colors.accent }} />
          {dot.count > 1 ? <Text style={[text(theme, "label"), { fontSize: 10, lineHeight: 12, fontWeight: "700", fontVariant: ["tabular-nums"], color: theme.colors.foreground, backgroundColor: theme.colors.surface0, borderRadius: 6, paddingHorizontal: 3 }]}>{`+${dot.count - 1}`}</Text> : null}
        </View>
      ))}
    </PressRow>
  );
}

export function lastSibling(members: Member[], i: number): boolean {
  const depth = members[i].row.depth;
  for (const n of members.slice(i + 1)) {
    if (n.row.depth < depth) return true;
    if (n.row.depth === depth) return false;
  }
  return true;
}

function TreeGuides({ theme, depth, colour, last }: { theme: PluginTheme; depth: number; colour: string; last: boolean }) {
  if (depth === 0) return null;
  const x = SPACING[3] + (depth - 1) * TREE_STEP + 6;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: x + TREE_STEP }}>
      {Array.from({ length: depth - 1 }, (_, i) => (
        <View key={i} style={{ position: "absolute", left: SPACING[3] + i * TREE_STEP + 6, top: 0, bottom: 0, width: 1, backgroundColor: tint(theme.colors.foregroundMuted, "44") }} />
      ))}
      <View style={{ position: "absolute", left: x, top: 0, height: last ? TRACK_H / 2 : TRACK_H, width: 2, borderRadius: 1, backgroundColor: tint(colour, TREE_INK) }} />
      <View style={{ position: "absolute", left: x, top: TRACK_H / 2 - 1, width: TREE_STEP - 4, height: 2, borderRadius: 1, backgroundColor: tint(colour, TREE_INK) }} />
    </View>
  );
}

export function TrackLabel({ theme, member, narrow, last, stateHere, onPress }: { theme: PluginTheme; member: Member; narrow: boolean; last: boolean; stateHere: boolean; onPress: () => void }) {
  const palette = usePalette(theme);
  const { row } = member;
  const colour = paint(palette, row.role, row.id);
  const dim = row.status === "gone";
  const status = statusColour(palette, row.status);
  const indent = row.depth * TREE_STEP;
  return (
    <PressRow theme={theme} onPress={onPress} label={row.name} style={{ height: TRACK_H, flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingLeft: SPACING[3] + indent, paddingRight: SPACING[2], opacity: dim ? 0.55 : 1 }}>
      <TreeGuides theme={theme} depth={row.depth} colour={colour} last={last} />
      <View>
        <RoleAvatar theme={theme} name={row.name} role={row.role} id={row.id} size={narrow ? 22 : 28} dim={dim} />
        <View style={{ position: "absolute", right: -2, bottom: -2, width: 10, height: 10, borderRadius: 5, backgroundColor: status, borderWidth: 2, borderColor: theme.colors.surface0 }} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1] }}>
          <Text style={[text(theme, "rowTitle"), { fontWeight: "600", flexShrink: 1 }]} numberOfLines={1}>
            {row.name}
          </Text>
          {row.gate ? <Icon name="DoorOpen" size={11} color={theme.colors.foregroundMuted} /> : null}
        </View>
        {narrow && !stateHere ? null : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5] }}>
            {narrow ? null : <RolePill theme={theme} role={row.role} id={row.id} />}
            {row.ctx && !narrow ? <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"], flexShrink: 1 }]} numberOfLines={1}>{row.ctx}</Text> : null}
            {stateHere ? (
              <Text style={[text(theme, "label"), { color: status, fontWeight: "700", flexShrink: 0 }]} numberOfLines={1}>
                {stateWords(row).word}
                {row.since ? <Text style={{ fontWeight: "500", color: theme.colors.foregroundMuted }}>{` ${row.since}`}</Text> : null}
              </Text>
            ) : null}
          </View>
        )}
      </View>
      {row.unacked > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: SPACING[1.5], height: 20, borderRadius: 10, backgroundColor: tint(palette.mail, "1f") }}>
          <Icon name="Mail" size={11} color={palette.mail} />
          <Text style={[text(theme, "label"), { color: palette.mail, fontVariant: ["tabular-nums"], fontWeight: "600" }]}>{row.unacked}</Text>
        </View>
      ) : null}
    </PressRow>
  );
}

function CountDots({ theme, rows }: { theme: PluginTheme; rows: Row[] }) {
  const palette = usePalette(theme);
  const c = countStatuses(rows);
  const parts = (["working", "waiting", "idle", "gone"] as const).filter((s) => c[s] > 0);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[3] }}>
      {parts.map((s) => (
        <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1] }}>
          <View style={{ width: DOT, height: DOT, borderRadius: DOT, backgroundColor: statusColour(palette, s) }} />
          <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"] }]}>
            <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{c[s]}</Text>
            {` ${s}`}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function LaneHead({ theme, group, open, onToggle, onInfo }: { theme: PluginTheme; group: Group; open: boolean; onToggle: () => void; onInfo: (id: string) => void }) {
  const palette = usePalette(theme);
  const faces = group.members.filter((m) => m.row.status !== "gone");
  const accent = group.solo ? theme.colors.foregroundMuted : teamColour(palette, group.key);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: group.solo ? theme.colors.surface1 : tint(accent, "14"), borderLeftWidth: 3, borderLeftColor: accent }}>
      <PressRow theme={theme} onPress={onToggle} expanded={open} label={`${open ? "Collapse" : "Expand"} ${group.title}`} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />
      </PressRow>
      <PressRow theme={theme} onPress={group.info ? () => onInfo(group.info as string) : undefined} label={group.title} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: SPACING[2], height: 40, paddingRight: SPACING[3] }}>
        <Icon name={group.solo ? "Folder" : "Users"} size={ICON_SIZE.sm} color={accent} />
        <Text style={[text(theme, "section"), { flexShrink: 0, color: group.solo ? theme.colors.foreground : accent }]} numberOfLines={1}>
          {group.title}
        </Text>
        {group.template ? <Pill theme={theme} label={group.template} colour={accent} filled /> : null}
        <Text style={[text(theme, "label"), { flexShrink: 1 }]} numberOfLines={1}>
          {group.solo ? "solo" : group.where}
        </Text>
        <View style={{ flex: 1 }} />
        {!open && faces.length > 0 ? <AvatarStack theme={theme} people={faces.map((m) => ({ id: m.row.id, name: m.row.name, role: m.row.role }))} /> : null}
        <CountDots theme={theme} rows={group.members.map((m) => m.row)} />
        {group.hidden > 0 ? <Text style={text(theme, "label")}>{`${group.hidden} gone earlier`}</Text> : null}
      </PressRow>
    </View>
  );
}

export function ChartLegend({ theme }: { theme: PluginTheme }) {
  const palette = usePalette(theme);
  const bar = (colour: string, label: string, border?: string) => (
    <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5] }}>
      <View style={{ width: 18, height: 10, borderRadius: 3, backgroundColor: colour, borderWidth: border ? 1 : 0, borderColor: border }} />
      <Text style={text(theme, "label")}>{label}</Text>
    </View>
  );
  const mark = (colour: string, label: string, shape: "line" | "dot" | "tick") => (
    <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5] }}>
      {shape === "line" ? <View style={{ width: 18, height: LIFE_H, borderRadius: LIFE_H / 2, backgroundColor: colour }} /> : null}
      {shape === "dot" ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colour }} /> : null}
      {shape === "tick" ? <View style={{ width: 2, height: 12, borderRadius: 1, backgroundColor: colour }} /> : null}
      <Text style={text(theme, "label")}>{label}</Text>
    </View>
  );
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACING[4], rowGap: SPACING[2] }}>
      {bar(palette.working, "working")}
      {bar(palette.waiting, "waiting")}
      {bar(tint(theme.colors.accent, "2a"), "idle, in the agent's colour", tint(theme.colors.accent, "88"))}
      {mark(tint(theme.colors.accent, "99"), "alive", "line")}
      {mark(palette.waiting, "last turn ended", "tick")}
      {mark(palette.gone, "exited", "dot")}
      {mark(theme.colors.accent, "event", "dot")}
    </View>
  );
}

export function TimeSlider({ theme, viewportW, contentW, scrollX, onScrollTo }: { theme: PluginTheme; viewportW: number; contentW: number; scrollX: Animated.Value; onScrollTo: (x: number) => void }) {
  const [barW, setBarW] = useState(0);
  const ratio = contentW > 0 ? viewportW / contentW : 1;
  const thumbW = Math.max(24, barW * ratio);
  const travel = Math.max(0, barW - thumbW);
  const maxScroll = Math.max(1, contentW - viewportW);
  const left = scrollX.interpolate({ inputRange: [0, maxScroll], outputRange: [0, travel], extrapolate: "clamp" });
  const startX = useRef(0);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        startX.current = event.nativeEvent.locationX;
        onScrollTo(((event.nativeEvent.locationX - thumbW / 2) / Math.max(1, travel)) * maxScroll);
      },
      onPanResponderMove: (_event, gesture) => {
        onScrollTo(((startX.current + gesture.dx - thumbW / 2) / Math.max(1, travel)) * maxScroll);
      },
    }),
  ).current;
  return (
    <View style={{ paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], borderTopWidth: 1, borderTopColor: theme.colors.border }}>
      <View {...pan.panHandlers} onLayout={(e) => setBarW(e.nativeEvent.layout.width)} style={{ height: SLIDER_H, borderRadius: SLIDER_H / 2, backgroundColor: theme.colors.surface2, justifyContent: "center" }} accessibilityRole="adjustable" accessibilityLabel="Scroll the timeline">
        <Animated.View style={{ position: "absolute", left, width: thumbW, height: SLIDER_H, borderRadius: SLIDER_H / 2, backgroundColor: theme.colors.accent, opacity: 0.85 }} />
      </View>
    </View>
  );
}
