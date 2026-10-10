import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { collectAssistantResponseContent, layoutStream, type StreamLayoutItem, type TurnFooterHost } from "../shared/stream-layout.ts";
import { findEarlierHistoryWindowStart, findMountedWindowStart, MOUNTED_RECENT_STREAM_ITEMS } from "../shared/stream-scroll.ts";
import type { PiggeryStreamItem, StreamItem } from "../shared/stream.ts";
import { createStreamPresentation, getStreamItemMessageId } from "../shared/stream-presentation.ts";
import { deriveStreamTurnTiming, type TurnPresentation } from "../shared/turns.ts";
import { MAX_CONTENT_WIDTH, SPACING } from "./kit/theme.ts";
import { TURN_FOOTER_BOTTOM_SPACING, AssistantMessage, Notification, CompactionMarker, CompletedTurnFooter, RunningTurnFooter, SpeakMessage, ThoughtBadge, TodoListCard, ToolCall, TurnFooterRow, UserMessage, useIsCompact } from "./message.tsx";
import { ChatFind, useChatFindSelectedMessageId, type AgentHistory } from "./chat-find.tsx";
import { NativeViewport, WebViewport, type ViewportHandle, type ViewportProps } from "./stream-viewport.tsx";
import { ChatOutlineRail, useChatOutline } from "./outline.tsx";
import { PermissionRequestCard } from "./permission.tsx";
import { TRACK_PILL_CLEARANCE, TRACK_PILL_MIN_HEIGHT } from "./tracks.tsx";
import type { PermissionRequest, PermissionResponse } from "./timeline.ts";

const isWeb = Platform.OS === "web";

interface StreamHistory {
  hasOlder: boolean;
  isLoadingOlder: boolean;
  progressKey: string | null;
  loadOlder: () => Promise<boolean>;
}


interface StreamViewProps {
  theme: PluginTheme;
  streamKey: string;
  tail: StreamItem[];
  head: StreamItem[];
  turn: TurnPresentation;
  cwd?: string;
  permissions?: PermissionRequest[];
  pendingClientMessageIds?: ReadonlySet<string>;
  history: StreamHistory;
  emptyText?: string;
  syncError?: { message: string; onRetry: () => void } | null;
  renderPiggery?: (item: PiggeryStreamItem) => ReactNode;
  renderUserActions?: (item: Extract<StreamItem, { kind: "user_message" }>) => ReactNode;
  onRespond?: (requestId: string, response: PermissionResponse) => Promise<void>;
  onReadingPosition?: (itemId: string | null) => void;
  viewportRef?: { current: ViewportHandle | null };
  overlay?: ReactNode;
  outline?: AgentHistory;
  composerTracks?: boolean;
}

function composerTrackTailClearance(compact: boolean): number {
  return (compact ? SPACING[6] : 20) + TRACK_PILL_MIN_HEIGHT + TRACK_PILL_CLEARANCE;
}

function composerTrackControlClearance(): number {
  return TRACK_PILL_CLEARANCE * 2 + TRACK_PILL_MIN_HEIGHT;
}

function useStreamHistoryWindow(streamKey: string, items: StreamItem[], loadRemoteOlder: () => Promise<boolean>) {
  const initialStart = useMemo(() => findMountedWindowStart(items, MOUNTED_RECENT_STREAM_ITEMS), [items]);
  const initialBoundary = initialStart === 0 ? null : (items[initialStart]?.id ?? null);
  const [window, setWindow] = useState({ key: streamKey, boundary: initialBoundary, initialized: items.length > 0 });
  const boundaryIndex = window.key === streamKey && window.boundary !== null ? items.findIndex((item) => item.id === window.boundary) : -1;
  let start = initialStart;
  if (window.key === streamKey && window.initialized) {
    if (window.boundary === null) start = 0;
    else if (boundaryIndex >= 0) start = boundaryIndex;
  }
  useEffect(() => {
    setWindow((current) => {
      if (current.key !== streamKey) return { key: streamKey, boundary: initialBoundary, initialized: items.length > 0 };
      if (!current.initialized && items.length > 0) return { ...current, boundary: initialBoundary, initialized: true };
      if (current.boundary !== null && boundaryIndex < 0) return { ...current, boundary: initialBoundary };
      return current;
    });
  }, [streamKey, boundaryIndex, initialBoundary, items.length]);
  const reveal = useCallback(
    (itemId?: string): boolean => {
      const targetIndex = itemId ? items.findIndex((item) => getStreamItemMessageId(item) === itemId) : -1;
      if (start === 0 || (itemId !== undefined && (targetIndex < 0 || targetIndex >= start))) return false;
      const next = findEarlierHistoryWindowStart(items, start, itemId);
      if (next === start) return false;
      setWindow({ key: streamKey, boundary: items[next]?.id ?? null, initialized: true });
      return true;
    },
    [streamKey, items, start],
  );
  const loadOlder = useCallback(async () => reveal() || (await loadRemoteOlder()), [reveal, loadRemoteOlder]);
  return { start, hasLocalHistory: start > 0, reveal, loadOlder };
}

