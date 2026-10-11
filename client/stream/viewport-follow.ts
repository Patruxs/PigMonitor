import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { StreamLayoutItem } from "./stream-layout.ts";
import { isMeasurable, isNearBottom, isOverscrolledPastBottom } from "./viewport-geometry.ts";

const WEB_BOTTOM_SETTLE_TIMEOUT_MS = 200;

export function useFollowBottom({ streamKey, history, liveHead, auxiliary, onNearBottomChange, containerRef, followRef, lastScrollTop, evaluate, rearm, reconcileReading }: { streamKey: string; history: StreamLayoutItem[]; liveHead: StreamLayoutItem[]; auxiliary: ReactNode; onNearBottomChange: (near: boolean) => void; containerRef: RefObject<HTMLDivElement | null>; followRef: RefObject<boolean>; lastScrollTop: RefObject<number>; evaluate: () => void; rearm: () => void; reconcileReading: () => void }) {
  const pendingFrame = useRef<number | null>(null);
  const [following, setFollowing] = useState(true);

  const cancelStick = useCallback(() => {
    if (pendingFrame.current !== null) window.cancelAnimationFrame(pendingFrame.current);
    pendingFrame.current = null;
  }, []);

  const syncNearBottom = useCallback(() => {
    const container = containerRef.current;
    onNearBottomChange(container ? isNearBottom(container) : true);
  }, [onNearBottomChange]);

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

  const setFollow = useCallback((value: boolean) => {
    followRef.current = value;
    setFollowing(value);
  }, []);

  const stopFollowing = useCallback(() => {
    cancelStick();
    setFollow(false);
    rearm();
  }, [cancelStick, rearm, setFollow]);

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

  return { following, setFollow, stopFollowing, cancelStick, syncNearBottom, scheduleStick, forceStick };
}
