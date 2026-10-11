import { useCallback, useEffect, useState, type RefObject } from "react";
import type { TextInput } from "react-native";
import { nodeOf } from "./composer-height.ts";
import { isWeb } from "../kit/platform.ts";

const dom = globalThis as { document?: Document; window?: Window; navigator?: Navigator };

function focusWithRetries(focus: () => void, isFocused: () => boolean, deferInitialAttempt: boolean): () => void {
  let cancelled = false;
  const deadline = Date.now() + 1500;
  const tick = () => {
    if (cancelled) return;
    focus();
    if (isFocused() || Date.now() >= deadline) return;
    requestAnimationFrame(() => requestAnimationFrame(tick));
  };
  if (deferInitialAttempt) requestAnimationFrame(tick);
  else tick();
  return () => {
    cancelled = true;
  };
}

export function useComposerFocus(input: RefObject<TextInput | null>) {
  const [isInputFocused, setIsInputFocused] = useState(false);

  const focusInput = useCallback(() => {
    if (!isWeb) return;
    focusWithRetries(
      () => input.current?.focus(),
      () => nodeOf(input) !== null && dom.document?.activeElement === nodeOf(input),
      false,
    );
  }, []);

  return { isInputFocused, setIsInputFocused, focusInput };
}

export function useInitialFocus(input: RefObject<TextInput | null>, isCompactFormFactor: boolean): void {
  useEffect(() => {
    const hasFinePointer = dom.window?.matchMedia?.("(pointer: fine)").matches ?? false;
    if (!isWeb || isCompactFormFactor || !hasFinePointer) return;
    return focusWithRetries(
      () => input.current?.focus(),
      () => nodeOf(input) !== null && dom.document?.activeElement === nodeOf(input),
      true,
    );
  }, []);
}
