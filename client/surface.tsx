import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings, useWorkspace, type PluginSurfaceProps, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, Pressable, ScrollView as NativeScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { basenameOf, countStatuses, countsText, sentenceOf } from "../shared/events.ts";
import { foldsOf, goneOpen as goneIsOpen, isHidden, NO_FOLDS, prune, setGone, setHidden, setTab, setTeam, showAll, teamOpen, type Folds } from "../shared/folds.ts";
import { snapshot, tail, viewSettings } from "../shared/rpc.ts";
import { keptAxisSteps } from "../shared/axis.ts";
import { agoText, clockText, readView, related, type Block, type Column, type Detail, type Dir, type EventRow, type Head, type Row, type Status, type TailKind, type Tone, type View as PigView } from "../shared/view.ts";
import { DetailDialog, type Index } from "./dialog.tsx";
import { Header } from "./header.tsx";
import { conversationsOf, HiddenProjects, SessionsPane } from "./sessions.tsx";
import type { Navigation } from "./native.tsx";
import { AvatarStack, Legend, paint, Pill, RoleAvatar, RolePill, StatusPill, tint } from "./kit/chat.tsx";
import { Chip, statusColour } from "./kit/badge.tsx";
import { Disclosure } from "./kit/disclosure.tsx";
import { PressRow } from "./kit/press.tsx";
import { Notice } from "./kit/notice.tsx";
import { AgentCard, AgentRow, columnsFor, Tail, type Columns } from "./kit/row.tsx";
import { Rows } from "./kit/rows.tsx";
import { MultiSelect, Select } from "./kit/select.tsx";
import { TabBar } from "./kit/tab-bar.tsx";
import { ASIDE, BAR, CARD_RADIUS, CHAT_SPLIT_MIN, DOT, CHEVRON_SLOT, ICON_SIZE, ORG_CARD, INDENT, RADIUS, ROW_MIN, ROW_ONE, SPACING, text } from "./kit/theme.ts";
import { BUSY_MS, QUIET_MS, pollEvery, useNow, usePoll } from "./poll.ts";

/** ps --view, and with `dir` that directory as piggery writes paths (resolved on the daemon side). */
function useView(dir: string | undefined) {
  const call = useRpc(snapshot);
  return usePoll(
    async () => {
      const r = await call({ dir });
      if (!r.ok) return r;
      const v = readView(r.view);
      return v.ok ? { ok: true as const, value: { view: v.view, dir: r.dir ?? dir } } : v;
    },
    `view:${dir ?? ""}`,
    (v) => pollEvery((v?.view.summary.working ?? 0) + (v?.view.summary.waiting ?? 0) > 0),
  );
}

/** Every participant row of the snapshot (the All and the Closed lists), by id. */
function indexOf(view: PigView): Index {
  const out: Index = new Map();
  for (const list of [view.all, view.closed]) for (const d of list.dirs) for (const b of d.blocks) for (const r of b.rows) out.set(r.id, r);
  return out;
}

/** The directories of a workspace: the ones at, inside or around it, its own first. */
function dirsOf(view: PigView, dir: string | undefined): Dir[] {
  if (dir === undefined) return view.all.dirs;
  const mine = view.all.dirs.filter((d) => related(d.path, dir));
  const own = (d: Dir) => d.path.replace(/\/+$/, "") === dir.replace(/\/+$/, "");
  return [...mine.filter(own), ...mine.filter((d) => !own(d))];
}

const STATUS_ORDER: Record<string, number> = { working: 0, waiting: 1, idle: 2, gone: 3 };

/** A small button that opens a line's Overview, beside the line's own fold. */
function InfoButton({ theme, label, onPress }: { theme: PluginTheme; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={SPACING[2]}>
      <Icon name="Info" size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}

/** A live team's line: chevron, name, what is wrong with it (amber), and, folded, its counts. */
function TeamHead({ theme, head, rows, open, onToggle, onInfo, narrow }: { theme: PluginTheme; head: Head; rows: Row[]; open: boolean; onToggle: () => void; onInfo: () => void; narrow: boolean }) {
  const members = rows.filter((r) => r.kind === "member");
  const live = members.filter((m) => m.status !== "gone");
  const summary = countsText(countStatuses(rows)) || head.counts?.join(" · ") || "";
  return (
    <Disclosure theme={theme} open={open} onToggle={onToggle} onBody={narrow ? onInfo : undefined} label={head.name} left={0} aside={narrow ? undefined : <InfoButton theme={theme} label={`About ${head.name}`} onPress={onInfo} />}>
      <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: tint(theme.colors.accent, "1f"), alignItems: "center", justifyContent: "center" }}>
        <Icon name="Users" size={ICON_SIZE.sm} color={theme.colors.accent} />
      </View>
      <Text style={[text(theme, "rowTitle"), { fontWeight: "600", flexShrink: 1 }]} numberOfLines={1}>
        {head.name}
      </Text>
      {head.template ? <Pill theme={theme} label={head.template} /> : null}
      {!open && members.length > 0 ? <AvatarStack theme={theme} people={(live.length > 0 ? live : members).map((m) => ({ id: m.id, name: m.name, role: m.role, dim: m.dim }))} /> : null}
      {head.flags?.length ? (
        <Text style={[text(theme, "meta", "statusWarning"), { flexShrink: 1 }]} numberOfLines={1}>
          {head.flags.join(" · ")}
        </Text>
      ) : null}
      {!open && summary ? (
        <Text style={[text(theme, "label"), { flexShrink: 1 }]} numberOfLines={1}>
          {summary}
        </Text>
      ) : null}
    </Disclosure>
  );
}

/** A team listed as one line (closed, or open with every member gone), and a live team's gone members as one line: dim, with its state and when, in the participants' columns. */
function QuietLine({ theme, row, icon, open, onToggle, onInfo, left, columns }: { theme: PluginTheme; row: Row; icon?: string; open: boolean; onToggle: () => void; onInfo: () => void; left: number; columns: Columns }) {
  const narrow = columns === "none";
  return (
    <Disclosure theme={theme} open={open} onToggle={onToggle} onBody={narrow ? onInfo : undefined} label={row.name} left={left} tail={<Tail theme={theme} row={row} columns={columns} dim />} aside={narrow ? undefined : <InfoButton theme={theme} label={`About ${row.name}`} onPress={onInfo} />}>
      {icon ? <Icon name={icon} size={ICON_SIZE.md} color={theme.colors.foregroundMuted} /> : null}
      <Text style={[text(theme, "rowTitle", "foregroundMuted"), { flexShrink: 1, minWidth: 0 }]} numberOfLines={1}>
        {row.name}
      </Text>
      {row.closed ? <Text style={[text(theme, "label"), { flexShrink: 0 }]}>{row.closed}</Text> : null}
    </Disclosure>
  );
}

/** A participant's indent: under its team's chevron, and one level more for a member below the gate. */
const indentOf = (row: Row) => CHEVRON_SLOT + row.depth * INDENT;

interface Handlers {
  folds: Folds;
  change: (next: Folds) => void;
  open: (id: string) => void;
  columns: Columns;
}

/** One unit of a directory, folded as ps --view says (head.open, row.open, row.folded) unless the user chose. */
function renderBlock(theme: PluginTheme, block: Block, key: string, h: Handlers) {
  const { folds, change, open } = h;
  // The width where a participant's line gives its info slot back: every kind of line then does the same.
  const narrow = h.columns === "none";
  const agent = (row: Row) => <AgentRow key={row.id} theme={theme} row={row} left={indentOf(row)} slot={narrow ? 0 : ASIDE} columns={h.columns} onPress={() => open(row.id)} />;
  const member = agent;
  const gone = (row: Row, teamId: string) => {
    const isOpen = goneIsOpen(folds, teamId);
    return <QuietLine key={row.id} theme={theme} row={row} open={isOpen} left={CHEVRON_SLOT} onToggle={() => change(setGone(folds, teamId, !isOpen))} onInfo={() => open(row.id)} columns={h.columns} />;
  };
  const head = block.head;
  if (head) {
    const isOpen = teamOpen(folds, head.id, head.open);
    const goneOpen = goneIsOpen(folds, head.id);
    return [
      <TeamHead key={`${key}-head`} theme={theme} head={head} rows={block.rows} open={isOpen} onToggle={() => change(setTeam(folds, head.id, !isOpen, head.open))} onInfo={() => open(head.detail)} narrow={narrow} />,
      ...(isOpen ? block.rows.filter((r) => !r.folded || goneOpen).map((r) => (r.kind === "gone" ? gone(r, head.id) : member(r))) : []),
      isOpen && block.no_members ? (
        <View key={`${key}-none`} style={{ minHeight: ROW_MIN, justifyContent: "center", paddingLeft: CHEVRON_SLOT }}>
          <Text style={text(theme, "meta")}>No members yet. Open an agent session in its directory and ask the gate to admit it.</Text>
        </View>
      ) : null,
    ];
  }
  const [first, ...rest] = block.rows;
  if (first?.kind === "team") {
    const teamId = first.team ?? first.id;
    const isOpen = teamOpen(folds, teamId, first.open === true);
    return [
      <QuietLine key={first.id} theme={theme} row={first} icon={first.closed ? "Archive" : "Users"} open={isOpen} left={0} onToggle={() => change(setTeam(folds, teamId, !isOpen, first.open === true))} onInfo={() => open(first.id)} columns={h.columns} />,
      ...(isOpen ? rest.map(member) : []),
    ];
  }
  return block.rows.map(agent);
}

