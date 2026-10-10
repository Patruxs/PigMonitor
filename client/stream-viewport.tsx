import type { PluginTheme } from "@getpaseo/plugin";
import { ScrollView as SheetScrollView } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ActivityIndicator, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView as NativeScrollView } from "react-native";
import type { StreamLayoutItem } from "../shared/stream-layout.ts";
import { getStreamItemMessageId } from "../shared/stream-presentation.ts";
import {
  abandonHistoryStartPaginationRequest,
  createReadingAnchor,
  evaluateHistoryStartPagination,
  isHistoryStartLoadingOperation,
  rearmHistoryStartPagination,
  settleHistoryStartPagination,
  type HistoryStartPaginationInput,
  type HistoryStartPaginationState,
  type HistoryStartPaginationTransition,
} from "../shared/stream-scroll.ts";
import { hostColours } from "./kit/theme.ts";
import { useIsCompact } from "./message.tsx";

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64;
const AUTO_SCROLL_RESUME_THRESHOLD_PX = 1;
const USER_SCROLL_DELTA_EPSILON = 1;
const BOTTOM_OVERSCROLL_TOLERANCE_PX = 2;
const WEB_BOTTOM_SETTLE_TIMEOUT_MS = 200;
const HISTORY_START_SETTLE_FRAMES = 2;
const HISTORY_START_SLOT_HEIGHT_PX = 32;
const CONTENT_PADDING_TOP_PX = 16;
const UPWARD_INPUT_EVIDENCE_TIMEOUT_MS = 100;
const SCROLLBAR_SIZE = 8;
const SCROLLBAR_MIN_THUMB = 36;
const PROMPT_JUMP_TOP_INSET_PX = 8;
const PROMPT_JUMP_TOLERANCE_PX = 1;
const PROMPT_JUMP_STABLE_FRAMES = 2;
const PROMPT_JUMP_FRAME_BUDGET = 24;
const SCROLL_AFFECTING_KEYS = new Set(["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "]);
const NATIVE_PINNED_SLACK = 40;

export interface ScrollOccurrence {
  signal: AbortSignal;
  targetTop: () => number | null;
}

export interface ViewportHandle {
  scrollToBottom: () => void;
  scrollToMessage: (messageId: string, occurrence?: ScrollOccurrence) => boolean;
}

function isNearBottom(element: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">, threshold = AUTO_SCROLL_BOTTOM_THRESHOLD_PX): boolean {
  const { scrollTop, clientHeight, scrollHeight } = element;
  if (![scrollTop, clientHeight, scrollHeight].every(Number.isFinite)) return true;
  return scrollHeight - clientHeight - scrollTop <= Math.max(0, threshold);
}

function isMeasurable(element: Pick<HTMLElement, "clientHeight" | "scrollHeight">): boolean {
  return element.clientHeight > 0 && element.scrollHeight > 0;
}

function isOverscrolledPastBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.clientHeight - element.scrollTop < -BOTTOM_OVERSCROLL_TOLERANCE_PX;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const root = target.closest("input, textarea, [contenteditable]");
  if (!root) return false;
  const tag = root.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") return true;
  return root.getAttribute("contenteditable")?.toLowerCase() !== "false";
}

function nestedScrollerConsumesUp(target: EventTarget | null, container: HTMLElement): boolean {
  let element = target instanceof Element ? target : null;
  while (element && element !== container) {
    if (element instanceof HTMLElement) {
      const overflowY = window.getComputedStyle(element).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && element.scrollHeight > element.clientHeight && element.scrollTop > 0) return true;
    }
    element = element.parentElement;
  }
  return false;
}