function ItemContent({ theme, layout, cwd, pending, renderPiggery, renderUserActions }: { theme: PluginTheme; layout: StreamLayoutItem; cwd?: string; pending?: ReadonlySet<string>; renderPiggery?: StreamViewProps["renderPiggery"]; renderUserActions?: StreamViewProps["renderUserActions"] }): ReactNode {
  const item = layout.item;
  switch (item.kind) {
    case "user_message":
      return <UserMessage theme={theme} text={item.text} images={item.images} attachments={item.attachments} timestamp={item.timestamp} note={item.note} isFirstInGroup={layout.isFirstInUserGroup} isLastInGroup={layout.isLastInUserGroup} isPending={item.clientMessageId !== undefined && pending?.has(item.clientMessageId) === true} actions={renderUserActions?.(item)} />;
    case "assistant_message":
      return <FindableAssistant theme={theme} layout={layout} item={item} />;
    case "thought":
      return <ThoughtBadge theme={theme} text={item.text} status={item.status} isLastInSequence={layout.isLastInToolSequence} />;
    case "tool_call": {
      const data = item.payload.data;
      if (data.name === "speak" && data.detail.type === "unknown" && typeof data.detail.input === "string" && data.detail.input.trim()) return <SpeakMessage theme={theme} message={data.detail.input} />;
      return <ToolCall theme={theme} toolName={data.name} error={data.error} status={data.status} detail={data.detail} cwd={cwd} metadata={data.metadata} isLastInSequence={layout.isLastInToolSequence} />;
    }
    case "notification":
      return <Notification theme={theme} level={item.level} message={item.message} />;
    case "plugin":
      return null;
    case "todo_list":
      return <TodoListCard theme={theme} items={item.items} activity={item.activity} isLastInSequence={layout.isLastInToolSequence} />;
    case "compaction":
      return <CompactionMarker theme={theme} status={item.status} trigger={item.trigger} preTokens={item.preTokens} />;
    case "piggery":
      return renderPiggery?.(item) ?? null;
  }
}

function FindableAssistant({ theme, layout, item }: { theme: PluginTheme; layout: StreamLayoutItem; item: Extract<StreamItem, { kind: "assistant_message" }> }) {
  const selected = useChatFindSelectedMessageId();
  return <AssistantMessage theme={theme} text={item.text} phase={layout.phase} spacing={layout.assistantSpacing} renderFullContent={selected === getStreamItemMessageId(item)} />;
}

function footerContent(host: TurnFooterHost) {
  return () => collectAssistantResponseContent(host.items, host.startIndex);
}

