import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dimensions, Keyboard, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, useWindowDimensions, View, type PressableStateCallbackType } from "react-native";
import { basenameOf } from "../shared/events.ts";
import type { MailMessage } from "../shared/mail.ts";
import { mail, person, sendMail, type AttachmentData, type ImageData } from "../shared/rpc.ts";
import { itemsOfThread, latestFrom, type Me } from "../shared/thread.ts";
import { briefAgo, type Dir, type Row, type Status, type View as PigView } from "../shared/view.ts";
import { Chip, statusColour } from "./kit/badge.tsx";
import { AVATAR, AvatarStack, Pill, RoleAvatar, STATUS_WORD, StatusDot, StatusPill, StatusWord, paint, tint } from "./kit/chat.tsx";
import { AnchoredMenu, type MenuItem } from "./kit/menu.tsx";
import { Notice } from "./kit/notice.tsx";
import { PressRow } from "./kit/press.tsx";
import { taskWords } from "./kit/row.tsx";
import { TreeGuides, treeIndent, treeSpotsOf, type TreeSpot } from "./kit/tree.tsx";
import { AVATAR_LG, ICON_SIZE, LIST_MIN_WIDTH, LIST_WIDTH, RADIUS, ROW_CHAT, SPACING, CHAT_SPLIT_MIN, text, ROW_MIN } from "./kit/theme.ts";
import { BUSY_MS, QUIET_MS, usePoll } from "./poll.ts";
import { Composer, canAttach } from "./composer.tsx";
import { FileDropZone } from "./attachments-drop.tsx";
import { AgentContextMeter, AgentControls } from "./controls.tsx";
import { NativeLink, useNative, useStop, type Navigation, type NativeChat, type Stop } from "./native.tsx";
import { MailStream } from "./transcript.tsx";
import { StreamView, type ViewportHandle } from "./stream.tsx";
import { useAgentTimeline, type AgentTimeline } from "./timeline.ts";
import { RewindMenu } from "./rewind.tsx";
import { useHasComposerTracks } from "./tracks.tsx";
import { createUserMessage, generateMessageId } from "../shared/stream.ts";
import { ResizeHandle, clampWidth, useSavedListWidth } from "./resize.tsx";
import { abortable, type Native } from "../shared/native.ts";
import { useProjectActions, type ProjectActions } from "./project.tsx";
import { NotifyHint } from "./notify.tsx";

export interface Conversation {
  row: Row;
  teamKey: string;
  teamName: string | undefined;
  template: string | undefined;
  /** The project directory piggery lists it under: its path and its label as piggery prints it. */
  dir: { path: string; label: string };
  preview: string;
  at: number | undefined;
}

/** A team, or the solos, within one project. */
export interface Group {
  key: string;
  label: string;
  icon: string;
  items: Conversation[];
}

/** One project directory and the groups in it. */
export interface Project {
  path: string;
  name: string;
  label: string;
  groups: Group[];
}

export type Filter = "all" | "live" | "waiting" | "gone";

const STATUS_ORDER: Record<Status, number> = { waiting: 0, working: 1, idle: 2, gone: 3 };
const SOLO_KEY = "";
const BAR = 3;
const RING_GAP = 3;
const PARENT_REACH = (ROW_CHAT - AVATAR_LG) / 2 + 3;
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "waiting", label: "Needs you" },
  { id: "gone", label: "Ended" },
];

function previewOf(view: PigView, row: Row): string {
  const task = view.details[row.id]?.task?.title;
  if (task) return taskWords(task);
  return `${row.harness ?? "agent"} session`;
}

export function conversationsOf(view: PigView, dirs: Dir[]): Conversation[] {
  const teamName = (id: string | undefined) => view.tabs.find((t) => t.key === id)?.label;
  const out: Conversation[] = [];
  for (const d of dirs) {
    for (const b of d.blocks) {
      for (const r of b.rows) {
        if (r.kind !== "member" && r.kind !== "solo") continue;
        out.push({ row: r, teamKey: r.team ?? SOLO_KEY, teamName: teamName(r.team), template: b.head?.template, dir: { path: d.path, label: d.label }, preview: previewOf(view, r), at: r.last_turn_end ?? r.state_since ?? r.created_at });
      }
    }
  }
  return out;
}

const byUrgency = (a: Conversation, b: Conversation) => STATUS_ORDER[a.row.status] - STATUS_ORDER[b.row.status] || (b.at ?? 0) - (a.at ?? 0);

function mostPressing(items: Conversation[]): Conversation | undefined {
  return [...items].sort(byUrgency)[0];
}

export function matches(c: Conversation, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [c.row.name, c.row.role, c.teamName, c.preview, c.row.harness].some((s) => s?.toLowerCase().includes(q));
}

export function passes(c: Conversation, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "live":
      return c.row.status !== "gone";
    case "waiting":
      return c.row.status === "waiting";
    case "gone":
      return c.row.status === "gone";
  }
}

const weightOf = (items: Conversation[]) => Math.min(...items.map((c) => STATUS_ORDER[c.row.status]));
const latestOf = (items: Conversation[]) => Math.max(...items.map((c) => c.at ?? 0));

export function groupsOf(items: Conversation[]): Group[] {
  const byKey = new Map<string, Group>();
  for (const c of items) {
    const existing = byKey.get(c.teamKey);
    if (existing) existing.items.push(c);
    else byKey.set(c.teamKey, { key: c.teamKey, label: c.teamKey === SOLO_KEY ? "Solo sessions" : (c.teamName ?? "Team"), icon: c.teamKey === SOLO_KEY ? "User" : "Users", items: [c] });
  }
  const solos = byKey.get(SOLO_KEY);
  if (solos) solos.items.sort(byUrgency);
  return [...byKey.values()].sort((a, b) => weightOf(a.items) - weightOf(b.items) || latestOf(b.items) - latestOf(a.items));
}