function isScrollbarGutterPress(event: PointerEvent, container: HTMLElement): boolean {
  if (event.target !== container || container.scrollHeight <= container.clientHeight) return false;
  const width = Math.max(container.offsetWidth - container.clientWidth, SCROLLBAR_SIZE);
  const bounds = container.getBoundingClientRect();
  return window.getComputedStyle(container).direction === "rtl" ? event.clientX <= bounds.left + width : event.clientX >= bounds.right - width;
}

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
  const gesture = useRef<{ kind: "scrollbar"; pointerId: number } | { kind: "autoscroll"; pointerId: number; lastY: number; upward: boolean } | null>(null);
  const upwardUntil = useRef(0);
  const lastTouchY = useRef<number | null>(null);
  const pendingFrame = useRef<number | null>(null);
  const readyRef = useRef(false);
  const [pagination, setPagination] = useState<HistoryStartPaginationState>({ status: "dormant" });
  const paginationRef = useRef(pagination);
  const readingAnchor = useMemo(createReadingAnchor, []);
  const [following, setFollowing] = useState(true);
  const settleFrame = useRef<number | null>(null);
  const jump = useRef<{ messageId: string; frame: number | null; sampled: number; stable: number; unsubscribe: () => void } | null>(null);
  const live = useRef({ hasOlder, isLoadingOlder, progressKey, onNearHistoryStart, history, liveHead });
  live.current = { hasOlder, isLoadingOlder, progressKey, onNearHistoryStart, history, liveHead };

  const paginationInput = useCallback((): HistoryStartPaginationInput | null => {
    const container = containerRef.current;
    if (!container || !isMeasurable(container)) return null;
    return { distanceFromHistoryStart: container.scrollTop, hasOlderHistory: live.current.hasOlder, isLoadingOlderHistory: live.current.isLoadingOlder, isReady: readyRef.current && (!followRef.current || isNearBottom(container)) && jump.current === null, progressKey: live.current.progressKey };
  }, []);

  const applyTransition = useCallback((transition: HistoryStartPaginationTransition) => {
    const previous = paginationRef.current;
    paginationRef.current = transition.state;
    if (transition.state !== previous) setPagination(transition.state);
    const key = live.current.progressKey;
    if (!transition.shouldLoad || key === null) return;
    void (async () => {
      const started = await live.current.onNearHistoryStart();
      if (started) return;
      applyTransition({ state: abandonHistoryStartPaginationRequest(paginationRef.current, key), shouldLoad: false });
    })();
  }, []);

  const evaluate = useCallback(() => {
    const input = paginationInput();
    if (input) applyTransition(evaluateHistoryStartPagination(paginationRef.current, input));
  }, [paginationInput, applyTransition]);

  const rearm = useCallback(() => {
    const next = rearmHistoryStartPagination(paginationRef.current);
    if (next === paginationRef.current) return;
    paginationRef.current = next;
    setPagination(next);
    evaluate();
  }, [evaluate]);

  const reconcileReading = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const viewportTop = container.getBoundingClientRect().top;
    const scrollTop = container.scrollTop;
    const rows = Array.from(content.querySelectorAll<HTMLElement>("[data-history-row-id]"), (element) => {
      const bounds = element.getBoundingClientRect();
      return { id: element.dataset.historyRowId as string, top: bounds.top - viewportTop + scrollTop, height: bounds.height };
    });
    const shouldAnchor = !followRef.current && jump.current === null;
    if (!shouldAnchor) readingAnchor.reset();
    const corrected = readingAnchor.reconcile(scrollTop, rows);
    if (!shouldAnchor) {
      readingAnchor.reset();
      return;
    }
    if (Math.abs(corrected - scrollTop) > 0.5) {
      container.scrollTop = corrected;
      lastScrollTop.current = container.scrollTop;
    }
  }, [readingAnchor]);

  const scheduleSettle = useCallback(() => {
    if (settleFrame.current !== null) return;
    let remaining = HISTORY_START_SETTLE_FRAMES;
    const tick = () => {
      reconcileReading();
      if (paginationRef.current.status !== "settling") {
        settleFrame.current = null;
        return;
      }
      const input = paginationInput();
      const loading = !input || input.isLoadingOlderHistory;
      if (loading || remaining > 0) {
        if (!loading) remaining -= 1;
        settleFrame.current = window.requestAnimationFrame(tick);
        return;
      }
      settleFrame.current = null;
      if (!input) return;
      applyTransition(settleHistoryStartPagination(paginationRef.current, input));
    };
    settleFrame.current = window.requestAnimationFrame(tick);
  }, [reconcileReading, paginationInput, applyTransition]);

  const cancelStick = useCallback(() => {
    if (pendingFrame.current !== null) window.cancelAnimationFrame(pendingFrame.current);
    pendingFrame.current = null;
  }, []);

  const syncNearBottom = useCallback(() => {
    const container = containerRef.current;
    onNearBottomChange(container ? isNearBottom(container) : true);
  }, [onNearBottomChange]);

  const reportReading = useCallback(() => {
    if (!onReadingPosition) return;
    const container = containerRef.current;
    if (!container) return onReadingPosition(null);
    onReadingPosition(readingAnchor.getReadingRowId(container.scrollTop));
  }, [onReadingPosition, readingAnchor]);

  const scrollToBottomNow = useCallback(() => {
    const container = containerRef.current;
    if (!container || !isMeasurable(container) || isOverscrolledPastBottom(container)) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
    lastScrollTop.current = container.scrollTop;
    syncNearBottom();
    evaluate();
  }, [syncNearBottom, evaluate]);

  const scheduleStick = useCallback(() => {
    const container = containerRef.current;
    if ((container && isOverscrolledPastBottom(container)) || pendingFrame.current !== null) return;
    pendingFrame.current = window.requestAnimationFrame(() => {
      pendingFrame.current = null;
      if (followRef.current) scrollToBottomNow();
    });
  }, [scrollToBottomNow]);

  const forceStick = useCallback(() => {
    cancelStick();
    scrollToBottomNow();
    scheduleStick();
  }, [cancelStick, scrollToBottomNow, scheduleStick]);

  const findMessageTop = useCallback((messageId: string): number | null => {
    const container = containerRef.current;
    return container?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)?.getBoundingClientRect().top ?? null;
  }, []);

  const finishJump = useCallback(() => {
    const current = jump.current;
    if (!current) return;
    if (current.frame !== null) window.cancelAnimationFrame(current.frame);
    current.unsubscribe();
    jump.current = null;
  }, []);

  const startJump = useCallback(
    (messageId: string, occurrence?: ScrollOccurrence) => {
      finishJump();
      const container = containerRef.current;
      if (!container) return;
      const onKey = (event: KeyboardEvent) => {
        if (SCROLL_AFFECTING_KEYS.has(event.key)) finishJump();
      };
      container.addEventListener("wheel", finishJump, { passive: true });
      container.addEventListener("touchstart", finishJump, { passive: true });
      container.addEventListener("keydown", onKey, { passive: true });
      const state = { messageId, frame: null as number | null, sampled: 0, stable: 0, unsubscribe: () => {
        container.removeEventListener("wheel", finishJump);
        container.removeEventListener("touchstart", finishJump);
        container.removeEventListener("keydown", onKey);
      } };
      jump.current = state;
      occurrence?.signal.addEventListener("abort", finishJump, { once: true });
      const tick = () => {
        state.frame = null;
        if (jump.current !== state) return;
        state.sampled += 1;
        const top = occurrence ? occurrence.targetTop() : findMessageTop(messageId);
        if (top !== null) {
          const delta = top - container.getBoundingClientRect().top - PROMPT_JUMP_TOP_INSET_PX;
          if (Math.abs(delta) <= PROMPT_JUMP_TOLERANCE_PX) {
            state.stable += 1;
            if (state.stable >= PROMPT_JUMP_STABLE_FRAMES) return finishJump();
          } else {
            state.stable = 0;
            container.scrollTop += delta;
            lastScrollTop.current = container.scrollTop;
            const after = occurrence ? occurrence.targetTop() : findMessageTop(messageId);
            const remaining = after === null ? 0 : after - container.getBoundingClientRect().top - PROMPT_JUMP_TOP_INSET_PX;
            if (remaining > PROMPT_JUMP_TOLERANCE_PX && container.scrollTop >= Math.max(0, container.scrollHeight - container.clientHeight) - PROMPT_JUMP_TOLERANCE_PX) return finishJump();
          }
        }
        if (state.sampled >= PROMPT_JUMP_FRAME_BUDGET) return finishJump();
        state.frame = window.requestAnimationFrame(tick);
      };
      state.frame = window.requestAnimationFrame(tick);
    },
    [finishJump, findMessageTop],
  );

  const setFollow = useCallback((value: boolean) => {
    followRef.current = value;
    setFollowing(value);
  }, []);

  const stopFollowing = useCallback(() => {
    cancelStick();
    setFollow(false);
    rearm();
  }, [cancelStick, rearm, setFollow]);

  useEffect(() => {
    paginationRef.current = { status: "dormant" };
    setPagination({ status: "dormant" });
    readingAnchor.reset();
    const frame = window.requestAnimationFrame(() => {
      readyRef.current = true;
      evaluate();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      readyRef.current = false;
      if (settleFrame.current !== null) window.cancelAnimationFrame(settleFrame.current);
      settleFrame.current = null;
    };
  }, [streamKey, evaluate, readingAnchor]);

  useLayoutEffect(() => {
    setFollow(true);
    forceStick();
    const timeout = window.setTimeout(() => {
      const container = containerRef.current;
      if (followRef.current && container && !isNearBottom(container)) scheduleStick();
    }, WEB_BOTTOM_SETTLE_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [streamKey, forceStick, scheduleStick, setFollow]);

  useLayoutEffect(() => {
    reconcileReading();
  }, [history, liveHead, auxiliary, reconcileReading]);

  useLayoutEffect(() => {
    if (!followRef.current) return;
    cancelStick();
    scrollToBottomNow();
  }, [history, liveHead, auxiliary, cancelStick, scrollToBottomNow]);

  useEffect(() => {
    syncNearBottom();
    reportReading();
    evaluate();
    if (paginationRef.current.status === "settling") scheduleSettle();
  }, [hasOlder, isLoadingOlder, progressKey, history.length, liveHead.length, syncNearBottom, reportReading, evaluate, scheduleSettle]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      reconcileReading();
      if (paginationRef.current.status === "settling") scheduleSettle();
      syncNearBottom();
      reportReading();
      evaluate();
      if (followRef.current) scheduleStick();
    });
    observer.observe(container);
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [reconcileReading, scheduleSettle, syncNearBottom, reportReading, evaluate, scheduleStick]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const markUpward = () => {
      upwardUntil.current = window.performance.now() + UPWARD_INPUT_EVIDENCE_TIMEOUT_MS;
      if (container.scrollTop <= USER_SCROLL_DELTA_EPSILON) rearm();
    };
    const onScroll = () => {
      if (!isMeasurable(container)) return;
      const top = container.scrollTop;
      const atBottom = isNearBottom(container, AUTO_SCROLL_RESUME_THRESHOLD_PX);
      const up = top < lastScrollTop.current - USER_SCROLL_DELTA_EPSILON;
      const down = top > lastScrollTop.current + USER_SCROLL_DELTA_EPSILON;
      const current = gesture.current;
      const upwardEvidence = current?.kind === "scrollbar" || (current?.kind === "autoscroll" && current.upward) || window.performance.now() < upwardUntil.current;
      if (!followRef.current && atBottom && down && jump.current === null) setFollow(true);
      else if (followRef.current && up && upwardEvidence) stopFollowing();
      if (!followRef.current && jump.current === null && (up || down)) readingAnchor.scroll(top);
      lastScrollTop.current = top;
      syncNearBottom();
      reportReading();
      evaluate();
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && event.deltaY < 0 && !nestedScrollerConsumesUp(event.target, container)) markUpward();
    };
    const onKey = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (!(event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home" || (event.key === " " && event.shiftKey))) return;
      if (!nestedScrollerConsumesUp(event.target, container)) markUpward();
    };
    const onPointerDown = (event: PointerEvent) => {
      gesture.current = null;
      if (event.pointerType !== "mouse" || !event.isPrimary || (event.button !== 0 && event.button !== 1) || isEditableTarget(event.target)) return;
      if (event.button === 0) {
        if (isScrollbarGutterPress(event, container)) gesture.current = { kind: "scrollbar", pointerId: event.pointerId };
        return;
      }
      gesture.current = { kind: "autoscroll", pointerId: event.pointerId, lastY: event.clientY, upward: false };
    };
    const onPointerMove = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || current.kind !== "autoscroll" || current.pointerId !== event.pointerId) return;
      if (event.clientY < current.lastY - USER_SCROLL_DELTA_EPSILON) current.upward = true;
      current.lastY = event.clientY;
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (gesture.current?.pointerId === event.pointerId) gesture.current = null;
    };
    const onTouchStart = (event: TouchEvent) => {
      lastTouchY.current = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      if (lastTouchY.current !== null && touch.clientY > lastTouchY.current + 1 && !nestedScrollerConsumesUp(event.target, container)) markUpward();
      lastTouchY.current = touch.clientY;
    };
    const onTouchEnd = () => {
      lastTouchY.current = null;
    };
    const clearGesture = () => {
      gesture.current = null;
    };
    container.addEventListener("scroll", onScroll, { passive: true, capture: true });
    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("keydown", onKey, { passive: true });
    container.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", onPointerEnd, { passive: true });
    window.addEventListener("blur", clearGesture);
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    container.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll, true);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("keydown", onKey);
      container.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("blur", clearGesture);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [rearm, stopFollowing, syncNearBottom, reportReading, evaluate, setFollow, readingAnchor]);

  useEffect(() => {
    viewportRef.current = {
      scrollToBottom: () => {
        setFollow(true);
        forceStick();
      },
      scrollToMessage: (messageId, occurrence) => {
        const container = containerRef.current;
        const top = (occurrence ? occurrence.targetTop() : null) ?? findMessageTop(messageId);
        if (!container || top === null) return false;
        cancelStick();
        setFollow(false);
        container.scrollTop += top - container.getBoundingClientRect().top - PROMPT_JUMP_TOP_INSET_PX;
        lastScrollTop.current = container.scrollTop;
        startJump(messageId, occurrence);
        onNearBottomChange(false);
        return true;
      },
    };
    return () => {
      viewportRef.current = null;
      cancelStick();
      finishJump();
    };
  }, [viewportRef, forceStick, cancelStick, findMessageTop, startJump, finishJump, onNearBottomChange, setFollow]);

  const row = (layout: StreamLayoutItem) => (
    <div key={layout.item.id} data-history-row-id={layout.item.id} data-message-id={getStreamItemMessageId(layout.item)} style={{ display: "flex", flexDirection: "column", width: "100%" }}>
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
