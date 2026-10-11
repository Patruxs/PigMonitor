import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { StreamLayoutItem } from "./stream-layout.ts";
import {
  abandonHistoryStartPaginationRequest,
  evaluateHistoryStartPagination,
  rearmHistoryStartPagination,
  settleHistoryStartPagination,
  type HistoryStartPaginationInput,
  type HistoryStartPaginationState,
  type HistoryStartPaginationTransition,
} from "./stream-scroll.ts";
import type { ReadingAnchor } from "./viewport-anchor.ts";
import { isMeasurable, isNearBottom } from "./viewport-geometry.ts";
import type { ActiveJump } from "./viewport-jump.ts";

const HISTORY_START_SETTLE_FRAMES = 2;

export function useHistoryStartPagination({ streamKey, history, liveHead, hasOlder, isLoadingOlder, progressKey, onNearHistoryStart, containerRef, followRef, jump, readingAnchor, reconcileReading }: { streamKey: string; history: StreamLayoutItem[]; liveHead: StreamLayoutItem[]; hasOlder: boolean; isLoadingOlder: boolean; progressKey: string | null; onNearHistoryStart: () => Promise<boolean>; containerRef: RefObject<HTMLDivElement | null>; followRef: RefObject<boolean>; jump: RefObject<ActiveJump | null>; readingAnchor: ReadingAnchor; reconcileReading: () => void }) {
  const readyRef = useRef(false);
  const [pagination, setPagination] = useState<HistoryStartPaginationState>({ status: "dormant" });
  const paginationRef = useRef(pagination);
  const settleFrame = useRef<number | null>(null);
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

  return { pagination, paginationRef, evaluate, rearm, scheduleSettle };
}