/** The conversations by project directory, the most pressing project first, each with its teams and solos. */
export function projectsOf(items: Conversation[]): Project[] {
  const byPath = new Map<string, Conversation[]>();
  for (const c of items) {
    const list = byPath.get(c.dir.path);
    if (list) list.push(c);
    else byPath.set(c.dir.path, [c]);
  }
  return [...byPath.entries()]
    .sort(([, a], [, b]) => weightOf(a) - weightOf(b) || latestOf(b) - latestOf(a))
    .map(([path, list]) => ({ path, name: basenameOf(path), label: list[0].dir.label, groups: groupsOf(list) }));
}

function hoveredOf(state: PressableStateCallbackType): boolean {
  return (state as PressableStateCallbackType & { hovered?: boolean }).hovered === true;
}

function SearchBox({ theme, value, onChange }: { theme: PluginTheme; value: string; onChange: (value: string) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingHorizontal: 10, height: 34, borderRadius: 17, backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border }}>
      <Icon name="Search" size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Search sessions"
        placeholderTextColor={theme.colors.foregroundMuted}
        accessibilityLabel="Search sessions"
        autoCapitalize="none"
        autoCorrect={false}
        style={[text(theme, "rowTitle"), { flex: 1, minWidth: 0, paddingVertical: 0 }]}
      />
      {value ? (
        <Pressable onPress={() => onChange("")} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={SPACING[2]}>
          <Icon name="X" size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

function StatusRing({ theme, status }: { theme: PluginTheme; status: Status }) {
  const size = AVATAR_LG + RING_GAP * 2;
  return <View style={{ position: "absolute", left: -RING_GAP, top: -RING_GAP, width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: tint(statusColour(theme, status), "99") }} />;
}

function UnreadBadge({ theme, count }: { theme: PluginTheme; count: number }) {
  return (
    <View style={{ minWidth: 20, height: 20, paddingHorizontal: SPACING[1.5], borderRadius: 10, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center" }} accessibilityLabel={`${count} unread`}>
      <Text style={{ fontSize: 11, lineHeight: 13, fontWeight: "600", color: theme.colors.surface0, fontVariant: ["tabular-nums"] }}>{count > 99 ? "99+" : String(count)}</Text>
    </View>
  );
}

function ConversationRow({ theme, item, spot, selected, now, onPress }: { theme: PluginTheme; item: Conversation; spot: TreeSpot; selected: boolean; now: number; onPress: () => void }) {
  const { row } = item;
  const dim = row.dim === true || row.status === "gone";
  const busy = !dim && (row.status === "working" || row.status === "waiting");
  const colour = dim ? theme.colors.foregroundMuted : paint(theme, row.role, row.id);
  const style = (state: PressableStateCallbackType) => ({
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: SPACING[3],
    minHeight: ROW_CHAT,
    paddingLeft: treeIndent(spot.depth),
    paddingRight: SPACING[3],
    paddingVertical: SPACING[2],
    borderRadius: RADIUS.lg,
    backgroundColor: selected || state.pressed ? theme.colors.surface2 : hoveredOf(state) ? theme.colors.surface1 : "transparent",
  });
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`${row.name}, ${STATUS_WORD[row.status]}${item.preview ? `, ${item.preview}` : ""}`} style={style}>
      <TreeGuides theme={theme} spot={spot} colour={colour} reach={PARENT_REACH} />
      {selected ? <View style={{ position: "absolute", left: 0, top: 10, bottom: 10, width: BAR, borderRadius: BAR / 2, backgroundColor: colour }} /> : null}
      <View style={{ width: AVATAR_LG, height: AVATAR_LG }}>
        {busy ? <StatusRing theme={theme} status={row.status} /> : null}
        <RoleAvatar theme={theme} name={row.name} role={row.role} id={row.id} size={AVATAR_LG} dim={dim} />
        <StatusDot theme={theme} status={row.status} dim={dim} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: SPACING[0.5] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5] }}>
          <Text style={[text(theme, "rowTitle", dim ? "foregroundMuted" : "foreground"), { fontWeight: "600", flexShrink: 1, minWidth: 0 }]} numberOfLines={1}>
            {row.name}
          </Text>
          <Text style={[text(theme, "label"), { color: colour, flexShrink: 0 }]} numberOfLines={1}>
            {row.role ?? "solo"}
          </Text>
          {row.gate ? <Icon name="DoorOpen" size={11} color={theme.colors.foregroundMuted} /> : null}
          <View style={{ flex: 1 }} />
          <StatusWord theme={theme} status={row.status} dim={dim} />
          {item.at !== undefined ? (
            <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"], flexShrink: 0, color: row.unacked > 0 ? theme.colors.accent : theme.colors.foregroundMuted }]}>{briefAgo(item.at, now)}</Text>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
          <Text style={[text(theme, "meta"), { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18 }]} numberOfLines={1}>
            {item.preview}
          </Text>
          {row.unacked > 0 ? <UnreadBadge theme={theme} count={row.unacked} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

function countText(items: Conversation[]): string {
  const live = items.filter((c) => c.row.status !== "gone").length;
  return live > 0 && live !== items.length ? `${live}/${items.length}` : String(items.length);
}

function HeadButton({ theme, icon, label, onPress }: { theme: PluginTheme; icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={SPACING[1]}
      style={(state) => ({ width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.md, backgroundColor: state.pressed ? theme.colors.surface2 : hoveredOf(state) ? theme.colors.surface1 : "transparent" })}
    >
      <Icon name={icon} size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}

function copyText(value: string): Promise<void> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  return clipboard ? clipboard.writeText(value) : Promise.reject(new Error("Clipboard unavailable"));
}

function ProjectMenu({ theme, project, open, collapsed, actions, onToggle, onClose }: { theme: PluginTheme; project: Project; open: boolean; collapsed: boolean; actions: ProjectActions; onToggle: () => void; onClose: () => void }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const close = () => {
    setConfirming(false);
    onClose();
  };
  const row = (icon: string, label: string, onPress: () => void, opts: { danger?: boolean; busy?: boolean; hint?: string } = {}) => (
    <PressRow theme={theme} onPress={opts.busy ? undefined : () => onPress()} label={label} style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: ROW_MIN, paddingHorizontal: SPACING[2], borderRadius: RADIUS.md, opacity: opts.busy ? 0.6 : 1 }}>
      <Icon name={opts.busy ? "Loader" : icon} size={ICON_SIZE.sm} color={opts.danger ? theme.colors.statusDanger : theme.colors.foregroundMuted} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[text(theme, "rowTitle", opts.danger ? "statusDanger" : "foreground")]} numberOfLines={1}>
          {label}
        </Text>
        {opts.hint ? <Text style={text(theme, "label")} numberOfLines={2}>{opts.hint}</Text> : null}
      </View>
    </PressRow>
  );
  const then = (work: Promise<void>) => {
    close();
    void work;
  };
  return (
    <Modal title={project.name} icon={<Icon name="Folder" size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />} open={open} onOpenChange={(next) => !next && close()}>
      <Modal.Content contentContainerStyle={{ padding: SPACING[2], gap: 0 }}>
        <View style={{ paddingHorizontal: SPACING[2], paddingVertical: SPACING[1.5], gap: SPACING[0.5] }}>
          <Text style={text(theme, "label")}>Path</Text>
          <Text style={[text(theme, "meta", "foreground"), { fontFamily: "monospace" }]} selectable>
            {project.path}
          </Text>
        </View>
        <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: SPACING[1] }} />
        {row("Plus", "New agent", () => then(actions.newAgent(project.path)), { busy: actions.busy === "agent" })}
        {row("SquareTerminal", "New terminal", () => then(actions.newTerminal(project.path)), { busy: actions.busy === "terminal" })}
        {actions.canOpen ? row("ExternalLink", "Open in Paseo", () => then(actions.openInPaseo(project.path)), { busy: actions.busy === "open" }) : null}
        <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: SPACING[1] }} />
        {row("Copy", "Copy path", () => { close(); void copyText(project.path).then(() => toast.show("Path copied"), () => toast.error("Could not copy the path")); })}
        {row(collapsed ? "ChevronDown" : "ChevronRight", collapsed ? "Expand project" : "Collapse project", () => { onToggle(); close(); })}
        <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: SPACING[1] }} />
        {confirming
          ? row("Trash2", "Confirm: remove project", () => then(actions.remove(project.path)), { danger: true, busy: actions.busy === "remove", hint: "Hides it in PigMonitor and archives its Paseo workspace. Piggery sessions keep running; Show hidden brings it back." })
          : row("Trash2", "Remove project", () => setConfirming(true), { danger: true })}
      </Modal.Content>
    </Modal>
  );
}

