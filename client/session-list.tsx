import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, TextInput, View, type PressableStateCallbackType } from "react-native";
import { matches, passes, projectsOf, SOLO_KEY, type Conversation, type Filter, type Group, type Project } from "../shared/conversations.ts";
import { ageShort } from "../shared/format.ts";
import type { Status } from "../shared/view.ts";
import { Chip } from "./kit/badge.tsx";
import { AvatarStack, paint, RoleAvatar } from "./piggery/role.tsx";
import { STATUS_WORD, statusColour, StatusDot, StatusWord } from "./piggery/status.tsx";
import { hovered, PressRow } from "./kit/press.tsx";
import { AVATAR_LG, ICON_SIZE, RADIUS, ROW_CHAT, ROW_MIN, SPACING, text, tint } from "./kit/theme.ts";
import { TreeGuides, treeIndent, treeSpotsOf, type TreeSpot } from "./kit/tree.tsx";
import { NotifyHint } from "./notify.tsx";
import type { ProjectActions } from "./project.tsx";

const BAR = 3;
const RING_GAP = 3;
const PARENT_REACH = (ROW_CHAT - AVATAR_LG) / 2 + 3;
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "waiting", label: "Needs you" },
  { id: "gone", label: "Ended" },
];

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
    backgroundColor: selected || state.pressed ? theme.colors.surface2 : hovered(state) ? theme.colors.surface1 : "transparent",
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
            <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"], flexShrink: 0, color: row.unacked > 0 ? theme.colors.accent : theme.colors.foregroundMuted }]}>{ageShort(item.at, now)}</Text>
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
      style={(state) => ({ width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.md, backgroundColor: state.pressed ? theme.colors.surface2 : hovered(state) ? theme.colors.surface1 : "transparent" })}
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
            <Text style={[text(theme, "label"), { flex: 1, minWidth: 0, opacity: hovered(state) ? 1 : 0 }]} numberOfLines={1} ellipsizeMode="head">
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

function GroupHead({ theme, group, collapsed, onToggle }: { theme: PluginTheme; group: Group; collapsed: boolean; onToggle: () => void }) {
  const template = group.items[0]?.template;
  const members = group.items.map((c) => ({ id: c.row.id, name: c.row.name, role: c.row.role, dim: c.row.dim === true || c.row.status === "gone" }));
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={`${collapsed ? "Expand" : "Collapse"} ${group.label}${template ? ` ${template}` : ""}`}
      style={(state) => ({ flexDirection: "row", alignItems: "center", gap: SPACING[1.5], paddingLeft: SPACING[3] + 22 + SPACING[2] - 12 - SPACING[1.5], paddingRight: SPACING[3], paddingTop: SPACING[2], paddingBottom: SPACING[0.5], borderRadius: RADIUS.md, backgroundColor: state.pressed ? theme.colors.surface2 : hovered(state) ? theme.colors.surface1 : "transparent" })}
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

export function ConversationList({ theme, items, selected, now, actions, hidden, onPick, onShowHidden }: { theme: PluginTheme; items: Conversation[]; selected: string; now: number; actions: ProjectActions; hidden: number; onPick: (id: string) => void; onShowHidden: () => void }) {
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
