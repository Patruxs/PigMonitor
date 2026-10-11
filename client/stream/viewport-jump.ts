import { useCallback, useEffect, type RefObject } from "react";
import { messageRows } from "./find-anchors.ts";

const PROMPT_JUMP_TOP_INSET_PX = 8;
const PROMPT_JUMP_TOLERANCE_PX = 1;
const PROMPT_JUMP_STABLE_FRAMES = 2;
const PROMPT_JUMP_FRAME_BUDGET = 24;
const SCROLL_AFFECTING_KEYS = new Set(["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "]);

interface ScrollOccurrence {
  signal: AbortSignal;
  targetTop: () => number | null;
}

export interface ViewportHandle {
  scrollToBottom: () => void;
  scrollToMessage: (messageId: string, occurrence?: ScrollOccurrence) => boolean;
}

export interface ActiveJump {
  messageId: string;
  frame: number | null;
  sampled: number;
  stable: number;
  unsubscribe: () => void;
}

export function useMessageJump({ viewportRef, onNearBottomChange, containerRef, jump, lastScrollTop, forceStick, cancelStick, setFollow }: { viewportRef: { current: ViewportHandle | null }; onNearBottomChange: (near: boolean) => void; containerRef: RefObject<HTMLDivElement | null>; jump: RefObject<ActiveJump | null>; lastScrollTop: RefObject<number>; forceStick: () => void; cancelStick: () => void; setFollow: (value: boolean) => void }): void {
  const findMessageTop = useCallback((messageId: string): number | null => {
    const container = containerRef.current;
    return messageRows(container, messageId)[0]?.getBoundingClientRect().top ?? null;
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
}
