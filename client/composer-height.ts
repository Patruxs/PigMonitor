import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MIN_INPUT_HEIGHT } from "../shared/composer.ts";

const dom = globalThis as { document?: Document; window?: Window };
const isWeb = dom.document !== undefined;
const MIRRORED_STYLES = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "lineHeight", "letterSpacing", "wordSpacing", "textTransform", "textIndent", "whiteSpace", "wordWrap", "overflowWrap", "wordBreak", "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const;

export function nodeOf(ref: { current: unknown }): HTMLElement | null {
  const node = ref.current as HTMLElement | null;
  return node && typeof node.addEventListener === "function" ? node : null;
}

export function useComposerHeight(textareaRef: { current: unknown }, value: string, maxHeight: number): { height: number | undefined; scrollEnabled: boolean; reset: () => void } {
  const [height, setHeight] = useState(MIN_INPUT_HEIGHT);
  const mirrorRef = useRef<HTMLTextAreaElement | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const measure = useCallback(
    (next: string) => {
      const mirror = mirrorRef.current;
      const source = nodeOf(textareaRef);
      const win = dom.window;
      if (!mirror || !source || !win || source.clientWidth <= 0) return;
      const computed = win.getComputedStyle(source);
      for (const property of MIRRORED_STYLES) mirror.style[property] = computed[property];
      mirror.style.width = `${source.clientWidth}px`;
      mirror.value = next.endsWith("\n") ? `${next} ` : next;
      const bounded = Math.max(MIN_INPUT_HEIGHT, Math.min(maxHeight, mirror.scrollHeight));
      setHeight((had) => (Math.abs(had - bounded) < 1 ? had : bounded));
    },
    [maxHeight, textareaRef],
  );
  useEffect(() => {
    const doc = dom.document;
    if (!doc) return;
    const mirror = doc.createElement("textarea");
    mirror.setAttribute("aria-hidden", "true");
    mirror.setAttribute("tabindex", "-1");
    mirror.readOnly = true;
    mirror.rows = 1;
    Object.assign(mirror.style, { position: "absolute", top: "0", left: "0", visibility: "hidden", pointerEvents: "none", overflow: "hidden", border: "0", margin: "0", resize: "none", zIndex: "-1", boxSizing: "border-box" });
    doc.body.appendChild(mirror);
    mirrorRef.current = mirror;
    measure(valueRef.current);
    return () => {
      mirror.remove();
      mirrorRef.current = null;
    };
  }, [measure]);
  useLayoutEffect(() => measure(value), [value, measure]);
  useEffect(() => {
    const source = nodeOf(textareaRef);
    if (!source || typeof ResizeObserver === "undefined") return;
    let previousWidth = source.clientWidth;
    const observer = new ResizeObserver(() => {
      if (Math.abs(source.clientWidth - previousWidth) < 1) return;
      previousWidth = source.clientWidth;
      measure(valueRef.current);
    });
    observer.observe(source);
    return () => observer.disconnect();
  }, [measure, textareaRef]);
  if (!isWeb) return { height: undefined, scrollEnabled: true, reset: () => undefined };
  return { height, scrollEnabled: height >= maxHeight, reset: () => setHeight(MIN_INPUT_HEIGHT) };
}
