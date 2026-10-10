import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { StreamItem, TodoEntry } from "../shared/stream.ts";
import { AnchoredPopover } from "./kit/menu.tsx";
import { hostColours, MAX_CONTENT_WIDTH, RADIUS, SPACING } from "./kit/theme.ts";
import { BUSY_MS, usePoll } from "./poll.ts";

type Bucket = "needs_input" | "failed" | "attention" | "running";

interface Segment {
  bucket: Bucket | null;
  text: string;
}

interface SubagentRow {
  id: string;
  title: string | null;
  status: string;
  turnOpen: boolean;
  createdAt: number;
}

type ArchiveFinishedStatus = { kind: "idle" } | { kind: "archiving"; completedCount: number; totalCount: number } | { kind: "failed"; failedCount: number; totalCount: number };

const PILL_MIN_HEIGHT = 32;
const PILL_RADIUS = 16;
const PILL_CLEARANCE = 10;
const PANEL_MIN_WIDTH = 280;
const PANEL_MAX_WIDTH = 620;
const PANEL_MAX_HEIGHT = 440;
const PANEL_OFFSET = 12;
const ROW_ICON_SIZE = 14;
const DOT_SIZE = 6;
const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
const SUBAGENT_PAGE = 200;

export function latestTasksFromStream(items: readonly StreamItem[]): TodoEntry[] {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "todo_list") return item.items;
  }
  return [];
}

export function hasComposerTracks(items: readonly StreamItem[], subagentCount: number, archiving = false): boolean {
  return subagentCount > 0 || latestTasksFromStream(items).length > 0 || archiving;
}

const visibleTracks = new Map<string, boolean>();
const trackListeners = new Set<() => void>();

function publishTracksVisible(agentId: string, visible: boolean): void {
  if ((visibleTracks.get(agentId) ?? false) === visible) return;
  visibleTracks.set(agentId, visible);
  for (const listener of trackListeners) listener();
}

function subscribeTracks(listener: () => void): () => void {
  trackListeners.add(listener);
  return () => trackListeners.delete(listener);
}

export function useHasComposerTracks(agentId: string | undefined): boolean {
  return useSyncExternalStore(
    subscribeTracks,
    () => (agentId ? (visibleTracks.get(agentId) ?? false) : false),
    () => false,
  );
}

function dotColour(theme: PluginTheme, bucket: Exclude<Bucket, "running">): string {
  if (bucket === "needs_input") return theme.colors.statusWarning;
  if (bucket === "failed") return theme.colors.statusDanger;
  return theme.colors.statusSuccess;
}

function TrackMark({ theme, bucket }: { theme: PluginTheme; bucket: Bucket | null }) {
  if (!bucket) return null;
  if (bucket === "running") return <ActivityIndicator size={10} color={theme.colors.accent} />;
  return <View style={{ width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2, backgroundColor: dotColour(theme, bucket) }} />;
}

function TrackPill({ theme, segments, title, accessibilityLabel, panel }: { theme: PluginTheme; segments: Segment[]; title: string; accessibilityLabel?: string; panel: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <AnchoredPopover theme={theme} open={open} label={title} onClose={close} panel={panel(close)} minWidth={PANEL_MIN_WIDTH} maxWidth={PANEL_MAX_WIDTH} maxHeight={PANEL_MAX_HEIGHT} offset={PANEL_OFFSET}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? segments.map((s) => s.text).join(" ")}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((was) => !was)}
        style={(state) => ({ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: PILL_MIN_HEIGHT, paddingHorizontal: SPACING[3], paddingVertical: SPACING[1], borderRadius: PILL_RADIUS, borderWidth: 1, borderColor: hostColours(theme).borderAccent, backgroundColor: open || state.pressed || (state as { hovered?: boolean }).hovered ? theme.colors.surface2 : theme.colors.surface1 })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1, minWidth: 0, gap: SPACING[4] }}>
          {segments.map((segment) => (
            <View key={segment.bucket ?? "plain"} style={{ flexDirection: "row", alignItems: "center", flexShrink: 1, minWidth: 0, gap: SPACING[2] }}>
              <TrackMark theme={theme} bucket={segment.bucket} />
              <Text style={{ fontSize: 12, color: open ? theme.colors.foreground : theme.colors.foregroundMuted }} numberOfLines={1}>
                {segment.text}
              </Text>
            </View>
          ))}
        </View>
      </Pressable>
    </AnchoredPopover>
  );
}

function TrackRow({ theme, onPress, disabled, accessibilityLabel, children }: { theme: PluginTheme; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string; children: (active: boolean) => ReactNode }) {
  const [hovered, setHovered] = useState(false);
  const row = (active: boolean) => <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: 32, marginHorizontal: SPACING[1], paddingHorizontal: SPACING[2], paddingVertical: SPACING[1], borderRadius: RADIUS.md, backgroundColor: active ? theme.colors.surface2 : "transparent" }}>{children(active)}</View>;
  if (!onPress) return <View accessibilityLabel={accessibilityLabel}>{row(false)}</View>;
  return (
    <View onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress}>
        {({ pressed }) => row(hovered || pressed)}
      </Pressable>
    </View>
  );
}

