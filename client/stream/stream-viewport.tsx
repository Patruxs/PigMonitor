import type { PluginTheme } from "@getpaseo/plugin";
import { ScrollView as SheetScrollView } from "@getpaseo/plugin/client/react-native";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ActivityIndicator, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView as NativeScrollView } from "react-native";
import type { StreamLayoutItem } from "./stream-layout.ts";
import { getStreamItemMessageId } from "./stream-presentation.ts";
import { isHistoryStartLoadingOperation } from "./stream-scroll.ts";
import { hostColours } from "../kit/theme.ts";
import { useIsCompact } from "./message.tsx";
import { historyRowAttributes } from "./find-anchors.ts";
import { useReadingAnchor } from "./viewport-anchor.ts";
import { useFollowBottom } from "./viewport-follow.ts";
import { SCROLLBAR_SIZE } from "./viewport-geometry.ts";
import { useScrollGestures } from "./viewport-gestures.ts";
import { useMessageJump, type ActiveJump, type ViewportHandle } from "./viewport-jump.ts";
import { useHistoryStartPagination } from "./viewport-pagination.ts";
import { useRemeasure } from "./viewport-remeasure.ts";

export type { ViewportHandle } from "./viewport-jump.ts";

const HISTORY_START_SLOT_HEIGHT_PX = 32;
const CONTENT_PADDING_TOP_PX = 16;
const SCROLLBAR_MIN_THUMB = 36;
const NATIVE_PINNED_SLACK = 40;

function OverlayScrollbar({ theme, containerRef, onUserScrollUp }: { theme: PluginTheme; containerRef: { current: HTMLElement | null }; onUserScrollUp: () => void }) {
  const [metrics, setMetrics] = useState({ offset: 0, viewport: 0, content: 0 });
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const drag = useRef({ startY: 0, startOffset: 0, last: 0, reported: false });
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const sync = () => setMetrics({ offset: Math.max(0, container.scrollTop), viewport: Math.max(0, container.clientHeight), content: Math.max(0, container.scrollHeight) });
    sync();
    container.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(container);
    if (container.firstElementChild) observer.observe(container.firstElementChild);
    return () => {
      container.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, [containerRef]);
  const maxScroll = Math.max(0, metrics.content - metrics.viewport);
  const visible = maxScroll > 0 && metrics.viewport > 0;
  const thumb = visible ? Math.min(metrics.viewport, Math.max(SCROLLBAR_MIN_THUMB, (metrics.viewport * metrics.viewport) / metrics.content)) : 0;
  const maxThumb = Math.max(0, metrics.viewport - thumb);
  const thumbOffset = visible ? (Math.min(maxScroll, Math.max(0, metrics.offset)) / maxScroll) * maxThumb : 0;
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      const container = containerRef.current;
      if (!container || maxThumb <= 0) return;
      const next = Math.min(maxScroll, Math.max(0, drag.current.startOffset + (event.clientY - drag.current.startY) * (maxScroll / maxThumb)));
      if (next < drag.current.last && !drag.current.reported) {
        drag.current.reported = true;
        onUserScrollUp();
      }
      drag.current.last = next;
      container.scrollTop = next;
    };
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging, maxScroll, maxThumb, containerRef, onUserScrollUp]);
  if (!visible) return null;
  return (
    <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: SCROLLBAR_SIZE, zIndex: 10, pointerEvents: "none" }}>
      <div
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          drag.current = { startY: event.clientY, startOffset: metrics.offset, last: metrics.offset, reported: false };
          setDragging(true);
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        style={{ position: "absolute", top: 0, right: -(12 - SCROLLBAR_SIZE) / 2, width: 12, height: thumb, transform: `translateY(${thumbOffset}px)`, display: "flex", alignItems: "center", justifyContent: "center", cursor: dragging ? "grabbing" : "grab", pointerEvents: "auto", touchAction: "none", userSelect: "none" }}
      >
        <div style={{ width: SCROLLBAR_SIZE - 4, height: "100%", borderRadius: 9999, backgroundColor: hovered || dragging ? theme.colors.foregroundMuted : hostColours(theme).foregroundExtraMuted, opacity: hovered || dragging ? 1 : 0.4 }} />
      </div>
    </div>
  );
}

export interface ViewportProps {
  theme: PluginTheme;
  streamKey: string;
  history: StreamLayoutItem[];
  liveHead: StreamLayoutItem[];
  renderRow: (layout: StreamLayoutItem) => ReactNode;
  auxiliary: ReactNode;
  empty: ReactNode;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  progressKey: string | null;
  onNearHistoryStart: () => Promise<boolean>;
  onNearBottomChange: (near: boolean) => void;
  onReadingPosition?: (itemId: string | null) => void;
  viewportRef: { current: ViewportHandle | null };
}