interface Member {
  row: Row;
  detail?: Detail;
}

interface Group {
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

function parseClock(time: string, now: number): number | undefined {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!m) return undefined;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), Number(m[3] ?? 0), 0);
  let t = d.getTime();
  if (t > now + 60_000) t -= 86_400_000;
  return t;
}

function groupsOfView(view: PigView, dirs: Dir[], start: number): { groups: Group[]; sleepers: Sleeper[] } {
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

const WINDOWS: { label: string; ms: number; tick: number }[] = [
  { label: "30m", ms: 30 * 60_000, tick: 5 * 60_000 },
  { label: "2h", ms: 2 * 3_600_000, tick: 15 * 60_000 },
  { label: "6h", ms: 6 * 3_600_000, tick: 60 * 60_000 },
  { label: "24h", ms: 24 * 3_600_000, tick: 4 * 3_600_000 },
];

const LABEL_W = 280;
const LABEL_W_NARROW = 132;
const TREE_STEP = 18;
const TEAM_PALETTE = ["#fbbf24", "#fb923c", "#f87171", "#a3e635", "#e879f9", "#818cf8", "#22d3ee", "#facc15"];

function teamColour(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TEAM_PALETTE[h % TEAM_PALETTE.length];
}
const TREE_INK = "77";
const TRACK_H = 52;
const BAR_H = 26;
const LIFE_H = 3;
const NOW_PAD = 20;
const MIN_TICK_PX = 64;
const SLIDER_H = 10;
const AXIS_H = 36;
const WORD_MIN = 88;
const DOING_MIN = 260;

interface Scale {
  start: number;
  now: number;
  width: number;
}

const xOf = (s: Scale, t: number) => Math.max(0, Math.min(s.width, ((t - s.start) / (s.now - s.start)) * s.width));

function ticksOf(scale: Scale, tick: number, margin: number): number[] {
  const out: number[] = [];
  for (let t = Math.ceil(scale.start / tick) * tick; t < scale.now - tick * margin; t += tick) out.push(t);
  return out;
}

const LABEL_GAP = SPACING[2];
const LABEL_BOX_W = 160;
const NOW_PILL_HALF = 20;

function Axis({ theme, scale, tick }: { theme: PluginTheme; scale: Scale; tick: number }) {
  const [labelWidths, setLabelWidths] = useState<Record<string, number>>({});
  const ticks = ticksOf(scale, tick, 0).map((t) => ({ t, step: Math.round(t / tick), x: xOf(scale, t), label: clockText(t, scale.now) }));
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

function Grid({ theme, scale, tick }: { theme: PluginTheme; scale: Scale; tick: number }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>
      {ticksOf(scale, tick, 0).map((t) => (
        <View key={t} style={{ position: "absolute", left: xOf(scale, t), top: 0, bottom: 0, width: 1, backgroundColor: theme.colors.border, opacity: 0.7 }} />
      ))}
      <View style={{ position: "absolute", left: scale.width - 1, top: 0, bottom: 0, width: 2, backgroundColor: theme.colors.accent, opacity: 0.8 }} />
    </View>
  );
}

function barColours(theme: PluginTheme, status: Status, own: string): { fill: string; ink: string; border: string } {
  const c = statusColour(theme, status);
  if (status === "idle") return { fill: tint(own, "2a"), ink: theme.colors.foreground, border: tint(own, "88") };
  return { fill: c, ink: theme.colors.surface0, border: c };
}

function stateWords(row: Row): { word: string; since: string } {
  return { word: row.state_text.replace(/^[^\p{L}]+/u, ""), since: row.since ?? "" };
}

function Track({ theme, member, scale, events, onPress }: { theme: PluginTheme; member: Member; scale: Scale; events: { t: number; tone: Tone; type: string }[]; onPress: () => void }) {
  const { row } = member;
  const born = row.created_at ?? scale.start;
  const since = row.state_since ?? born;
  const gone = row.status === "gone";
  const end = gone ? since : scale.now;
  const lifeX = xOf(scale, Math.max(born, scale.start));
  const lifeW = Math.max(2, xOf(scale, end) - lifeX);
  const stateX = xOf(scale, Math.max(since, scale.start));
  const stateW = Math.max(6, xOf(scale, scale.now) - stateX);
  const { word, since: sinceText } = stateWords(row);
  const doing = member.detail?.task ? member.detail.task.title.replace(/^#\d+\s*/, "").trim() : "";
  const own = paint(theme, row.role, row.id);
  const colours = barColours(theme, row.status, own);
  const status = statusColour(theme, row.status);
  const top = TRACK_H / 2 - BAR_H / 2;
  const inside = stateW >= WORD_MIN;
  const outsideRoom = stateX - SPACING[2];
  return (
    <PressRow theme={theme} onPress={onPress} label={`${row.name}, ${row.state_text}`} style={{ height: TRACK_H, justifyContent: "center" }}>
      <View style={{ position: "absolute", left: lifeX, width: lifeW, top: TRACK_H / 2 - LIFE_H / 2, height: LIFE_H, borderRadius: LIFE_H / 2, backgroundColor: own, opacity: gone ? 0.25 : 0.55 }} />
      {born >= scale.start && !gone ? <View style={{ position: "absolute", left: lifeX - 1, top: TRACK_H / 2 - 7, width: 3, height: 14, borderRadius: 1.5, backgroundColor: own }} /> : null}
      {!gone ? (
        <>
          <View style={{ position: "absolute", left: stateX, width: stateW, top, height: BAR_H, borderRadius: 6, backgroundColor: colours.fill, borderWidth: 1, borderColor: colours.border, overflow: "hidden", justifyContent: "center", paddingHorizontal: SPACING[2] }}>
            {inside ? (
              <Text style={[text(theme, "label"), { color: colours.ink, fontWeight: "700", lineHeight: 16 }]} numberOfLines={1}>
                {word}
                {sinceText ? <Text style={{ fontWeight: "500", opacity: 0.9 }}>{`  ${sinceText}`}</Text> : null}
                {doing && stateW >= DOING_MIN ? <Text style={{ fontWeight: "400", opacity: 0.85 }}>{`   ${doing}`}</Text> : null}
              </Text>
            ) : null}
          </View>
          {!inside && outsideRoom > WORD_MIN ? (
            <View style={{ position: "absolute", right: scale.width - stateX + SPACING[2], top, height: BAR_H, justifyContent: "center", maxWidth: outsideRoom }}>
              <Text style={[text(theme, "label"), { color: status, fontWeight: "700", lineHeight: 16 }]} numberOfLines={1}>
                {word}
                {sinceText ? <Text style={{ fontWeight: "500", color: theme.colors.foregroundMuted }}>{`  ${sinceText}`}</Text> : null}
              </Text>
            </View>
          ) : null}
        </>
      ) : (
        <View style={{ position: "absolute", left: Math.min(xOf(scale, since), scale.width - 120), top, height: BAR_H, flexDirection: "row", alignItems: "center", gap: SPACING[1.5], paddingHorizontal: SPACING[2], borderRadius: 6, backgroundColor: tint(theme.colors.statusDanger, "1f"), borderWidth: 1, borderColor: tint(theme.colors.statusDanger, "88") }}>
          <View style={{ width: DOT, height: DOT, borderRadius: DOT, backgroundColor: theme.colors.statusDanger }} />
          <Text style={[text(theme, "label", "statusDanger"), { fontWeight: "600", lineHeight: 16, fontVariant: ["tabular-nums"] }]} numberOfLines={1}>{`exited ${clockText(since, scale.now)}`}</Text>
        </View>
      )}
      {row.last_turn_end && row.last_turn_end >= scale.start && !gone && row.status === "idle" ? <View style={{ position: "absolute", left: xOf(scale, row.last_turn_end) - 1, top: top - 3, width: 2, height: BAR_H + 6, borderRadius: 1, backgroundColor: theme.colors.statusWarning, opacity: 0.9 }} /> : null}
      {events.map((e, i) => (
        <View key={i} style={{ position: "absolute", left: xOf(scale, e.t) - 5, top: top - 6, width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: theme.colors.surface0, backgroundColor: e.tone === "danger" ? theme.colors.statusDanger : e.tone === "warning" ? theme.colors.statusWarning : theme.colors.accent }} />
      ))}
    </PressRow>
  );
}

function lastSibling(members: Member[], i: number): boolean {
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

function TrackLabel({ theme, member, narrow, last, onPress }: { theme: PluginTheme; member: Member; narrow: boolean; last: boolean; onPress: () => void }) {
  const { row } = member;
  const colour = paint(theme, row.role, row.id);
  const dim = row.status === "gone";
  const status = statusColour(theme, row.status);
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
        {narrow ? null : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5] }}>
            <RolePill theme={theme} role={row.role} id={row.id} />
            {row.ctx ? <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"] }]} numberOfLines={1}>{row.ctx}</Text> : null}
          </View>
        )}
      </View>
      {row.unacked > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: SPACING[1.5], height: 20, borderRadius: 10, backgroundColor: tint(theme.colors.statusWarning, "1f") }}>
          <Icon name="Mail" size={11} color={theme.colors.statusWarning} />
          <Text style={[text(theme, "label", "statusWarning"), { fontVariant: ["tabular-nums"], fontWeight: "600" }]}>{row.unacked}</Text>
        </View>
      ) : null}
    </PressRow>
  );
}