/** A project's heading as Paseo's workspace rows: a chevron that folds it, its name, a menu with its path; the path itself shows on hover. */
function ProjectHead({ theme, project, collapsed, actions, onToggle }: { theme: PluginTheme; project: Project; collapsed: boolean; actions: ProjectActions; onToggle: () => void }) {
  const [menu, setMenu] = useState(false);
  const items = project.groups.flatMap((g) => g.items);
  const live = items.some((c) => c.row.status !== "gone");
  return (
    <View style={{ marginTop: SPACING[3], marginBottom: SPACING[1] }}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={`${collapsed ? "Expand" : "Collapse"} ${project.name}, ${project.label}`}
        style={(state) => ({ flexDirection: "row", alignItems: "center", gap: SPACING[1.5], minHeight: 32, paddingLeft: SPACING[1.5], paddingRight: SPACING[1], borderRadius: RADIUS.md, backgroundColor: state.pressed ? theme.colors.surface2 : theme.colors.surface1 })}
      >
        {(state) => (
          <>
            <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />
            <Text accessibilityRole="header" style={[text(theme, "section"), { color: live ? theme.colors.foreground : theme.colors.foregroundMuted, flexShrink: 0 }]} numberOfLines={1}>
              {project.name}
            </Text>
            <Text style={[text(theme, "label"), { flex: 1, minWidth: 0, opacity: hoveredOf(state) ? 1 : 0 }]} numberOfLines={1} ellipsizeMode="head">
              {project.label}
            </Text>
            <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"], flexShrink: 0 }]}>{countText(items)}</Text>
            <HeadButton theme={theme} icon={actions.busy === "agent" ? "Loader" : "Plus"} label={`New agent in ${project.name}`} onPress={() => void actions.newAgent(project.path)} />
            <HeadButton theme={theme} icon={actions.busy === "terminal" ? "Loader" : "SquareTerminal"} label={`New terminal in ${project.name}`} onPress={() => void actions.newTerminal(project.path)} />
            <HeadButton theme={theme} icon="EllipsisVertical" label={`${project.name} menu`} onPress={() => setMenu(true)} />
          </>
        )}
      </Pressable>
      <ProjectMenu theme={theme} project={project} open={menu} collapsed={collapsed} actions={actions} onToggle={onToggle} onClose={() => setMenu(false)} />
    </View>
  );
}