const Row = memo(function Row({ theme, layout, cwd, pending, renderPiggery, renderUserActions }: { theme: PluginTheme; layout: StreamLayoutItem; cwd?: string; pending?: ReadonlySet<string>; renderPiggery?: StreamViewProps["renderPiggery"]; renderUserActions?: StreamViewProps["renderUserActions"] }) {
  const content = ItemContent({ theme, layout, cwd, pending, renderPiggery, renderUserActions });
  const footer = layout.completedFooter;
  if (!content && !footer) return null;
  return (
    <>
      {content ? <View style={{ width: "100%", maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center", paddingHorizontal: SPACING[2], marginBottom: layout.gapBelow }}>{content}</View> : null}
      {footer ? (
        <TurnFooterRow>
          <CompletedTurnFooter theme={theme} getContent={footerContent(footer)} timing={footer.timing} />
        </TurnFooterRow>
      ) : null}
    </>
  );
});


export function StreamView({ theme, streamKey, tail, head, turn, cwd, permissions = [], pendingClientMessageIds, history, emptyText = "Start chatting with this agent...", syncError, renderPiggery, renderUserActions, onRespond, onReadingPosition, viewportRef: externalViewportRef, overlay, outline: outlineSource, composerTracks = false }: StreamViewProps) {
  const compact = useIsCompact();
  const tailClearance = composerTracks ? composerTrackTailClearance(compact) : 0;
  const controlClearance = composerTracks ? composerTrackControlClearance() : 0;
  const [nearBottom, setNearBottom] = useState(true);
  const internalViewportRef = useRef<ViewportHandle | null>(null);
  const viewportRef = externalViewportRef ?? internalViewportRef;
  useEffect(() => setNearBottom(true), [streamKey]);
  const present = useMemo(() => createStreamPresentation(), [streamKey]);
  const presentation = useMemo(() => present({ tail, head }), [present, tail, head]);
  const windowed = useStreamHistoryWindow(streamKey, presentation.tail, history.loadOlder);
  const renderedTail = useMemo(() => (windowed.start ? presentation.tail.slice(windowed.start) : presentation.tail), [presentation.tail, windowed.start]);
  const timing = useMemo(() => deriveStreamTurnTiming({ isTurnActive: turn.isActive, activeTurnStartedAt: turn.startedAt, tail: renderedTail, head: presentation.head }), [turn.isActive, turn.startedAt, renderedTail, presentation.head]);
  const layout = useMemo(() => layoutStream({ isTurnActive: turn.isActive, history: renderedTail, liveHead: presentation.head, timing: timing.byAssistantId }), [turn.isActive, renderedTail, presentation.head, timing]);
  const visibleMessageIds = useMemo(() => new Set([...renderedTail, ...presentation.head].map(getStreamItemMessageId)), [renderedTail, presentation.head]);
  const loadedItems = useMemo(() => [...tail, ...head], [tail, head]);
  const agentHistory = outlineSource ?? null;
  const outline = useChatOutline({ streamKey, agent: agentHistory, items: loadedItems, viewportRef, visibleMessageIds, revealLoadedMessage: windowed.reveal });
  const rowsById = useMemo(() => new Map([...layout.history, ...layout.liveHead].map((row) => [row.item.id, row.item])), [layout]);
  const reportReading = useCallback(
    (rowId: string | null) => {
      onReadingPosition?.(rowId);
      const row = rowId === null ? undefined : rowsById.get(rowId);
      outline.reportReadingPosition(row ? outline.seqOf(row) : null);
    },
    [onReadingPosition, outline, rowsById],
  );
  const renderRow = useCallback((item: StreamLayoutItem) => <Row theme={theme} layout={item} cwd={cwd} pending={pendingClientMessageIds} renderPiggery={renderPiggery} renderUserActions={renderUserActions} />, [theme, cwd, pendingClientMessageIds, renderPiggery, renderUserActions]);
  const footerHost = layout.auxiliaryTurnFooter;
  const turnFooter = turn.isActive ? (
    <TurnFooterRow>
      <RunningTurnFooter theme={theme} startedAt={timing.runningStartedAt} />
    </TurnFooterRow>
  ) : footerHost ? (
    <TurnFooterRow>
      <CompletedTurnFooter theme={theme} getContent={footerContent(footerHost)} timing={footerHost.timing} />
    </TurnFooterRow>
  ) : null;
  const permissionCards =
    permissions.length > 0 && onRespond ? (
      <View style={{ width: "100%", maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center", paddingHorizontal: SPACING[2] }}>
        <View style={{ gap: SPACING[3] }}>
          <View style={{ gap: SPACING[2] }}>
            {permissions.map((permission) => (
              <PermissionRequestCard key={permission.id} theme={theme} permission={permission} onRespond={onRespond} />
            ))}
          </View>
        </View>
      </View>
    ) : null;
  const bottomInset = Math.max(0, tailClearance - (turnFooter && !permissionCards ? TURN_FOOTER_BOTTOM_SPACING : 0));
  const auxiliary = turnFooter || permissionCards || bottomInset > 0 ? (
    <>
      {turnFooter}
      {permissionCards}
      {bottomInset > 0 ? <View style={{ height: bottomInset }} /> : null}
    </>
  ) : null;
  const empty = turnFooter || permissionCards ? null : (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: SPACING[8] + SPACING[4], width: "100%", maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center", paddingHorizontal: SPACING[2] }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14, textAlign: "center" }}>{emptyText}</Text>
    </View>
  );
  const viewportProps: ViewportProps = {
    theme,
    streamKey,
    history: layout.history,
    liveHead: layout.liveHead,
    renderRow,
    auxiliary,
    empty,
    hasOlder: windowed.hasLocalHistory || history.hasOlder,
    isLoadingOlder: history.isLoadingOlder,
    progressKey: `${history.progressKey ?? "local"}:${windowed.start}`,
    onNearHistoryStart: windowed.loadOlder,
    onNearBottomChange: setNearBottom,
    onReadingPosition: reportReading,
    viewportRef,
  };
  return (
    <View style={{ flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 }}>
      <ChatFind theme={theme} agent={agentHistory} items={loadedItems} viewportRef={viewportRef} revealLoadedMessage={windowed.reveal} visibleMessageIds={visibleMessageIds}>
        {isWeb ? <WebViewport {...viewportProps} /> : <NativeViewport {...viewportProps} />}
      </ChatFind>
      <ChatOutlineRail theme={theme} outline={outline} />
      {overlay}
      {syncError ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: SPACING[4], alignItems: "center" }} pointerEvents="box-none">
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[3], paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], borderRadius: SPACING[2], borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>Couldn't refresh agent history.</Text>
            <Pressable onPress={syncError.onRetry} accessibilityRole="button" style={{ paddingHorizontal: SPACING[2], paddingVertical: SPACING[1], borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>Retry</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {!nearBottom ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: Math.max(16, controlClearance), alignItems: "center" }} pointerEvents="box-none">
          <Pressable onPress={() => viewportRef.current?.scrollToBottom()} accessibilityRole="button" accessibilityLabel="Scroll to bottom" style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.surface2, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } }}>
            <Icon name="ChevronDown" size={24} color={theme.colors.foreground} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

