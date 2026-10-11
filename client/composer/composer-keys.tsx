import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { resolveComposerKey, type ComposerFocus, type ComposerKeyAction } from "./composer-input.ts";
import type { DictationStatus } from "../../shared/chat/speech.ts";
import { useChatPaneArea } from "../chat/chat-pane-scope.tsx";
import { nodeOf } from "./composer-height.ts";
import { dom, isMac } from "../kit/platform.ts";

type KeyChord = { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };


export const FOCUS_HINT = isMac ? "⌘L to focus" : "Ctrl+L to focus";

type ModeCycleSlot = { current: (() => void) | null };

const ModeCycle = createContext<ModeCycleSlot | null>(null);

export function ModeCycleScope({ slot, children }: { slot: ModeCycleSlot; children: ReactNode }) {
  return <ModeCycle.Provider value={slot}>{children}</ModeCycle.Provider>;
}

export function useRegisterModeCycle(cycle: (() => void) | null): void {
  const slot = useContext(ModeCycle);
  const latest = useRef(cycle);
  latest.current = cycle;
  const present = cycle !== null;
  useEffect(() => {
    if (!slot || !present) return;
    const run = () => latest.current?.();
    slot.current = run;
    return () => {
      if (slot.current === run) slot.current = null;
    };
  }, [slot, present]);
}

interface ComposerKeyState {
  dictation: DictationStatus;
  isAgentRunning: boolean;
  isCancelling: boolean;
}

export function useComposerKeys({ field, state, run }: { field: { current: unknown }; state: ComposerKeyState; run: (action: ComposerKeyAction) => void }): { modeCycle: ModeCycleSlot; inputKey: (chord: KeyChord) => ComposerKeyAction | null } {
  const modeCycle = useRef<(() => void) | null>(null);
  const paneArea = useChatPaneArea();
  const pane = useRef(paneArea);
  pane.current = paneArea;
  const keys = useRef({ state, run });
  keys.current = { state, run };
  const resolve = (chord: KeyChord, focus: ComposerFocus) => resolveComposerKey({ key: chord.key, primary: isMac ? chord.metaKey === true && chord.ctrlKey !== true : chord.ctrlKey === true && chord.metaKey !== true, shift: chord.shiftKey === true, alt: chord.altKey === true, focus, ...keys.current.state, canCycleMode: modeCycle.current !== null });
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  useEffect(() => {
    const doc = dom.document;
    if (!doc) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const input = nodeOf(field);
      if (input !== null && event.target === input) return;
      const focus: ComposerFocus = event.target === doc.body || pane.current?.contains(event.target) ? "pane" : "outside";
      const action = resolveRef.current(event, focus);
      if (!action) return;
      if (action !== "interrupt") event.preventDefault();
      keys.current.run(action);
    };
    doc.addEventListener("keydown", onKeyDown);
    return () => doc.removeEventListener("keydown", onKeyDown);
  }, []);
  return {
    modeCycle,
    inputKey: (chord) => {
      const action = resolve(chord, "input");
      if (action) run(action);
      return action;
    },
  };
}