function CountDots({ theme, rows }: { theme: PluginTheme; rows: Row[] }) {
  const c = countStatuses(rows);
  const parts = (["working", "waiting", "idle", "gone"] as const).filter((s) => c[s] > 0);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[3] }}>
      {parts.map((s) => (
        <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1] }}>
          <View style={{ width: DOT, height: DOT, borderRadius: DOT, backgroundColor: statusColour(theme, s) }} />
          <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"] }]}>
            <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{c[s]}</Text>
            {` ${s}`}
          </Text>
        </View>
      ))}
    </View>
  );
}

function LaneHead({ theme, group, open, onToggle, onInfo }: { theme: PluginTheme; group: Group; open: boolean; onToggle: () => void; onInfo: (id: string) => void }) {
  const faces = group.members.filter((m) => m.row.status !== "gone");
  const accent = group.solo ? theme.colors.foregroundMuted : teamColour(group.key);
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

function ChartLegend({ theme }: { theme: PluginTheme }) {
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
      {bar(theme.colors.statusSuccess, "working")}
      {bar(theme.colors.statusWarning, "waiting")}
      {bar(tint(theme.colors.accent, "2a"), "idle, in the agent's colour", tint(theme.colors.accent, "88"))}
      {mark(tint(theme.colors.accent, "99"), "alive", "line")}
      {mark(theme.colors.statusWarning, "last turn ended", "tick")}
      {mark(theme.colors.statusDanger, "exited", "dot")}
      {mark(theme.colors.accent, "event", "dot")}
    </View>
  );
}

function TimeSlider({ theme, viewportW, contentW, scrollX, onScrollTo }: { theme: PluginTheme; viewportW: number; contentW: number; scrollX: Animated.Value; onScrollTo: (x: number) => void }) {
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

function Overview({ theme, view, dirs, h, index, whole, width, now, empty }: { theme: PluginTheme; view: PigView; dirs: Dir[]; h: Handlers; index: Index; whole: boolean; width: number; now: number; empty: string }) {
  const [pick, setPick] = useState(1);
  const win = WINDOWS[pick];
  const narrow = width < 640;
  const labelW = narrow ? LABEL_W_NARROW : LABEL_W;
  const [cardW, setCardW] = useState(0);
  const trackFit = Math.max(0, cardW - labelW);
  const trackW = Math.max(trackFit, (win.ms / win.tick) * MIN_TICK_PX + NOW_PAD);
  const scrollable = trackW > trackFit;
  const scale: Scale = { start: now - win.ms, now, width: Math.max(0, trackW - NOW_PAD) };
  const contentW = labelW + trackW;
  const scrollX = useRef(new Animated.Value(0)).current;
  const sticky = { transform: [{ translateX: scrollX }], zIndex: 2, backgroundColor: theme.colors.surface0 };
  const scroller = useRef<NativeScrollView>(null);
  const { groups, sleepers } = groupsOfView(view, dirs, scale.start);
  const stamped = view.events.map((e) => ({ ...e, t: parseClock(e.time, now) })).filter((e): e is EventRow & { t: number } => e.t !== undefined && e.t >= scale.start);
  const eventsOf = (name: string) => stamped.filter((e) => e.who === name || e.target === name).map((e) => ({ t: e.t, tone: e.tone, type: e.type }));
  const sleeping = sleepers.reduce((n, s) => n + s.agents, 0);
  const laneOpen = (g: Group) => teamOpen(h.folds, g.key, true);
  const openCount = groups.filter(laneOpen).length;
  const setAll = (open: boolean) => h.change(groups.reduce((f, g) => setTeam(f, g.key, open, true), h.folds));
  const total = groups.reduce((n, g) => n + g.members.length, 0);
  const divider = tint(theme.colors.border, "99");
  return (
    <View style={{ gap: SPACING[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: SPACING[2], rowGap: SPACING[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1] }}>
          <Text style={[text(theme, "label"), { marginRight: SPACING[1] }]}>Last</Text>
          {WINDOWS.map((w, i) => (
            <Chip key={w.label} theme={theme} label={w.label} on={i === pick} onPress={() => setPick(i)} />
          ))}
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1] }}>
          <Chip theme={theme} label="Expand all" on={false} onPress={() => setAll(true)} />
          <Chip theme={theme} label="Collapse all" on={false} onPress={() => setAll(false)} />
        </View>
      </View>
      {groups.length === 0 ? (
        <View style={{ alignItems: "center", gap: SPACING[2], paddingVertical: SPACING[8] }}>
          <Icon name="Moon" size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />
          <Text style={text(theme, "section")}>No one is awake</Text>
          <Text style={[text(theme, "meta"), { textAlign: "center", maxWidth: 360 }]}>{empty}</Text>
        </View>
      ) : (
        <View style={{ borderRadius: CARD_RADIUS, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden", backgroundColor: theme.colors.surface0 }} onLayout={(e) => setCardW(Math.max(0, e.nativeEvent.layout.width - 2))}>
          <NativeScrollView
            ref={scroller}
            horizontal
            scrollEnabled={scrollable}
            bounces={false}
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: false })}
            onContentSizeChange={() => scrollable && scroller.current?.scrollToEnd({ animated: false })}
          >
          <View style={{ width: cardW > 0 ? contentW : undefined, overflow: "hidden" }}>
          <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: tint(theme.colors.accent, "55"), backgroundColor: tint(theme.colors.accent, "0d") }}>
            <Animated.View style={[{ width: labelW, justifyContent: "flex-end", paddingLeft: SPACING[3], paddingBottom: SPACING[2], borderRightWidth: 1, borderRightColor: divider }, sticky, { backgroundColor: theme.colors.surface0 }]}>
              <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: tint(theme.colors.accent, "0d") }} />
              <Text style={text(theme, "label")}>
                <Text style={{ color: theme.colors.accent, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{total}</Text>
                {` ${total === 1 ? "agent" : "agents"} · ${openCount}/${groups.length} lanes open`}
              </Text>
            </Animated.View>
            <View style={{ width: trackW, paddingRight: NOW_PAD }}>
              {scale.width > 0 ? <Axis theme={theme} scale={scale} tick={win.tick} /> : null}
            </View>
          </View>
          {groups.map((g) => {
            const lane = g.solo ? theme.colors.foregroundMuted : teamColour(g.key);
            return (
            <View key={g.key} style={{ borderTopWidth: 1, borderTopColor: theme.colors.border }}>
              <Animated.View style={[{ width: cardW }, sticky]}>
                <LaneHead theme={theme} group={g} open={laneOpen(g)} onToggle={() => h.change(setTeam(h.folds, g.key, !laneOpen(g), true))} onInfo={h.open} />
              </Animated.View>
              {laneOpen(g)
                ? g.members.map((m, i) => (
                    <View key={m.row.id} style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: divider, borderLeftWidth: 3, borderLeftColor: tint(lane, "77"), backgroundColor: tint(lane, i % 2 === 1 ? "0e" : "06") }}>
                      <Animated.View style={[{ width: labelW, marginLeft: -3, paddingLeft: 3, borderRightWidth: 1, borderRightColor: divider }, sticky]}>
                        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: tint(lane, i % 2 === 1 ? "0e" : "06") }} />
                        <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: tint(lane, "77") }} />
                        <TrackLabel theme={theme} member={m} narrow={narrow} last={lastSibling(g.members, i)} onPress={() => h.open(m.row.id)} />
                      </Animated.View>
                      <View style={{ width: trackW, paddingRight: NOW_PAD, position: "relative" }}>
                        {scale.width > 0 ? (
                          <>
                            <Grid theme={theme} scale={scale} tick={win.tick} />
                            <Track theme={theme} member={m} scale={scale} events={eventsOf(m.row.name)} onPress={() => h.open(m.row.id)} />
                          </>
                        ) : null}
                      </View>
                    </View>
                  ))
                : null}
            </View>
            );
          })}
          </View>
          </NativeScrollView>
          {scrollable ? <TimeSlider theme={theme} viewportW={cardW} contentW={contentW} scrollX={scrollX} onScrollTo={(x) => scroller.current?.scrollTo({ x, animated: false })} /> : null}
          {sleepers.length > 0 ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: 36, paddingHorizontal: SPACING[3], borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
              <Icon name="Archive" size={12} color={theme.colors.foregroundMuted} />
              <Text style={[text(theme, "label"), { flexShrink: 1 }]} numberOfLines={1}>{`${sleepers.length} finished ${sleepers.length === 1 ? "team" : "teams"} · ${sleeping} agents, off the chart`}</Text>
              <View style={{ flex: 1 }} />
              <View style={{ flexDirection: "row", gap: SPACING[1] }}>
                {sleepers.slice(0, 4).map((s) => (
                  <Pill key={s.key} theme={theme} label={s.name} colour={teamColour(s.key)} filled onPress={() => h.open(s.info)} />
                ))}
                {sleepers.length > 4 ? <Text style={text(theme, "label")}>{`+${sleepers.length - 4}`}</Text> : null}
              </View>
            </View>
          ) : null}
          <View style={{ paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], borderTopWidth: 1, borderTopColor: theme.colors.border }}>
            <ChartLegend theme={theme} />
          </View>
        </View>
      )}
      {whole ? <Activity theme={theme} events={view.events} index={index} /> : null}
    </View>
  );
}

