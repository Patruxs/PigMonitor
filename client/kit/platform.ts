import { Platform, useWindowDimensions, type TextStyle } from "react-native";
import { COMPACT_BELOW } from "./theme.ts";

export const isWeb = Platform.OS === "web";

export const isIos = Platform.OS === "ios";

export const NO_OUTLINE = (isWeb ? { outlineStyle: "none", outlineWidth: 0, outlineColor: "transparent" } : {}) as TextStyle;

export const dom = globalThis as { window?: Window; document?: Document };

export function useCompact(): boolean {
  return useWindowDimensions().width < COMPACT_BELOW;
}
