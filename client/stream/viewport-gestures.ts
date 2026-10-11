import { useLayoutEffect, useRef, type RefObject } from "react";
import type { ReadingAnchor } from "./viewport-anchor.ts";
import { isMeasurable, isNearBottom, SCROLLBAR_SIZE } from "./viewport-geometry.ts";
import type { ActiveJump } from "./viewport-jump.ts";

const AUTO_SCROLL_RESUME_THRESHOLD_PX = 1;
const USER_SCROLL_DELTA_EPSILON = 1;
const UPWARD_INPUT_EVIDENCE_TIMEOUT_MS = 100;

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

export function useScrollGestures({ containerRef, followRef, lastScrollTop, jump, readingAnchor, rearm, stopFollowing, setFollow, syncNearBottom, reportReading, evaluate }: { containerRef: RefObject<HTMLDivElement | null>; followRef: RefObject<boolean>; lastScrollTop: RefObject<number>; jump: RefObject<ActiveJump | null>; readingAnchor: ReadingAnchor; rearm: () => void; stopFollowing: () => void; setFollow: (value: boolean) => void; syncNearBottom: () => void; reportReading: () => void; evaluate: () => void }): void {
  const gesture = useRef<{ kind: "scrollbar"; pointerId: number } | { kind: "autoscroll"; pointerId: number; lastY: number; upward: boolean } | null>(null);
  const upwardUntil = useRef(0);
  const lastTouchY = useRef<number | null>(null);

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
}
