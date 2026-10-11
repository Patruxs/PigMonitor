import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { Column, Dir, Row, View as PigView } from "../../shared/view.ts";
import { Legend } from "../kit/panel.tsx";
import { AvatarStack } from "../piggery/role.tsx";
import { Chip } from "../kit/badge.tsx";
import { statusColour, usePalette } from "../piggery/palette.tsx";
import { PressRow } from "../kit/press.tsx";
import { AgentCard } from "../piggery/row.tsx";
import { MultiSelect, Select } from "../kit/select.tsx";
import { CARD_RADIUS, ICON_SIZE, ORG_CARD, RADIUS, ROW_MIN, SPACING, text, tint } from "../kit/theme.ts";
import { graphOf, type Item, itemsIn, type Node, type Tree, treeOf } from "./graph-layout.ts";

const TEAM_CHIPS_MAX = 5;

function groupsOf<T>(items: T[], key: (item: T) => string): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return [...out];
}

function columnWord(c: Column): string {
  const plain = c.word.replace(/^[^A-Za-z]+/, "");
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

function dirWords(label: string): { name: string; path: string } {
  const trimmed = label.replace(/^…\//, "").replace(/\/+$/, "");
  const at = trimmed.lastIndexOf("/");
  return at < 0 ? { name: trimmed, path: "" } : { name: trimmed.slice(at + 1), path: trimmed.slice(0, at + 1) };
}

function countWords(items: Item[], columns: Column[]): string {
  return columns
    .map((c) => ({ n: items.filter((i) => i.row.status === c.status).length, word: columnWord(c).toLowerCase() }))
    .filter((c) => c.n > 0)
    .map((c) => `${c.n} ${c.word}`)
    .join(" · ");
}

function roleWords(rows: Row[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const role = r.role ?? "solo";
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return [...counts].map(([role, n]) => `${n} ${n === 1 ? role : role.endsWith("s") ? role : `${role}s`}`).join(" · ");
}

const EDGE = 1;
const DROP = 28;
const ELBOW = 10;
const PORT = 6;
const SIBLING_GAP = SPACING[4];
const GRID = 24;

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

export function Graph({ theme, view, dirs, open }: { theme: PluginTheme; view: PigView; dirs?: Dir[]; open: (id: string) => void }) {
  const palette = usePalette(theme);
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
  const legend = columns.filter((c) => shown.some((i) => i.row.status === c.status)).map((c) => ({ label: columnWord(c), colour: statusColour(palette, c.status) }));
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