/** A team's (or the solos') heading within a project. */
function GroupHead({ theme, group, collapsed, onToggle }: { theme: PluginTheme; group: Group; collapsed: boolean; onToggle: () => void }) {
  const template = group.items[0]?.template;
  const members = group.items.map((c) => ({ id: c.row.id, name: c.row.name, role: c.row.role, dim: c.row.dim === true || c.row.status === "gone" }));
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={`${collapsed ? "Expand" : "Collapse"} ${group.label}${template ? ` ${template}` : ""}`}
      style={(state) => ({ flexDirection: "row", alignItems: "center", gap: SPACING[1.5], paddingLeft: SPACING[3] + 22 + SPACING[2] - 12 - SPACING[1.5], paddingRight: SPACING[3], paddingTop: SPACING[2], paddingBottom: SPACING[0.5], borderRadius: RADIUS.md, backgroundColor: state.pressed ? theme.colors.surface2 : hoveredOf(state) ? theme.colors.surface1 : "transparent" })}
    >
      <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={12} color={theme.colors.foregroundMuted} />
      <Icon name={group.icon} size={11} color={theme.colors.foregroundMuted} />
      <Text style={[text(theme, "label"), { fontWeight: "600", flexShrink: 1 }]} numberOfLines={1}>
        {group.label}
      </Text>
      {template ? <Text style={text(theme, "label")} numberOfLines={1}>{template}</Text> : null}
      {collapsed ? <AvatarStack theme={theme} people={members} /> : null}
      <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"] }]}>{countText(group.items)}</Text>
    </Pressable>
  );
}

function ConversationList({ theme, items, selected, now, actions, hidden, onPick, onShowHidden }: { theme: PluginTheme; items: Conversation[]; selected: string; now: number; actions: ProjectActions; hidden: number; onPick: (id: string) => void; onShowHidden: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleProject = (path: string) => setCollapsed((c) => ({ ...c, [path]: !c[path] }));
  const [groupFolds, setGroupFolds] = useState<Record<string, boolean>>({});
  const browsing = filter === "all" && !query.trim();
  const liveGroups = new Set(items.filter((c) => c.row.status !== "gone").map((c) => `${c.dir.path}:${c.teamKey}`));
  const groupCollapsed = (key: string, group: Group) => groupFolds[key] ?? (browsing && !liveGroups.has(key) && !group.items.some((c) => c.row.id === selected));
  const count = (f: Filter) => items.filter((c) => passes(c, f)).length;
  const shown = items.filter((c) => passes(c, filter) && matches(c, query));
  const projects = projectsOf(shown);
  const filters = FILTERS.filter((f) => f.id === "all" || count(f.id) > 0);
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ gap: SPACING[2], paddingHorizontal: SPACING[3], paddingTop: SPACING[3], paddingBottom: SPACING[2] }}>
        <SearchBox theme={theme} value={query} onChange={setQuery} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: "row", gap: SPACING[1.5] }}>
          {filters.map((f) => (
            <Chip key={f.id} theme={theme} label={f.label} count={count(f.id)} on={filter === f.id} onPress={() => setFilter(f.id)} />
          ))}
        </ScrollView>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACING[1.5], paddingBottom: SPACING[6] }}>
        {filter === "waiting" ? (
          <View style={{ paddingHorizontal: SPACING[1.5], paddingBottom: SPACING[2] }}>
            <NotifyHint theme={theme} />
          </View>
        ) : null}
        {shown.length === 0 ? (
          <View style={{ padding: SPACING[4], gap: SPACING[1] }}>
            <Text style={text(theme, "rowTitle")}>No session matches</Text>
            <Text style={text(theme, "meta")}>{query ? "Try another name, role or team." : "Nothing in this filter yet."}</Text>
          </View>
        ) : (
          projects.map((p) => (
            <View key={p.path}>
              <ProjectHead theme={theme} project={p} collapsed={collapsed[p.path] === true} actions={actions} onToggle={() => toggleProject(p.path)} />
              {collapsed[p.path] === true ? null : p.groups.map((g) => {
                const spots = treeSpotsOf(g.items.map((c) => (g.key === SOLO_KEY ? 0 : c.row.depth)));
                const groupKey = `${p.path}:${g.key}`;
                const folded = groupCollapsed(groupKey, g);
                return (
                  <View key={g.key}>
                    <GroupHead theme={theme} group={g} collapsed={folded} onToggle={() => setGroupFolds((f) => ({ ...f, [groupKey]: !folded }))} />
                    {folded ? null : g.items.map((c, i) => (
                      <ConversationRow key={c.row.id} theme={theme} item={c} spot={spots[i]} selected={c.row.id === selected} now={now} onPress={() => onPick(c.row.id)} />
                    ))}
                  </View>
                );
              })}
            </View>
          ))
        )}
        {hidden > 0 ? <HiddenProjects theme={theme} count={hidden} onShow={onShowHidden} /> : null}
      </ScrollView>
    </View>
  );
}

export function HiddenProjects({ theme, count, onShow }: { theme: PluginTheme; count: number; onShow: () => void }) {
  return (
    <PressRow theme={theme} onPress={onShow} label={`Show ${count} hidden ${count === 1 ? "project" : "projects"}`} style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: ROW_MIN, marginTop: SPACING[3], paddingHorizontal: SPACING[3], borderRadius: RADIUS.md }}>
      <Icon name="EyeOff" size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />
      <Text style={[text(theme, "label"), { flex: 1, minWidth: 0 }]} numberOfLines={1}>
        {`${count} hidden ${count === 1 ? "project" : "projects"}`}
      </Text>
      <Text style={[text(theme, "label"), { color: theme.colors.accent, fontWeight: "600" }]}>Show</Text>
    </PressRow>
  );
}

const HEAD_STACK_BELOW = 560;
const COMPACT_HEAD_BELOW = 720;
const COMPACT_HEAD_HEIGHT = 44;
const COMPACT_STATUS_DOT = 10;