function TaskRow({ theme, task }: { theme: PluginTheme; task: TodoEntry }) {
  const isCompleted = task.completed || task.status === "completed";
  const isRunning = !isCompleted && task.status === "in_progress";
  const label = isRunning && task.activeForm ? task.activeForm : task.text;
  const extraMuted = hostColours(theme).foregroundExtraMuted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], flexGrow: 1, flexShrink: 1, minWidth: 0 }} accessibilityLabel={label}>
      <Icon name={isCompleted ? "CircleCheck" : isRunning ? "CircleDot" : "Circle"} size={16} color={isRunning ? theme.colors.accent : extraMuted} />
      <Text numberOfLines={1} style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, fontSize: 14, color: isCompleted ? extraMuted : isRunning ? theme.colors.foreground : theme.colors.foregroundMuted, textDecorationLine: isCompleted ? "line-through" : "none" }}>
        {label}
      </Text>
    </View>
  );
}

function TaskList({ theme, tasks }: { theme: PluginTheme; tasks: TodoEntry[] }) {
  const completed = tasks.filter((task) => task.completed || task.status === "completed").length;
  const label = `${completed}/${tasks.length} tasks`;
  return (
    <TrackPill
      theme={theme}
      segments={[{ bucket: null, text: label }]}
      title="Tasks"
      panel={() =>
        tasks.map((task, index) => (
          <TrackRow key={task.id ?? `${index}:${task.text}`} theme={theme}>
            {() => <TaskRow theme={theme} task={task} />}
          </TrackRow>
        ))
      }
    />
  );
}

function resolveRowLabel(title: string | null | undefined): string | null {
  const normalized = typeof title === "string" ? title.trim() : "";
  if (!normalized || normalized.toLowerCase() === "new agent") return null;
  return normalized;
}

function bucketOf(row: SubagentRow): Bucket | null {
  const status = row.turnOpen ? "running" : row.status === "running" ? "idle" : row.status;
  if (status === "error") return "failed";
  if (status === "running") return "running";
  return null;
}

function isFinished(row: SubagentRow): boolean {
  return row.status === "idle" || row.status === "error";
}

const ACTIVE_ORDER: Bucket[] = ["needs_input", "failed", "attention", "running"];

function statusLabel(bucket: Bucket, count: number): string {
  if (bucket === "running") return `${count} working`;
  if (bucket === "failed") return `${count} failed`;
  if (bucket === "needs_input") return count === 1 ? "1 needs input" : `${count} need input`;
  return `${count} ready to review`;
}

function pillPresentation(rows: SubagentRow[]): { segments: Segment[]; accessibilityLabel: string } {
  const buckets = rows.map(bucketOf);
  const counts = ACTIVE_ORDER.flatMap((bucket) => {
    const count = buckets.filter((candidate) => candidate === bucket).length;
    return count > 0 ? [{ bucket, count }] : [];
  });
  if (counts.length === 0) {
    const label = rows.length === 1 ? "1 subagent" : `${rows.length} subagents`;
    return { segments: [{ bucket: null, text: label }], accessibilityLabel: label };
  }
  const labels = counts.map(({ bucket, count }) => statusLabel(bucket, count));
  return { segments: counts.map(({ bucket }, index) => ({ bucket, text: labels[index] ?? "" })), accessibilityLabel: labels.join(", ") };
}

function useSubagents(parentAgentId: string, bump: number): SubagentRow[] {
  const paseo = usePaseo();
  const { value } = usePoll(
    async () => {
      try {
        const r = await paseo.agents.list({ filter: { labels: { [PARENT_AGENT_ID_LABEL]: parentAgentId } }, sort: [{ key: "created_at", direction: "asc" }], page: { limit: SUBAGENT_PAGE } });
        const rows = r.entries
          .map(({ agent }) => agent)
          .filter((agent) => !agent.archivedAt)
          .map((agent) => ({ id: agent.id, title: agent.title, status: agent.status, turnOpen: Boolean(agent.activeTurn), createdAt: Date.parse(agent.createdAt) }));
        rows.sort((a, b) => a.createdAt - b.createdAt);
        return { ok: true as const, value: rows };
      } catch (error) {
        return { ok: false as const, code: "failed", error: String((error as Error)?.message ?? error) };
      }
    },
    `subagents:${parentAgentId}:${bump}`,
    () => BUSY_MS,
  );
  return value ?? [];
}