const ACTIVITY_SHOWN = 5;

function ActivityLine({ theme, event, index }: { theme: PluginTheme; event: EventRow; index: Index }) {
  const s = sentenceOf(event);
  const rows = [...index.values()];
  const byName = (name: string | undefined) => (name ? rows.find((r) => r.name === name && r.kind !== "team" && r.kind !== "gone") : undefined);
  const actorRow = byName(s.actor);
  const objectRow = byName(s.object);
  const tone = event.tone === "danger" ? theme.colors.statusDanger : event.tone === "warning" ? theme.colors.statusWarning : undefined;
  const ink = (r: Row | undefined) => ({ color: tone ?? (r ? paint(theme, r.role, r.id) : theme.colors.foreground), fontWeight: "600" as const });
  const strong = ink(actorRow);
  const strongObject = ink(objectRow);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: ROW_ONE, paddingHorizontal: SPACING[3], paddingVertical: SPACING[1] }}>
      {actorRow && !tone ? (
        <RoleAvatar theme={theme} name={actorRow.name} role={actorRow.role} id={actorRow.id} size={24} dim={actorRow.dim} />
      ) : (
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: tint(tone ?? theme.colors.accent, "1f"), alignItems: "center", justifyContent: "center" }}>
          <Icon name={s.icon} size={12} color={tone ?? theme.colors.accent} />
        </View>
      )}
      <Text style={[text(theme, "meta"), { flex: 1, minWidth: 0 }]} numberOfLines={1}>
        {s.actor ? <Text style={strong}>{s.actor}</Text> : null}
        {s.actor ? " " : ""}
        <Text style={tone ? { color: tone } : undefined}>{s.verb}</Text>
        {s.object ? " " : ""}
        {s.object ? <Text style={strongObject}>{s.object}</Text> : null}
      </Text>
      <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"], flexShrink: 0 }]}>{event.time}</Text>
    </View>
  );
}

function Activity({ theme, events, index }: { theme: PluginTheme; events: EventRow[]; index: Index }) {
  const [all, setAll] = useState(false);
  if (events.length === 0) return null;
  const shown = all ? events : events.slice(0, ACTIVITY_SHOWN);
  const hidden = events.length - shown.length;
  return (
    <View style={{ gap: SPACING[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingHorizontal: SPACING[1] }}>
        <Icon name="History" size={ICON_SIZE.sm} color={theme.colors.accent} />
        <Text accessibilityRole="header" style={text(theme, "section")}>
          Recent activity
        </Text>
        <View style={{ paddingHorizontal: SPACING[1.5], height: 18, borderRadius: 9, backgroundColor: tint(theme.colors.accent, "22"), justifyContent: "center" }}>
          <Text style={[text(theme, "label"), { color: theme.colors.accent, fontWeight: "600", fontVariant: ["tabular-nums"], lineHeight: 14 }]}>{events.length}</Text>
        </View>
        <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.border }} />
      </View>
      <View style={{ borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1, overflow: "hidden" }}>
      <View>
        <Rows theme={theme} bare>
          {shown.map((e, i) => (
            <ActivityLine key={`${e.time}:${i}`} theme={theme} event={e} index={index} />
          ))}
        </Rows>
      </View>
      {events.length > ACTIVITY_SHOWN ? (
        <PressRow theme={theme} onPress={() => setAll(!all)} expanded={all} label={all ? "Show fewer events" : `Show ${hidden} more events`} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING[1.5], minHeight: ROW_ONE, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          <Icon name={all ? "ChevronUp" : "ChevronDown"} size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />
          <Text style={text(theme, "label")}>{all ? "Show fewer" : `Show ${hidden} more`}</Text>
        </PressRow>
      ) : null}
      </View>
    </View>
  );
}

/** Every participant of the snapshot with the directory it is listed under; closed teams' only when their tab is chosen. */
interface Item {
  row: Row;
  dir: string;
}

function itemsOf(view: PigView): Item[] {
  const out: Item[] = [];
  for (const d of view.board.dirs) {
    for (const b of d.blocks) {
      for (const row of b.rows) {
        if (row.kind === "member" || row.kind === "solo") out.push({ row, dir: d.path });
      }
    }
  }
  return out;
}

function itemsIn(view: PigView, dirs: Dir[] | undefined): Item[] {
  if (!dirs) return itemsOf(view);
  const paths = new Set(dirs.map((d) => d.path));
  return itemsOf(view).filter((i) => paths.has(i.dir));
}

/** Who a participant reports to and who reports to it, read off the tree ps --view lists (a row's parent is the nearest row above it one level up, in its block), and each team's template. */
interface Tree {
  parents: Map<string, Row>;
  reports: Map<string, Row[]>;
  templates: Map<string, string>;
}

function treeOf(view: PigView): Tree {
  const parents = new Map<string, Row>();
  const reports = new Map<string, Row[]>();
  const templates = new Map<string, string>();
  for (const list of [view.all, view.closed]) {
    for (const d of list.dirs) {
      for (const b of d.blocks) {
        if (b.head?.template) templates.set(b.head.id, b.head.template);
        const stack: Row[] = [];
        for (const r of b.rows) {
          if (r.kind !== "member") continue;
          stack.length = r.depth;
          const parent = stack[r.depth - 1];
          if (parent) {
            parents.set(r.id, parent);
            reports.set(parent.id, [...(reports.get(parent.id) ?? []), r]);
          }
          stack[r.depth] = r;
        }
      }
    }
  }
  return { parents, reports, templates };
}