function SessionMenu({ theme, item, native, chat, writable, onInfo }: { theme: PluginTheme; item: Conversation; native: Native; chat: NativeChat; writable: boolean; onInfo: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const resume = async () => {
    const failed = await chat.resume(item.row.id);
    if (failed) toast.error(failed);
  };
  const muted = theme.colors.foregroundMuted;
  const items: MenuItem[] = [{ id: "details", label: "Session details", icon: <Icon name="Info" size={ICON_SIZE.md} color={muted} />, onSelect: onInfo }];
  if (native.kind === "open" && chat.canOpen) items.push({ id: "open", label: "Open in Paseo", icon: <Icon name="ExternalLink" size={ICON_SIZE.md} color={muted} />, onSelect: () => chat.open(native.agentId) });
  if (native.kind === "resume" && writable) items.push({ id: "resume", label: "Resume in Paseo", icon: <Icon name="Import" size={ICON_SIZE.md} color={muted} />, onSelect: () => void resume() });
  return (
    <AnchoredMenu theme={theme} open={open} label={`${item.row.name} menu`} items={items} onClose={() => setOpen(false)}>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Session menu" hitSlop={SPACING[2]} style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" }}>
        <Icon name="Ellipsis" size={ICON_SIZE.md} color={muted} />
      </Pressable>
    </AnchoredMenu>
  );
}

function CompactChatHead({ theme, item, native, chat, writable, onBack, onInfo }: { theme: PluginTheme; item: Conversation; native: Native; chat: NativeChat; writable: boolean; onBack?: () => void; onInfo: () => void }) {
  const { row } = item;
  const place = item.teamName ?? basenameOf(item.dir.path);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: COMPACT_HEAD_HEIGHT, paddingLeft: onBack ? SPACING[1] : SPACING[3], paddingRight: SPACING[2], borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface0 }}>
      {onBack ? (
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to sessions" hitSlop={SPACING[2]} style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" }}>
          <Icon name="ChevronLeft" size={ICON_SIZE.md} color={theme.colors.foreground} />
        </Pressable>
      ) : null}
      <View style={{ width: AVATAR, height: AVATAR }}>
        <RoleAvatar theme={theme} name={row.name} role={row.role} id={row.id} size={AVATAR} dim={row.dim} />
        <StatusDot theme={theme} status={row.status} dim={row.dim} size={COMPACT_STATUS_DOT} />
      </View>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: SPACING[1.5], overflow: "hidden" }} accessibilityLabel={`${row.name}, ${STATUS_WORD[row.status]}, in ${place}`}>
        <Text style={[text(theme, "rowTitle"), { fontWeight: "600", flexShrink: 1 }]} numberOfLines={1}>
          {row.name}
        </Text>
        {row.role ? <Pill theme={theme} label={row.role} colour={paint(theme, row.role, row.id)} filled /> : null}
        <StatusWord theme={theme} status={row.status} dim={row.dim} />
        <Text style={[text(theme, "label"), { flexShrink: 2, minWidth: 0 }]} numberOfLines={1}>
          {place}
        </Text>
      </View>
      <SessionMenu theme={theme} item={item} native={native} chat={chat} writable={writable} onInfo={onInfo} />
    </View>
  );
}

function ChatHead({ theme, item, native, chat, writable, onBack, onInfo }: { theme: PluginTheme; item: Conversation; native: Native; chat: NativeChat; writable: boolean; onBack?: () => void; onInfo: () => void }) {
  const compactFormFactor = useWindowDimensions().width < COMPACT_HEAD_BELOW;
  const [width, setWidth] = useState(0);
  if (compactFormFactor) return <CompactChatHead theme={theme} item={item} native={native} chat={chat} writable={writable} onBack={onBack} onInfo={onInfo} />;
  const stacked = width > 0 && width < HEAD_STACK_BELOW;
  const link = <NativeLink theme={theme} id={item.row.id} native={native} chat={chat} writable={writable} />;
  const { row } = item;
  const colour = paint(theme, row.role, row.id);
  const sub = [row.harness, row.model && row.model !== "-" ? row.model : undefined, row.ctx ? `${row.ctx} ctx` : undefined, row.turns ? `${row.turns} turns` : undefined].filter(Boolean).join(" · ");
  const project = basenameOf(item.dir.path);
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface0 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5], paddingHorizontal: SPACING[3], paddingTop: SPACING[2], overflow: "hidden" }} accessibilityLabel={`In project ${project}${item.teamName ? `, team ${item.teamName}` : ""}`}>
      <Icon name="Folder" size={12} color={theme.colors.accent} />
      <Text style={[text(theme, "label"), { color: theme.colors.foreground, fontWeight: "600", flexShrink: 0 }]} numberOfLines={1}>
        {project}
      </Text>
      <Text style={[text(theme, "label"), { flexShrink: 1, minWidth: 0 }]} numberOfLines={1} ellipsizeMode="head">
        {item.dir.label}
      </Text>
      {item.teamName ? (
        <>
          <Icon name="ChevronRight" size={11} color={theme.colors.foregroundMuted} />
          <Icon name="Users" size={12} color={theme.colors.foregroundMuted} />
          <Text style={[text(theme, "label"), { color: theme.colors.foreground, fontWeight: "600", flexShrink: 0 }]} numberOfLines={1}>
            {item.teamName}
          </Text>
          {item.template ? <Text style={[text(theme, "label"), { flexShrink: 0 }]} numberOfLines={1}>{item.template}</Text> : null}
        </>
      ) : (
        <>
          <Icon name="ChevronRight" size={11} color={theme.colors.foregroundMuted} />
          <Text style={text(theme, "label")}>solo session</Text>
        </>
      )}
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[3], paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], minHeight: 56 }}>
      {onBack ? (
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to sessions" hitSlop={SPACING[2]} style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" }}>
          <Icon name="ChevronLeft" size={ICON_SIZE.md} color={theme.colors.foreground} />
        </Pressable>
      ) : null}
      <View style={{ width: AVATAR_LG, height: AVATAR_LG }}>
        <RoleAvatar theme={theme} name={row.name} role={row.role} id={row.id} size={AVATAR_LG} dim={row.dim} />
        <StatusDot theme={theme} status={row.status} dim={row.dim} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: SPACING[0.5] }}>
        <View style={{ flexDirection: "row", flexWrap: stacked ? "wrap" : "nowrap", alignItems: "center", columnGap: SPACING[2], rowGap: SPACING[0.5] }}>
          <Text style={[text(theme, "rowTitle"), { fontWeight: "600", flexShrink: 1 }]} numberOfLines={1}>
            {row.name}
          </Text>
          {row.role ? <Pill theme={theme} label={row.role} colour={colour} filled /> : null}
          {row.gate ? <Pill theme={theme} label="gate" icon="DoorOpen" /> : null}
          <StatusPill theme={theme} status={row.status} word={row.state_text} dim={row.dim} />
        </View>
        <Text style={text(theme, "label")} numberOfLines={1}>
          {sub || item.preview}
        </Text>
        {stacked ? <View style={{ flexDirection: "row", marginTop: SPACING[0.5] }}>{link}</View> : null}
      </View>
      {stacked ? null : link}
      <Pressable onPress={onInfo} accessibilityRole="button" accessibilityLabel="About this session" hitSlop={SPACING[2]} style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" }}>
        <Icon name="Info" size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />
      </Pressable>
    </View>
    </View>
  );
}