export function WebViewport(props: ViewportProps) {
  const { theme, streamKey, history, liveHead, renderRow, auxiliary, empty, hasOlder, isLoadingOlder, progressKey, onNearHistoryStart, onNearBottomChange, onReadingPosition, viewportRef } = props;
  const compact = useIsCompact();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);
  const lastScrollTop = useRef(0);
  const jump = useRef<ActiveJump | null>(null);
  const { readingAnchor, reconcileReading, reportReading } = useReadingAnchor({ onReadingPosition, containerRef, contentRef, followRef, lastScrollTop, jump });
  const { pagination, paginationRef, evaluate, rearm, scheduleSettle } = useHistoryStartPagination({ streamKey, history, liveHead, hasOlder, isLoadingOlder, progressKey, onNearHistoryStart, containerRef, followRef, jump, readingAnchor, reconcileReading });
  const { following, setFollow, stopFollowing, cancelStick, syncNearBottom, scheduleStick, forceStick } = useFollowBottom({ streamKey, history, liveHead, auxiliary, onNearBottomChange, containerRef, followRef, lastScrollTop, evaluate, rearm, reconcileReading });
  useRemeasure({ history, liveHead, hasOlder, isLoadingOlder, progressKey, containerRef, contentRef, followRef, paginationRef, reconcileReading, reportReading, evaluate, scheduleSettle, syncNearBottom, scheduleStick });
  useScrollGestures({ containerRef, followRef, lastScrollTop, jump, readingAnchor, rearm, stopFollowing, setFollow, syncNearBottom, reportReading, evaluate });
  useMessageJump({ viewportRef, onNearBottomChange, containerRef, jump, lastScrollTop, forceStick, cancelStick, setFollow });

  const row = (layout: StreamLayoutItem) => (
    <div key={layout.item.id} {...historyRowAttributes(layout.item.id, getStreamItemMessageId(layout.item))} style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {renderRow(layout)}
    </div>
  );
  const loading = isHistoryStartLoadingOperation(pagination);
  const container: CSSProperties = { width: "100%", height: "100%", overflowX: "hidden", overflowY: "auto", overscrollBehaviorY: "contain", scrollbarWidth: compact ? undefined : "none", overflowAnchor: following ? "auto" : "none" };
  const contentStyle: CSSProperties = { display: "flex", flexDirection: "column", minHeight: "100%", paddingTop: CONTENT_PADDING_TOP_PX, paddingBottom: 16, paddingLeft: compact ? 8 : 16, paddingRight: compact ? 8 : 16, boxSizing: "border-box" };
  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0 }}>
      <div ref={containerRef} style={container}>
        <div ref={contentRef} style={contentStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: HISTORY_START_SLOT_HEIGHT_PX, flexShrink: 0 }}>{loading ? <ActivityIndicator size="small" color={theme.colors.foregroundMuted} /> : null}</div>
          {history.map(row)}
          {liveHead.map(row)}
          {auxiliary}
          {history.length === 0 && liveHead.length === 0 ? empty : null}
        </div>
      </div>
      {!compact ? <OverlayScrollbar theme={theme} containerRef={containerRef} onUserScrollUp={stopFollowing} /> : null}
    </div>
  );
}

export function NativeViewport(props: ViewportProps) {
  const { theme, streamKey, history, liveHead, renderRow, auxiliary, empty, hasOlder, isLoadingOlder, onNearHistoryStart, onNearBottomChange, viewportRef } = props;
  const scroll = useRef<NativeScrollView>(null);
  const pinned = useRef(true);
  useEffect(() => {
    pinned.current = true;
  }, [streamKey]);
  useEffect(() => {
    viewportRef.current = {
      scrollToBottom: () => {
        pinned.current = true;
        scroll.current?.scrollToEnd({ animated: false });
      },
      scrollToMessage: () => false,
    };
    return () => {
      viewportRef.current = null;
    };
  }, [viewportRef]);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const near = contentOffset.y + layoutMeasurement.height >= contentSize.height - NATIVE_PINNED_SLACK;
    pinned.current = near;
    onNearBottomChange(near);
    if (contentOffset.y <= 96 && hasOlder && !isLoadingOlder) void onNearHistoryStart();
  };
  return (
    <SheetScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingTop: CONTENT_PADDING_TOP_PX, paddingBottom: 16, paddingHorizontal: 8, flexGrow: 1 }} onScroll={onScroll} scrollEventThrottle={100} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" onContentSizeChange={() => pinned.current && scroll.current?.scrollToEnd({ animated: false })}>
      <View style={{ height: HISTORY_START_SLOT_HEIGHT_PX, alignItems: "center", justifyContent: "center" }}>{isLoadingOlder ? <ActivityIndicator size="small" color={theme.colors.foregroundMuted} /> : null}</View>
      {history.map((layout) => (
        <View key={layout.item.id}>{renderRow(layout)}</View>
      ))}
      {liveHead.map((layout) => (
        <View key={layout.item.id}>{renderRow(layout)}</View>
      ))}
      {auxiliary}
      {history.length === 0 && liveHead.length === 0 ? empty : null}
    </SheetScrollView>
  );
}
