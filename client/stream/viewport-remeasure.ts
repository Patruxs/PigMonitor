import { useEffect, useLayoutEffect, type RefObject } from "react";
import type { StreamLayoutItem } from "./stream-layout.ts";
import type { HistoryStartPaginationState } from "./stream-scroll.ts";

export function useRemeasure({ history, liveHead, hasOlder, isLoadingOlder, progressKey, containerRef, contentRef, followRef, paginationRef, reconcileReading, reportReading, evaluate, scheduleSettle, syncNearBottom, scheduleStick }: { history: StreamLayoutItem[]; liveHead: StreamLayoutItem[]; hasOlder: boolean; isLoadingOlder: boolean; progressKey: string | null; containerRef: RefObject<HTMLDivElement | null>; contentRef: RefObject<HTMLDivElement | null>; followRef: RefObject<boolean>; paginationRef: RefObject<HistoryStartPaginationState>; reconcileReading: () => void; reportReading: () => void; evaluate: () => void; scheduleSettle: () => void; syncNearBottom: () => void; scheduleStick: () => void }): void {
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
}