/** Who the person is in piggery, once they have sent something; asked again after each send. */
function usePerson(bump: number): Me | null {
  const call = useRpc(person);
  const { value } = usePoll(
    async () => {
      const r = await call({});
      return r.ok ? { ok: true as const, value: r.person } : r;
    },
    `person:${bump}`,
    () => QUIET_MS,
  );
  return value ?? null;
}

/** The mail between the person and one session, newest first as the daemon lists it. */
function useThread(me: Me | null, id: string, bump: number): MailMessage[] {
  const call = useRpc(mail);
  const { value } = usePoll(
    async () => {
      if (!me) return { ok: true as const, value: [] as MailMessage[] };
      const r = await call({ participants: [me.id], participant: id, limit: 200 });
      return r.ok ? { ok: true as const, value: r.messages } : r;
    },
    `thread:${me?.id ?? ""}:${id}:${bump}`,
    () => BUSY_MS,
  );
  return value ?? [];
}

function gateOf(item: Conversation, all: Conversation[]): Conversation | undefined {
  const gates = all.filter((c) => c.teamKey === item.teamKey && c.row.gate === true);
  return gates.find((c) => c.row.status !== "gone") ?? gates[0];
}

function StopTurn({ theme, stop }: { theme: PluginTheme; stop: Stop }) {
  const toast = useToast();
  const [stopping, setStopping] = useState(false);
  const press = async () => {
    setStopping(true);
    const failed = await stop.onStop();
    if (failed) toast.error(failed);
    setStopping(false);
  };
  return (
    <Pressable onPress={() => void press()} disabled={stopping} accessibilityRole="button" accessibilityLabel={stopping ? "Canceling agent" : "Stop agent"} style={(state) => ({ flexDirection: "row", alignItems: "center", gap: SPACING[1.5], paddingHorizontal: SPACING[3], paddingVertical: SPACING[1.5], borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.colors.statusDanger, backgroundColor: hoveredOf(state) ? tint(theme.colors.statusDanger) : "transparent", opacity: stopping ? 0.5 : 1 })}>
      <Icon name={stopping ? "Loader" : "Square"} size={12} color={theme.colors.statusDanger} />
      <Text style={[text(theme, "label"), { color: theme.colors.statusDanger }]}>Stop</Text>
    </Pressable>
  );
}

function ThroughGate({ theme, gate, stop, onPick }: { theme: PluginTheme; gate: Conversation | undefined; stop: Stop | undefined; onPick: (id: string) => void }) {
  const words = gate ? `You talk to this team through ${gate.row.name}${gate.row.role ? ` (${gate.row.role})` : ""}` : "This team has no gate you can write to";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[3], borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface0, paddingHorizontal: SPACING[4], paddingVertical: SPACING[3] }}>
      <Pressable onPress={gate ? () => onPick(gate.row.id) : undefined} disabled={!gate} accessibilityRole={gate ? "button" : undefined} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING[1.5] }}>
        <Icon name="DoorOpen" size={12} color={theme.colors.foregroundMuted} />
        <Text style={[text(theme, "label"), { flexShrink: 1 }]} numberOfLines={1}>
          {words}
        </Text>
        {gate ? <Icon name="ChevronRight" size={12} color={theme.colors.foregroundMuted} /> : null}
      </Pressable>
      {stop?.running ? <StopTurn theme={theme} stop={stop} /> : null}
    </View>
  );
}

function hintOf(item: Conversation, native: Native, me: Me | null): string | undefined {
  if (native.kind === "open") return undefined;
  const keys = canAttach ? "Enter sends · paste images or + to attach" : "Enter sends";
  const why = native.kind === "mail" ? ` (${native.why})` : "";
  const who = me ? `you write as ${me.name}` : "your first message joins piggery as a solo session of yours";
  return `Piggery mail to ${item.row.name}${why} · ${who} · attachments go as file paths and links · ${keys}`;
}

