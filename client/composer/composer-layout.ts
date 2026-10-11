import { useState } from "react";
import { useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { resolveMaxInputHeight } from "./input-height.ts";
import { COMPACT_BELOW } from "../kit/theme.ts";

const COMPACT_FORM_FACTOR_WIDTH = 500;

export function useComposerLayout() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isCompactFormFactor = windowWidth < COMPACT_BELOW;
  const [isCompactLayout, setIsCompactLayout] = useState(isCompactFormFactor);
  const maxInputHeight = resolveMaxInputHeight(windowHeight);

  const onInputAreaLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (!Number.isFinite(width) || width <= 0) return;
    const below = width < COMPACT_FORM_FACTOR_WIDTH;
    setIsCompactLayout((was) => (was === below ? was : below));
  };

  return { isCompactFormFactor, isCompactLayout, maxInputHeight, onInputAreaLayout };
}
