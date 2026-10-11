import { useCallback, useMemo, type RefObject } from "react";
import { createReadingAnchor } from "./stream-scroll.ts";
import { historyRows } from "./find-anchors.ts";
import type { ActiveJump } from "./viewport-jump.ts";

export type ReadingAnchor = ReturnType<typeof createReadingAnchor>;

export function useReadingAnchor({ onReadingPosition, containerRef, contentRef, followRef, lastScrollTop, jump }: { onReadingPosition?: (itemId: string | null) => void; containerRef: RefObject<HTMLDivElement | null>; contentRef: RefObject<HTMLDivElement | null>; followRef: RefObject<boolean>; lastScrollTop: RefObject<number>; jump: RefObject<ActiveJump | null> }) {
  const readingAnchor = useMemo(createReadingAnchor, []);

  const reconcileReading = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const viewportTop = container.getBoundingClientRect().top;
    const scrollTop = container.scrollTop;
    const rows = historyRows(content).map(({ id, element }) => {
      const bounds = element.getBoundingClientRect();
      return { id, top: bounds.top - viewportTop + scrollTop, height: bounds.height };
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

  const reportReading = useCallback(() => {
    if (!onReadingPosition) return;
    const container = containerRef.current;
    if (!container) return onReadingPosition(null);
    onReadingPosition(readingAnchor.getReadingRowId(container.scrollTop));
  }, [onReadingPosition, readingAnchor]);

  return { readingAnchor, reconcileReading, reportReading };
}
