import type { DictationStatus } from "../../shared/chat/speech.ts";

export type ComposerFocus = "input" | "pane" | "outside";
export type ComposerKeyAction = "focus-input" | "interrupt" | "dictation-cancel" | "dictation-toggle" | "dictation-send" | "mode-cycle";

export function resolveComposerKey(input: { key: string; primary: boolean; shift: boolean; alt: boolean; focus: ComposerFocus; dictation: DictationStatus; isAgentRunning: boolean; isCancelling: boolean; canCycleMode: boolean }): ComposerKeyAction | null {
  if (input.focus === "outside") return null;
  const key = input.key.toLowerCase();
  const plain = !input.primary && !input.alt;
  const chord = input.primary && !input.alt && !input.shift;
  if (key === "escape" && plain && !input.shift) {
    if (input.dictation !== "idle") return "dictation-cancel";
    return input.isAgentRunning && !input.isCancelling ? "interrupt" : null;
  }
  if (key === "enter" && plain && !input.shift && input.dictation === "recording") return "dictation-send";
  if (chord && key === "d") return "dictation-toggle";
  if (chord && key === "l") return "focus-input";
  if (key === "tab" && plain && input.shift && input.focus === "input" && input.canCycleMode) return "mode-cycle";
  return null;
}