function OpenStream({ theme, timeline, cwd, draftKey, viewportRef }: { theme: PluginTheme; timeline: AgentTimeline; cwd: string; draftKey: string; viewportRef: { current: ViewportHandle | null } }) {
  const composerTracks = useHasComposerTracks(timeline.agentId);
  return (
    <StreamView
      theme={theme}
      streamKey={timeline.agentId}
      tail={timeline.tail}
      head={timeline.head}
      turn={timeline.turn}
      cwd={timeline.agent?.cwd ?? cwd}
      permissions={timeline.permissions}
      pendingClientMessageIds={timeline.pendingClientMessageIds}
      history={{ hasOlder: timeline.hasOlder, isLoadingOlder: timeline.isLoadingOlder, progressKey: timeline.progressKey, loadOlder: timeline.loadOlder }}
      syncError={timeline.error ? { message: timeline.error, onRetry: timeline.retry } : null}
      onRespond={timeline.respond}
      viewportRef={viewportRef}
      outline={{ agentId: timeline.agentId, epoch: timeline.epoch, fetchPromptWindow: timeline.jumpToPrompt }}
      composerTracks={composerTracks}
      renderUserActions={(message) => (message.messageId ? <RewindMenu theme={theme} capabilities={timeline.agent?.capabilities} agentId={timeline.agentId} messageId={message.messageId} rewoundText={message.text} draftKey={draftKey} onRewound={timeline.refetchTail} /> : null)}
    />
  );
}

function OpenChat({ agentId, children }: { agentId: string; children: (timeline: AgentTimeline) => ReactNode }) {
  const timeline = useAgentTimeline(agentId);
  return <>{children(timeline)}</>;
}

function Chat({ theme, item, all, me, chat, onSent, onPick, onBack, onInfo }: { theme: PluginTheme; item: Conversation; all: Conversation[]; me: Me | null; chat: NativeChat; onSent: () => void; onPick: (id: string) => void; onBack?: () => void; onInfo: () => void }) {
  const native = chat.of(item.row.id);
  if (native.kind === "open") {
    return (
      <OpenChat key={native.agentId} agentId={native.agentId}>
        {(timeline) => <ChatPane theme={theme} item={item} all={all} me={me} chat={chat} native={native} timeline={timeline} onSent={onSent} onPick={onPick} onBack={onBack} onInfo={onInfo} />}
      </OpenChat>
    );
  }
  return <ChatPane theme={theme} item={item} all={all} me={me} chat={chat} native={native} timeline={null} onSent={onSent} onPick={onPick} onBack={onBack} onInfo={onInfo} />;
}

function ChatPane({ theme, item, all, me, chat, native, timeline, onSent, onPick, onBack, onInfo }: { theme: PluginTheme; item: Conversation; all: Conversation[]; me: Me | null; chat: NativeChat; native: Native; timeline: AgentTimeline | null; onSent: () => void; onPick: (id: string) => void; onBack?: () => void; onInfo: () => void }) {
  const stop = useStop(item.row.id, native, abortable(item.row.state));
  const [bump, setBump] = useState(0);
  const call = useRpc(sendMail);
  const writable = item.row.kind === "solo" || item.row.gate === true;
  const thread = useThread(me, item.row.id, bump);
  const extra = useMemo(() => (me ? itemsOfThread(thread, me) : []), [thread, me]);
  const viewportRef = useRef<ViewportHandle | null>(null);
  const sent = () => {
    viewportRef.current?.scrollToBottom();
    setBump((n) => n + 1);
    onSent();
  };
  const send = async (body: string, images: ImageData[], attachments: AttachmentData[]): Promise<string | null> => {
    if (native.kind === "open" && timeline) {
      const clientMessageId = generateMessageId();
      const message = createUserMessage({ clientMessageId, text: body, timestamp: new Date(), ...(timeline.turn.isActive && timeline.turn.turnId ? { turnId: timeline.turn.turnId } : {}), images: images.map((image, index) => ({ id: `${clientMessageId}:${index}`, uri: `data:${image.mimeType};base64,${image.data}`, mimeType: image.mimeType })), attachments });
      try {
        await timeline.submit(message, async () => {
          const failed = await chat.send(native.agentId, body, images, attachments, clientMessageId);
          if (failed) throw new Error(failed);
        });
      } catch (failure) {
        return failure instanceof Error ? failure.message : String(failure);
      }
      sent();
      return null;
    }
    const reply = me ? latestFrom(thread, item.row.id) : undefined;
    const r = await call({ to: item.row.id, body, ...(images.length > 0 ? { images } : {}), ...(attachments.length > 0 ? { attachments } : {}), ...(reply ? { reply_to: `#${reply.seq}` } : {}) });
    if (!r.ok) return r.code === "denied" && r.gate_name ? `${r.error} Write to ${r.gate_name} instead.` : r.error;
    sent();
    return null;
  };
  const ended = item.row.status === "gone" && native.kind !== "open";
  return (
    <FileDropZone theme={theme} style={{ flex: 1, minWidth: 0 }}>
    <KeyboardAvoidingPane>
      <ChatHead theme={theme} item={item} native={native} chat={chat} writable={writable} onBack={onBack} onInfo={onInfo} />
      {timeline ? <OpenStream theme={theme} timeline={timeline} cwd={item.dir.path} draftKey={item.row.id} viewportRef={viewportRef} /> : <MailStream theme={theme} id={item.row.id} extra={extra} hideFrom={me?.name} working={item.row.status === "working"} workingSince={item.row.state_since} cwd={item.dir.path} viewportRef={viewportRef} />}
      {writable ? (
        <Composer key={item.row.id} draftKey={item.row.id} cwd={item.dir.path} theme={theme} placeholder={ended ? "This session has ended" : `Message ${item.row.name}`} disabled={!chat.ready || ended} hint={hintOf(item, native, me)} controls={native.kind === "open" ? ({ isCompactLayout }) => <AgentControls theme={theme} agentId={native.agentId} isCompactLayout={isCompactLayout} /> : undefined} trailing={native.kind === "open" ? ({ isCompactLayout }) => <AgentContextMeter theme={theme} agentId={native.agentId} isCompactLayout={isCompactLayout} /> : undefined} stop={stop} agent={native.kind === "open" && timeline ? { agentId: native.agentId, timeline, open: chat.canOpen ? chat.open : undefined } : undefined} onSend={send} />
      ) : (
        <ThroughGate theme={theme} gate={gateOf(item, all)} stop={stop} onPick={onPick} />
      )}
    </KeyboardAvoidingPane>
    </FileDropZone>
  );
}