function SubagentsTrack({ theme, rows, status, onOpen, onArchive, onArchiveFinished }: { theme: PluginTheme; rows: SubagentRow[]; status: ArchiveFinishedStatus; onOpen?: (id: string) => void; onArchive: (id: string) => void; onArchiveFinished: () => void }) {
  if (rows.length === 0 && status.kind === "idle") return null;
  const pill = pillPresentation(rows);
  const showArchiveFinished = rows.some(isFinished) || status.kind !== "idle";
  return (
    <TrackPill
      theme={theme}
      segments={pill.segments}
      title="Subagents"
      accessibilityLabel={pill.accessibilityLabel}
      panel={(close) => (
        <>
          {showArchiveFinished ? (
            <>
              <TrackRow theme={theme} accessibilityLabel="Archive finished subagents" disabled={status.kind === "archiving"} onPress={onArchiveFinished}>
                {(active) => (
                  <>
                    <Icon name="Archive" size={ROW_ICON_SIZE} color={active ? theme.colors.foreground : theme.colors.foregroundMuted} />
                    <Text style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, fontSize: 14, color: theme.colors.foreground }} numberOfLines={1}>
                      Archive finished subagents
                    </Text>
                    {status.kind === "archiving" ? <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>{`${status.completedCount}/${status.totalCount}`}</Text> : null}
                    {status.kind === "failed" ? <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>{`Retry (${status.failedCount}/${status.totalCount})`}</Text> : null}
                  </>
                )}
              </TrackRow>
              {rows.length > 0 ? <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: SPACING[1] }} /> : null}
            </>
          ) : null}
          {rows.map((row) => {
            const label = resolveRowLabel(row.title) ?? "Loading...";
            const bucket = bucketOf(row);
            return (
              <TrackRow
                key={row.id}
                theme={theme}
                accessibilityLabel={label}
                onPress={
                  onOpen
                    ? () => {
                        close();
                        onOpen(row.id);
                      }
                    : undefined
                }
              >
                {(active) => (
                  <>
                    <View style={{ width: ROW_ICON_SIZE, alignItems: "center", justifyContent: "center" }}>{bucket ? <TrackMark theme={theme} bucket={bucket} /> : <Icon name="Bot" size={ROW_ICON_SIZE} color={theme.colors.foregroundMuted} />}</View>
                    <Text style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, fontSize: 14, color: theme.colors.foreground }} numberOfLines={1}>
                      {label}
                    </Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Archive ${label}`} hitSlop={8} onPress={() => onArchive(row.id)} style={{ padding: SPACING[1], opacity: active ? 1 : 0, pointerEvents: active ? "auto" : "none" }}>
                      {({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => <Icon name="Archive" size={ROW_ICON_SIZE} color={hovered || pressed ? theme.colors.foreground : theme.colors.foregroundMuted} />}
                    </Pressable>
                  </>
                )}
              </TrackRow>
            );
          })}
        </>
      )}
    />
  );
}

export function ComposerTracks({ theme, agentId, items, onOpenAgent }: { theme: PluginTheme; agentId: string; items: readonly StreamItem[]; onOpenAgent?: (agentId: string) => void }) {
  const paseo = usePaseo();
  const toast = useToast();
  const [bump, setBump] = useState(0);
  const [archiveStatus, setArchiveStatus] = useState<ArchiveFinishedStatus>({ kind: "idle" });
  const tasks = useMemo(() => latestTasksFromStream(items), [items]);
  const rows = useSubagents(agentId, bump);
  const archive = async (id: string) => {
    try {
      await paseo.agents.ref(id).archive();
    } catch (error) {
      toast.error(String((error as Error)?.message ?? error));
    }
    setBump((n) => n + 1);
  };
  const archiveFinished = async () => {
    const finished = rows.filter(isFinished);
    if (finished.length === 0) return setArchiveStatus({ kind: "idle" });
    let completed = 0;
    let failed = 0;
    setArchiveStatus({ kind: "archiving", completedCount: 0, totalCount: finished.length });
    for (const row of finished) {
      try {
        await paseo.agents.ref(row.id).archive();
      } catch {
        failed += 1;
      }
      completed += 1;
      setArchiveStatus({ kind: "archiving", completedCount: completed, totalCount: finished.length });
    }
    setArchiveStatus(failed > 0 ? { kind: "failed", failedCount: failed, totalCount: finished.length } : { kind: "idle" });
    setBump((n) => n + 1);
  };
  const visible = hasComposerTracks(items, rows.length, archiveStatus.kind !== "idle");
  useEffect(() => {
    publishTracksVisible(agentId, visible);
  }, [agentId, visible]);
  useEffect(() => () => publishTracksVisible(agentId, false), [agentId]);
  if (!visible) return null;
  return (
    <View style={{ position: "absolute", left: 0, right: 0, bottom: "100%", alignItems: "center", paddingHorizontal: SPACING[4], paddingBottom: PILL_CLEARANCE, pointerEvents: "box-none", zIndex: 5 }}>
      <View style={{ width: "100%", maxWidth: MAX_CONTENT_WIDTH, flexDirection: "row", alignItems: "center", gap: SPACING[1], pointerEvents: "box-none" }}>
        {tasks.length > 0 ? <TaskList theme={theme} tasks={tasks} /> : null}
        <SubagentsTrack theme={theme} rows={rows} status={archiveStatus} onOpen={onOpenAgent} onArchive={(id) => void archive(id)} onArchiveFinished={() => void archiveFinished()} />
      </View>
    </View>
  );
}