/** A team's filter is chips up to this many (All included); more teams than that are a select. */
const TEAM_CHIPS_MAX = 5;

/** Items in groups by `key`, in the order the keys first appear. */
function groupsOf<T>(items: T[], key: (item: T) => string): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return [...out];
}

/** A column's word as a heading: "● working" reads "Working"; the dot beside it is the colour. */
function columnWord(c: Column): string {
  const plain = c.word.replace(/^[^A-Za-z]+/, "");
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

/** A directory's label split for a heading: its last segment, bold, and the path before it, muted. */
function dirWords(label: string): { name: string; path: string } {
  const trimmed = label.replace(/^…\//, "").replace(/\/+$/, "");
  const at = trimmed.lastIndexOf("/");
  return at < 0 ? { name: trimmed, path: "" } : { name: trimmed.slice(at + 1), path: trimmed.slice(0, at + 1) };
}

/** "3 working · 2 idle": how many of `items` are in each of `columns`, the empty ones left out. */
function countWords(items: Item[], columns: Column[]): string {
  return columns
    .map((c) => ({ n: items.filter((i) => i.row.status === c.status).length, word: columnWord(c).toLowerCase() }))
    .filter((c) => c.n > 0)
    .map((c) => `${c.n} ${c.word}`)
    .join(" · ");
}

/** "1 supervisor · 1 lead · 5 peers": how many of each role, in the order the roles first appear (the tree's order: top first). */
function roleWords(rows: Row[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const role = r.role ?? "solo";
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return [...counts].map(([role, n]) => `${n} ${n === 1 ? role : role.endsWith("s") ? role : `${role}s`}`).join(" · ");
}

/** A graph's edges: their thickness, the drop from a node to the rail its children hang from, the elbow's curve, and the gap between sibling subtrees. */
const EDGE = 1;
const DROP = 28;
const ELBOW = 10;
const PORT = 6;
const SIBLING_GAP = SPACING[4];
const GRID = 24;

/** One node of a team's graph: a participant, or the team itself at the top. */
interface Node {
  row?: Row;
  kids: Node[];
}

/**
 * The visible rows of a team as a tree: a row hangs from the nearest visible row above it in ps
 * --view's tree, or from the team itself when none of them is shown (gone and hidden), so no card
 * is lost when its lead is.
 */
function graphOf(rows: Row[], tree: Tree): Node[] {
  const shown = new Map(rows.map((r) => [r.id, { row: r, kids: [] as Node[] }]));
  const roots: Node[] = [];
  for (const r of rows) {
    let p = tree.parents.get(r.id);
    while (p && !shown.has(p.id)) p = tree.parents.get(p.id);
    const node = shown.get(r.id)!;
    if (p) shown.get(p.id)!.kids.push(node);
    else roots.push(node);
  }
  return roots;
}

function railColour(theme: PluginTheme): string {
  return tint(theme.colors.foregroundMuted, "88");
}

function Port({ theme }: { theme: PluginTheme }) {
  return <View style={{ width: PORT, height: PORT, borderRadius: PORT / 2, backgroundColor: theme.colors.surface1, borderWidth: EDGE, borderColor: railColour(theme), marginTop: -PORT / 2 }} />;
}

function Stem({ theme }: { theme: PluginTheme }) {
  return (
    <View style={{ alignItems: "center" }}>
      <Port theme={theme} />
      <View style={{ width: EDGE, height: DROP - PORT / 2, backgroundColor: railColour(theme) }} />
    </View>
  );
}

const RAIL_INSET = SPACING[6];
const RAIL_REACH = SPACING[6];
const STACK_GAP = SPACING[4];
const TICK_Y = STACK_GAP + 24;

function depthOf(node: Node): number {
  return node.kids.length === 0 ? 0 : 1 + Math.max(...node.kids.map(depthOf));
}

function columnWidth(node: Node): number {
  return ORG_CARD + (RAIL_INSET + RAIL_REACH) * depthOf(node);
}

function Elbow({ theme, first, last, stemAt }: { theme: PluginTheme; first: boolean; last: boolean; stemAt: number }) {
  const rail = railColour(theme);
  const only = first && last;
  const middle = !first && !last;
  return (
    <View style={{ flexDirection: "row", alignSelf: "stretch", height: DROP }}>
      <View style={{ width: stemAt, borderColor: rail, borderTopWidth: first ? 0 : EDGE, borderRightWidth: last && !first ? EDGE : 0, borderTopRightRadius: last && !first ? ELBOW : 0 }} />
      <View style={{ flex: 1, borderColor: rail, borderTopWidth: last ? 0 : EDGE, borderLeftWidth: first && !last ? EDGE : 0, borderTopLeftRadius: first && !last ? ELBOW : 0 }} />
      {only || middle ? <View style={{ position: "absolute", left: stemAt, top: 0, bottom: 0, width: EDGE, backgroundColor: rail }} /> : null}
    </View>
  );
}

/**
 * The levels under a card, as a work breakdown structure lists them: each child on its own line
 * below, indented, hung from one rail down the left with a tick into each card; its own children
 * the same under it, one indent deeper.
 */
function Stack({ theme, kids, task, open }: { theme: PluginTheme; kids: Node[]; task: (id: string) => string | undefined; open: (id: string) => void }) {
  const rail = railColour(theme);
  return (
    <View style={{ marginLeft: RAIL_INSET }}>
      <View style={{ position: "absolute", left: -PORT / 2 + EDGE / 2, top: 0, zIndex: 1 }}>
        <Port theme={theme} />
      </View>
      {kids.map((kid, i) => {
        const last = i === kids.length - 1;
        return (
          <View key={kid.row?.id ?? i} style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <View style={{ width: RAIL_REACH, alignSelf: "stretch" }}>
              {last ? (
                <View style={{ position: "absolute", left: 0, top: 0, width: RAIL_REACH, height: TICK_Y + EDGE, borderColor: rail, borderLeftWidth: EDGE, borderBottomWidth: EDGE, borderBottomLeftRadius: ELBOW }} />
              ) : (
                <>
                  <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: EDGE, backgroundColor: rail }} />
                  <View style={{ position: "absolute", left: 0, top: TICK_Y, width: RAIL_REACH, height: EDGE, backgroundColor: rail }} />
                </>
              )}
            </View>
            <View style={{ paddingTop: STACK_GAP }}>
              {kid.row ? (
                <View style={{ width: ORG_CARD }}>
                  <AgentCard theme={theme} row={kid.row} task={task(kid.row.id)} onPress={() => open(kid.row!.id)} />
                </View>
              ) : null}
              {kid.kids.length > 0 ? <Stack theme={theme} kids={kid.kids} task={task} open={open} /> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * A team's tree as a work breakdown structure: the first level in a row under the team node, each
 * hung from a rail by a rounded elbow into its card's centre; every level below that stacked down
 * under its card (see Stack), so a deep chain reads top to bottom and siblings left to right.
 */
function Subtree({ theme, node, task, open }: { theme: PluginTheme; node: Node; task: (id: string) => string | undefined; open: (id: string) => void }) {
  const n = node.kids.length;
  if (n === 0) return null;
  const lean = columnWidth(node.kids[n - 1]) - ORG_CARD;
  return (
    <View style={{ alignItems: "center" }}>
      <Stem theme={theme} />
      <View style={{ flexDirection: "row", alignItems: "flex-start", paddingLeft: lean }}>
        {node.kids.map((kid, i) => (
          <View key={kid.row?.id ?? i} style={{ alignItems: "flex-start" }}>
            <Elbow theme={theme} first={i === 0} last={i === n - 1} stemAt={SIBLING_GAP / 2 + ORG_CARD / 2} />
            <View style={{ paddingHorizontal: SIBLING_GAP / 2, width: columnWidth(kid) + SIBLING_GAP }}>
              {kid.row ? (
                <View style={{ width: ORG_CARD }}>
                  <AgentCard theme={theme} row={kid.row} task={task(kid.row.id)} onPress={() => open(kid.row!.id)} />
                </View>
              ) : null}
              {kid.kids.length > 0 ? <Stack theme={theme} kids={kid.kids} task={task} open={open} /> : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
/** The node at the top of a team's graph: the team, its template, and what was spawned by role. Pressing it opens the team's detail. */
function TeamNode({ theme, name, template, rows, icon, onPress }: { theme: PluginTheme; name: string; template?: string; rows: Row[]; icon: string; onPress?: () => void }) {
  const accent = theme.colors.accent;
  return (
    <PressRow theme={theme} onPress={onPress} label={`About ${name}`} style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingVertical: SPACING[1.5], paddingLeft: SPACING[1.5], paddingRight: SPACING[3], borderRadius: 999, borderWidth: 1, borderColor: tint(accent, "55"), backgroundColor: tint(accent, "14"), maxWidth: "100%" }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: tint(accent, "2a"), alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={ICON_SIZE.sm} color={accent} />
      </View>
      <Text style={[text(theme, "section"), { flexShrink: 1 }]} numberOfLines={1}>
        {name}
      </Text>
      {template ? (
        <Text style={[text(theme, "label"), { flexShrink: 1 }]} numberOfLines={1}>
          {template}
        </Text>
      ) : null}
      <View style={{ width: 1, height: 14, backgroundColor: tint(accent, "55") }} />
      <Text style={[text(theme, "label"), { flexShrink: 1 }]} numberOfLines={1}>
        {roleWords(rows)}
      </Text>
    </PressRow>
  );
}

function Canvas({ theme, children, fill }: { theme: PluginTheme; children: ReactNode; fill?: boolean }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const line = tint(theme.colors.foregroundMuted, "12");
  const columns = Math.ceil(size.width / GRID);
  const lines = Math.ceil(size.height / GRID);
  return (
    <View onLayout={(e) => setSize(e.nativeEvent.layout)} style={{ flex: fill ? 1 : undefined, borderRadius: CARD_RADIUS, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1, overflow: "hidden" }}>
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
        {Array.from({ length: columns }, (_, i) => (
          <View key={`c${i}`} style={{ position: "absolute", top: 0, bottom: 0, left: (i + 1) * GRID, width: 1, backgroundColor: line }} />
        ))}
        {Array.from({ length: lines }, (_, i) => (
          <View key={`r${i}`} style={{ position: "absolute", left: 0, right: 0, top: (i + 1) * GRID, height: 1, backgroundColor: line }} />
        ))}
      </View>
      {children}
    </View>
  );
}

/** A team of a directory's graph: its name, template and members, and what pressing its node opens. */
interface TeamSpec {
  id: string;
  name: string;
  template?: string;
  rows: Row[];
  onHead?: () => void;
}

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.2, 1.5, 2];

function zoomStep(scale: number, by: 1 | -1): number {
  const candidates = by > 0 ? ZOOM_STEPS.filter((z) => z > scale + 0.01) : ZOOM_STEPS.filter((z) => z < scale - 0.01);
  if (candidates.length === 0) return scale;
  return by > 0 ? candidates[0] : candidates[candidates.length - 1];
}

interface Size {
  width: number;
  height: number;
}

function Zoomed({ scale, onSize, children }: { scale: number; onSize: (s: Size) => void; children: ReactNode }) {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const measured = size.width > 0 && size.height > 0;
  const box = measured ? { width: size.width * scale, height: size.height * scale } : {};
  const shift = measured ? { position: "absolute" as const, left: (size.width * scale - size.width) / 2, top: (size.height * scale - size.height) / 2 } : {};
  return (
    <View style={box}>
      <View
        onLayout={(e) => {
          const next = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
          if (next.width !== size.width || next.height !== size.height) {
            setSize(next);
            onSize(next);
          }
        }}
        style={[shift, { alignSelf: "flex-start", transform: [{ scale }] }]}
      >
        {children}
      </View>
    </View>
  );
}

function ToolButton({ theme, icon, label, onPress, disabled }: { theme: PluginTheme; icon: string; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={(state) => {
        const hovered = (state as typeof state & { hovered?: boolean }).hovered === true;
        return { width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.md, backgroundColor: state.pressed ? theme.colors.surface2 : hovered ? theme.colors.surface1 : "transparent", opacity: disabled ? 0.4 : 1 };
      }}
    >
      <Icon name={icon} size={ICON_SIZE.sm} color={theme.colors.foreground} />
    </Pressable>
  );
}

function ZoomBar({ theme, scale, onScale, onFit, onExpand }: { theme: PluginTheme; scale: number; onScale: (s: number) => void; onFit: () => void; onExpand?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[0.5], padding: SPACING[0.5], borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface2 }}>
      <ToolButton theme={theme} icon="Minus" label="Zoom out" onPress={() => onScale(zoomStep(scale, -1))} disabled={scale <= ZOOM_STEPS[0]} />
      <Pressable onPress={() => onScale(1)} accessibilityRole="button" accessibilityLabel="Reset zoom" style={{ minWidth: 44, alignItems: "center" }}>
        <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"] }]}>{`${Math.round(scale * 100)}%`}</Text>
      </Pressable>
      <ToolButton theme={theme} icon="Plus" label="Zoom in" onPress={() => onScale(zoomStep(scale, 1))} disabled={scale >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} />
      <View style={{ width: 1, height: 16, backgroundColor: theme.colors.border, marginHorizontal: SPACING[0.5] }} />
      <ToolButton theme={theme} icon="Scan" label="Fit the graph to the width" onPress={onFit} />
      {onExpand ? <ToolButton theme={theme} icon="Maximize2" label="Open the graph in a window" onPress={onExpand} /> : null}
    </View>
  );
}

/**
 * A directory as one graph: every team's tree side by side under its team node, then, when it has
 * any, its solos as a row of cards that wraps.
 */
function GraphBody({ theme, teams, solos, tree, task, open }: { theme: PluginTheme; teams: TeamSpec[]; solos: Row[]; tree: Tree; task: (id: string) => string | undefined; open: (id: string) => void }) {
  return (
    <View style={{ gap: SPACING[6], alignItems: "center" }}>
      {teams.length > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACING[8] }}>
          {teams.map((t) => (
            <View key={t.id} style={{ alignItems: "center" }}>
              <TeamNode theme={theme} name={t.name} template={t.template} rows={t.rows} icon="Users" onPress={t.onHead} />
              <Subtree theme={theme} node={{ kids: graphOf(t.rows, tree) }} task={task} open={open} />
            </View>
          ))}
        </View>
      ) : null}
      {solos.length > 0 ? (
        <View style={{ gap: SPACING[2], alignSelf: "stretch" }}>
          {teams.length > 0 ? <View style={{ height: 1, backgroundColor: theme.colors.border }} /> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingTop: teams.length > 0 ? SPACING[2] : 0 }}>
            <Icon name="User" size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />
            <Text style={text(theme, "section")}>Solo sessions</Text>
            <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"] }]}>{solos.length}</Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACING[3], maxWidth: ORG_CARD * 4 + SPACING[3] * 3 }}>
            {solos.map((row) => (
              <View key={row.id} style={{ width: ORG_CARD }}>
                <AgentCard theme={theme} row={row} task={task(row.id)} onPress={() => open(row.id)} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const CANVAS_PAD = SPACING[4];
const ZOOM_BAR_ROOM = SPACING[8] + SPACING[4];

/**
 * A graph on its canvas with a zoom bar at its corner. The scale is the user's, or, until they pick
 * one (and again on Fit), the one that fits the whole graph in the view, never above 1 in the band;
 * `tall` fills the window it is opened in and fits on open.
 */
function GraphCanvas({ theme, onExpand, tall, children }: { theme: PluginTheme; onExpand?: () => void; tall?: boolean; children: ReactNode }) {
  const [picked, setPicked] = useState<number | null>(tall ? null : 1);
  const [natural, setNatural] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<Size>({ width: 0, height: 0 });
  const fit = () => {
    if (natural.width === 0 || natural.height === 0 || view.width === 0) return 1;
    const byWidth = (view.width - CANVAS_PAD * 2) / natural.width;
    const byHeight = tall && view.height > 0 ? (view.height - CANVAS_PAD * 2 - ZOOM_BAR_ROOM) / natural.height : Infinity;
    return Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], byWidth, byHeight));
  };
  const scale = picked ?? fit();
  const locked = !tall && natural.height > 0 ? { height: natural.height + CANVAS_PAD + ZOOM_BAR_ROOM } : undefined;
  return (
    <View style={{ flex: tall ? 1 : undefined }}>
      <Canvas theme={theme} fill={tall}>
        <View onLayout={(e) => setView({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })} style={tall ? { flex: 1 } : locked}>
          <ScrollView style={tall || locked ? { flex: 1 } : undefined} contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}>
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexGrow: 1, flexDirection: "row", justifyContent: "center", paddingVertical: CANVAS_PAD, paddingHorizontal: CANVAS_PAD, paddingBottom: ZOOM_BAR_ROOM }}>
              <Zoomed scale={scale} onSize={setNatural}>
                {children}
              </Zoomed>
            </ScrollView>
          </ScrollView>
        </View>
        <View style={{ position: "absolute", right: SPACING[3], bottom: SPACING[3] }}>
          <ZoomBar theme={theme} scale={scale} onScale={setPicked} onFit={() => setPicked(null)} onExpand={onExpand} />
        </View>
      </Canvas>
    </View>
  );
}

/** A directory's graph in the band, and the same graph in a window when its expand button is pressed. */
function DirGraph({ theme, label, teams, solos, tree, task, open }: { theme: PluginTheme; label: string; teams: TeamSpec[]; solos: Row[]; tree: Tree; task: (id: string) => string | undefined; open: (id: string) => void }) {
  const [big, setBig] = useState(false);
  const body = <GraphBody theme={theme} teams={teams} solos={solos} tree={tree} task={task} open={open} />;
  return (
    <>
      <GraphCanvas theme={theme} onExpand={() => setBig(true)}>
        {body}
      </GraphCanvas>
      <Modal title={`Graph · ${dirWords(label).name}`} icon={<Icon name="Network" size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />} open={big} onOpenChange={(next) => !next && setBig(false)}>
        <Modal.Content scrollable={false} contentContainerStyle={{ flex: 1, padding: SPACING[3] }}>
          <GraphCanvas theme={theme} tall>
            {body}
          </GraphCanvas>
        </Modal.Content>
      </Modal>
    </>
  );
}
/**
 * What names a Graph band: a folder, the directory's last segment bold and its path muted, then, at
 * the right, who is in it and how many are in each state. A band ps --view folds (gone and closed
 * directories) is this line alone until pressed; its chevron says so.
 */
function BandHead({ theme, label, items, columns, fold }: { theme: PluginTheme; label: string; items: Item[]; columns: Column[]; fold?: { open: boolean; onToggle: () => void } }) {
  const { name, path } = dirWords(label);
  const counts = countWords(items, columns);
  return (
    <PressRow theme={theme} onPress={fold?.onToggle} expanded={fold?.open} label={fold ? `${fold.open ? "Fold" : "Unfold"} ${name}` : name} style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: ROW_MIN - SPACING[2], marginTop: SPACING[4], paddingHorizontal: SPACING[2], borderRadius: RADIUS.md }}>
      {fold ? <Icon name={fold.open ? "ChevronDown" : "ChevronRight"} size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} /> : <Icon name="Folder" size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />}
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: SPACING[1.5], flexShrink: 1, minWidth: 0 }}>
        <Text style={[text(theme, "section"), { flexShrink: 1, minWidth: 0 }]} numberOfLines={1}>
          {name}
        </Text>
        {path ? (
          <Text style={[text(theme, "label"), { flexShrink: 10, minWidth: 0 }]} numberOfLines={1} ellipsizeMode="head">
            {path}
          </Text>
        ) : null}
      </View>
      <View style={{ flex: 1 }} />
      {fold && !fold.open ? <AvatarStack theme={theme} people={items.map((i) => ({ id: i.row.id, name: i.row.name, role: i.row.role, dim: i.row.dim }))} /> : null}
      {counts ? (
        <Text style={[text(theme, "label"), { flexShrink: 0 }]} numberOfLines={1}>
          {counts}
        </Text>
      ) : null}
    </PressRow>
  );
}

/** What the Graph says when the filter leaves nothing to draw. */
function GraphEmpty({ theme, team, goneCount, onShowGone }: { theme: PluginTheme; team: string; goneCount: number; onShowGone: () => void }) {
  return (
    <View style={{ alignItems: "center", gap: SPACING[2], paddingVertical: SPACING[8], paddingHorizontal: SPACING[4] }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border }}>
        <Icon name="Network" size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />
      </View>
      <Text style={text(theme, "section")}>{goneCount > 0 ? "Everyone here is gone" : "No one is here"}</Text>
      <Text style={[text(theme, "meta"), { textAlign: "center", maxWidth: 360 }]}>{goneCount > 0 ? `${goneCount} ${goneCount === 1 ? "session" : "sessions"} ended${team ? " in this team" : ""}. Show them to see what they did.` : "When an agent works in a team or on its own, its card shows up here."}</Text>
      {goneCount > 0 ? <Chip theme={theme} label="Show gone" count={goneCount} on={false} onPress={onShowGone} /> : null}
    </View>
  );
}

/**
 * The Graph: every team as a small org chart on its own canvas, small teams side by side, so what
 * was spawned, under whom, and in what state reads at one glance; solos of a directory as a grid of
 * cards after its teams. One band per directory ps --view lists, under its own heading; a band ps
 * --view folds (gone and closed directories) is one heading until pressed. Filtered by team (the
 * tabs ps --view lists); gone cards only when asked for. A legend over the bands says what the
 * state colours mean.
 */
function Graph({ theme, view, dirs, open }: { theme: PluginTheme; view: PigView; dirs?: Dir[]; open: (id: string) => void }) {
  const [team, setTeam] = useState("");
  const [gone, setGone] = useState(false);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [hiddenDirs, setHiddenDirs] = useState<string[]>([]);
  const all = itemsIn(view, dirs);
  const boardDirs = dirs ? dirs.flatMap((d) => view.board.dirs.filter((b) => b.path === d.path)) : view.board.dirs;
  const teamTabs = dirs ? view.tabs.map((t) => ({ ...t, count: all.filter((i) => (i.row.tabs ?? []).includes(t.key)).length })).filter((t) => t.key === "" || t.count > 0) : view.tabs;
  const teamName = (id: string | undefined) => view.tabs.find((t) => t.key === id)?.label ?? "";
  const taskOf = (id: string) => view.details[id]?.task?.title;
  const tree = treeOf(view);
  const inTeam = all.filter((i) => (i.row.tabs ?? []).includes(team));
  const goneCount = inTeam.filter((i) => i.row.status === "gone").length;
  const unfolded = (d: Dir) => opened[d.path] ?? !d.folded;
  const goneShown = gone || boardDirs.some((d) => d.folded && unfolded(d) && inTeam.some((i) => i.dir === d.path));
  const visible = (items: Item[]) => items.filter((i) => goneShown || i.row.status !== "gone");
  const shown = visible(inTeam);
  const allBands = boardDirs.map((d) => ({ dir: d, items: inTeam.filter((i) => i.dir === d.path) })).filter((b) => b.items.length > 0 && (b.dir.folded || visible(b.items).length > 0));
  const hidden = new Set(hiddenDirs);
  const bands = allBands.filter((b) => !hidden.has(b.dir.path));
  const graphOptions = allBands.map((b) => ({ value: b.dir.path, label: dirWords(b.dir.label).name, count: b.items.length }));
  const columns = view.board.columns.filter((c) => c.status !== "gone" || goneShown);
  const legend = columns.filter((c) => shown.some((i) => i.row.status === c.status)).map((c) => ({ label: columnWord(c), colour: statusColour(theme, c.status) }));
  return (
    <View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACING[2], paddingHorizontal: SPACING[4], paddingTop: SPACING[3] }}>
        {teamTabs.length <= TEAM_CHIPS_MAX ? (
          <>
            <Text style={text(theme, "label")}>Team</Text>
            {teamTabs.map((t) => (
              <Chip key={t.key} theme={theme} label={t.label} count={t.count} on={team === t.key} onPress={() => setTeam(t.key)} />
            ))}
          </>
        ) : (
          <Select theme={theme} label="Team" value={team} options={teamTabs.map((t) => ({ value: t.key, label: t.label, count: t.count }))} onPick={setTeam} />
        )}
        {allBands.length > 1 ? <MultiSelect theme={theme} label="Graphs" values={allBands.filter((b) => !hidden.has(b.dir.path)).map((b) => b.dir.path)} options={graphOptions} onChange={(shown) => setHiddenDirs(allBands.map((b) => b.dir.path).filter((p) => !shown.includes(p)))} /> : null}
        <View style={{ flex: 1 }} />
        <Legend theme={theme} entries={legend} />
        <Chip theme={theme} label={gone ? "Hide gone" : "Show gone"} count={goneCount} on={gone} onPress={() => setGone(!gone)} />
      </View>
      {allBands.length === 0 ? <GraphEmpty theme={theme} team={team} goneCount={goneCount} onShowGone={() => setGone(true)} /> : null}
      {allBands.length > 0 && bands.length === 0 ? (
        <View style={{ alignItems: "center", gap: SPACING[2], paddingVertical: SPACING[8] }}>
          <Text style={text(theme, "meta")}>Every graph is hidden.</Text>
          <Chip theme={theme} label="Show all" count={allBands.length} on={false} onPress={() => setHiddenDirs([])} />
        </View>
      ) : null}
      <View style={{ paddingHorizontal: SPACING[4] }}>
        {bands.map(({ dir, items: whole }) => {
          const isOpen = unfolded(dir);
          const items = dir.folded ? whole : visible(whole);
          const teams = groupsOf(items.filter((i) => i.row.team), (i) => i.row.team ?? "");
          const solos = items.filter((i) => !i.row.team).map((i) => i.row);
          return (
            <View key={dir.path}>
              <BandHead theme={theme} label={dir.label} items={items} columns={view.board.columns} fold={{ open: isOpen, onToggle: () => setOpened({ ...opened, [dir.path]: !isOpen }) }} />
              {isOpen ? (
                <View style={{ paddingTop: SPACING[2] }}>
                  <DirGraph theme={theme} label={dir.label} teams={teams.map(([teamId, group]) => ({ id: teamId, name: teamName(teamId), template: tree.templates.get(teamId), rows: group.map((i) => i.row), onHead: view.details[`\u0000team:${teamId}`] ? () => open(`\u0000team:${teamId}`) : undefined }))} solos={solos} tree={tree} task={taskOf} open={open} />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
/**
 * What the user chose is kept in the host's "pigmonitor-view" setting: read once when it arrives, saved a
 * moment after the last change (a burst of clicks is one save), only teams piggery still lists.
 * `change` shows a new state at once and saves it.
 */
function useFolds(set: (f: Folds) => void, view: PigView | null) {
  const stored = useSettings(viewSettings);
  const latest = useRef({ stored, view });
  latest.current = { stored, view };
  const restored = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (stored.status === "ready" && !restored.current) {
      restored.current = true;
      set(foldsOf(stored.values));
    }
  }, [stored.status]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (next: Folds) => {
    set(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const { stored: s, view: v } = latest.current;
      if (s.status !== "ready") return;
      if (!(await s.save({ ...s.values, ...prune(next, (v?.tabs ?? []).map((t) => t.key)) }, s.revision))) await s.reload();
    }, 300);
  };
  return { change };
}

/**
 * The PigMonitor surface: piggery top's rows in Paseo's finish. With a `dir` it is one workspace's: one
 * column, that directory first, and the Graph draws only its directories. Otherwise the whole machine.
 * Tabs: Overview (the directories and their teams, then the latest events), Graph (the teams as org
 * charts) and Sessions.
 */
function Shell({ theme, compact, dir, empty, navigation, serverId }: { theme: PluginTheme; compact: boolean; dir?: string; empty: string; navigation?: Navigation; serverId?: string }) {
  const { value: snap, error, at } = useView(dir);
  const view = snap?.view ?? null;
  const now = useNow(1000);
  const [width, setWidth] = useState(0);
  const [folds, setFolds] = useState<Folds>(NO_FOLDS);
  const { change } = useFolds(setFolds, view);
  const [opened, setOpened] = useState<string | null>(null);
  const index = view ? indexOf(view) : new Map<string, Row>();
  const allDirs = view ? dirsOf(view, dir === undefined ? undefined : snap?.dir) : [];
  const dirs = allDirs.filter((d) => !isHidden(folds, d.path));
  const hidden = allDirs.length - dirs.length;
  const hide = (path: string) => change(setHidden(folds, path, true));
  const unhide = () => change(showAll(folds));
  const h: Handlers = { folds, change, open: setOpened, columns: columnsFor(width) };
  const whole = dir === undefined;
  const graph = folds.tab === "graph";
  const sessionsTab = folds.tab === "sessions";
  const [session, setSession] = useState("");
  const sessions = view ? conversationsOf(view, dirs) : [];
  const sessionId = sessions.some((c) => c.row.id === session) ? session : "";
  const [chatOpened, setChatOpened] = useState(false);
  const chatFillsPane = sessionsTab && chatOpened && sessionId !== "" && width < CHAT_SPLIT_MIN;
  const graphCount = whole ? view?.tabs.find((t) => t.key === "")?.count : view ? itemsIn(view, dirs).length : undefined;
  const tabs = [{ id: "overview" as const, label: "Overview" }, { id: "graph" as const, label: "Graph", count: graphCount }, { id: "sessions" as const, label: "Sessions", count: sessions.length }];
  const tabBar = view ? <TabBar theme={theme} tabs={tabs} active={sessionsTab ? "sessions" : graph ? "graph" : "overview"} onPick={(t) => change(setTab(folds, t))} /> : null;
  const topBar = view && !(chatFillsPane && !error) ? (
    <View style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <View style={{ gap: SPACING[2], paddingHorizontal: SPACING[4], paddingTop: SPACING[4], paddingBottom: SPACING[2] }}>
        {error ? <Text style={text(theme, "label", "statusWarning")}>{`Showing the last read: ${error.message}`}</Text> : null}
        {chatFillsPane ? null : tabBar}
      </View>
    </View>
  ) : null;
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {topBar}
      {view && sessionsTab ? (
        <SessionsPane theme={theme} view={view} dirs={dirs} width={width} selected={sessionId} opened={chatOpened} now={now} navigation={navigation} serverId={serverId} hidden={hidden} onSelect={setSession} onOpened={setChatOpened} onInfo={setOpened} onHide={hide} onShowHidden={unhide} />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: SPACING[6] }}>
          <View>
            {view ? (
              <View style={{ paddingHorizontal: SPACING[4], paddingTop: SPACING[4] }}>
                <Header theme={theme} summary={view.summary} daemon={view.daemon} at={at} now={now} />
              </View>
            ) : null}
            {error && !view ? <Notice theme={theme} kind={error.code} detail={error.message} /> : null}
            {!view && !error ? <Notice theme={theme} kind="loading" /> : null}
            {view && dirs.length === 0 ? <Notice theme={theme} kind="empty" detail={empty} /> : null}
            {view && !graph ? (
              <View style={{ paddingHorizontal: SPACING[4], paddingTop: SPACING[4] }}>
                <Overview theme={theme} view={view} dirs={dirs} h={h} index={index} whole={whole} width={width} now={now} empty={empty} />
              </View>
            ) : null}
            {view && hidden > 0 ? (
              <View style={{ paddingHorizontal: SPACING[4] }}>
                <HiddenProjects theme={theme} count={hidden} onShow={unhide} />
              </View>
            ) : null}
            {view && graph ? <Graph theme={theme} view={view} dirs={whole ? undefined : dirs} open={setOpened} /> : null}
          </View>
        </ScrollView>
      )}
      {view ? <DetailDialog theme={theme} view={view} index={index} root={opened} onClose={() => setOpened(null)} /> : null}
    </View>
  );
}

/** Sidebar surface: every directory, like piggery top. */
export function PigMonitorSurface({ theme, layout, navigation, host }: PluginSurfaceProps) {
  return <Shell theme={theme} compact={layout.compact} navigation={navigation} serverId={host.id} empty="Open an agent session, or ask one to make a team." />;
}

/** Workspace panel: the teams and sessions of this workspace's directory. */
export function FarmPanel({ theme, layout, workspaceId, navigation, host }: PluginWorkspacePanelProps) {
  const dir = useWorkspace(workspaceId, (w) => w.directory);
  if (!dir) return <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }} />;
  return <Shell theme={theme} compact={layout.compact} dir={dir} navigation={navigation} serverId={host.id} empty="No team works here yet. Ask your agent: “make a supervisor-executor team for …”" />;
}