const IOS_HOME_INDICATOR_INSET = 34;
const homeIndicatorInset = Platform.OS === "ios" ? IOS_HOME_INDICATOR_INSET : 0;

function useIosKeyboardShown(): boolean {
  const [shown, setShown] = useState(() => Platform.OS === "ios" && Keyboard.isVisible());
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const subscriptions = [Keyboard.addListener("keyboardWillShow", () => setShown(true)), Keyboard.addListener("keyboardWillHide", () => setShown(false))];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);
  return shown;
}

function KeyboardAvoidingPane({ children }: { children: ReactNode }) {
  const paneRef = useRef<View>(null);
  const [paneTop, setPaneTop] = useState(0);
  const keyboardShown = useIosKeyboardShown();
  if (Platform.OS === "web") return <View style={{ flex: 1, minWidth: 0 }}>{children}</View>;
  const measurePaneTop = () => {
    paneRef.current?.measureInWindow((_x, y) => {
      const windowHeight = Dimensions.get("window").height;
      setPaneTop(Number.isFinite(y) ? Math.min(Math.max(0, y), windowHeight / 2) : 0);
    });
  };
  return (
    <View ref={paneRef} style={{ flex: 1, minWidth: 0 }} onLayout={measurePaneTop}>
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={paneTop} style={{ flex: 1, minWidth: 0 }}>
        {children}
        {homeIndicatorInset > 0 && !keyboardShown ? <View style={{ height: homeIndicatorInset }} /> : null}
      </KeyboardAvoidingView>
    </View>
  );
}

function Empty({ theme }: { theme: PluginTheme }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: SPACING[2], padding: SPACING[6] }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.surface1, alignItems: "center", justifyContent: "center" }}>
        <Icon name="MessagesSquare" size={24} color={theme.colors.foregroundMuted} />
      </View>
      <Text style={text(theme, "rowTitle")}>Pick a session</Text>
      <Text style={[text(theme, "meta"), { textAlign: "center", maxWidth: 320 }]}>Choose one on the left to read what the agent did, turn by turn.</Text>
    </View>
  );
}

/**
 * The Sessions tab as a chat app: the conversations down the left (search, a filter, grouped by team,
 * the most pressing first), the open one on the right with its transcript scrolled to the latest turn.
 * Narrower than CHAT_SPLIT_MIN, one at a time: the list, then the chat with a Back.
 */
export function SessionsPane({ theme, view, dirs, width, selected, opened, now, navigation, serverId, hidden, onSelect, onOpened, onInfo, onHide, onShowHidden }: { theme: PluginTheme; view: PigView; dirs: Dir[]; width: number; selected: string; opened: boolean; now: number; navigation?: Navigation; serverId?: string; hidden: number; onSelect: (id: string) => void; onOpened: (opened: boolean) => void; onInfo: (id: string) => void; onHide: (path: string) => void; onShowHidden: () => void }) {
  const actions = useProjectActions(navigation, serverId, onHide);
  const [sent, setSent] = useState(0);
  const me = usePerson(sent);
  const items = conversationsOf(view, dirs).filter((c) => c.row.id !== me?.id);
  const wide = width >= CHAT_SPLIT_MIN;
  const current = items.find((c) => c.row.id === selected) ?? (wide ? mostPressing(items) : undefined);
  const chat = useNative(items.map((c) => c.row.id), current?.row.id ?? "", navigation, serverId);
  const [listWidth, setListWidth, saveListWidth] = useSavedListWidth(LIST_WIDTH);
  if (width === 0) return <View style={{ flex: 1 }} />;
  if (items.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        <Notice theme={theme} kind="empty" detail="Open an agent session, or ask one to make a team." />
        {hidden > 0 ? <View style={{ paddingHorizontal: SPACING[3] }}><HiddenProjects theme={theme} count={hidden} onShow={onShowHidden} /></View> : null}
      </View>
    );
  }
  const pick = (id: string) => {
    onSelect(id);
    onOpened(true);
  };
  if (!wide) {
    if (opened && current) return <Chat key={current.row.id} theme={theme} item={current} all={items} me={me} chat={chat} onSent={() => setSent((n) => n + 1)} onPick={pick} onBack={() => onOpened(false)} onInfo={() => onInfo(current.row.id)} />;
    return <ConversationList theme={theme} items={items} selected={selected} now={now} actions={actions} hidden={hidden} onPick={pick} onShowHidden={onShowHidden} />;
  }
  const listMaxWidth = width / 2;
  const shownListWidth = clampWidth(listWidth, LIST_MIN_WIDTH, listMaxWidth);
  return (
    <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
      <View style={{ width: shownListWidth, borderRightWidth: 1, borderRightColor: theme.colors.border, zIndex: 1 }}>
        <ConversationList theme={theme} items={items} selected={current?.row.id ?? ""} now={now} actions={actions} hidden={hidden} onPick={pick} onShowHidden={onShowHidden} />
        <ResizeHandle theme={theme} width={shownListWidth} minWidth={LIST_MIN_WIDTH} maxWidth={listMaxWidth} onResize={setListWidth} onResizeEnd={saveListWidth} />
      </View>
      {current ? <Chat key={current.row.id} theme={theme} item={current} all={items} me={me} chat={chat} onSent={() => setSent((n) => n + 1)} onPick={pick} onInfo={() => onInfo(current.row.id)} /> : <Empty theme={theme} />}
    </View>
  );
}
