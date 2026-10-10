import { Platform, useWindowDimensions } from "react-native";
import { COMPACT_BELOW } from "./theme.ts";

export const isWeb = Platform.OS === "web";

export const isIos = Platform.OS === "ios";

export const dom = globalThis as { window?: Window; document?: Document };

export function useCompact(): boolean {
  return useWindowDimensions().width < COMPACT_BELOW;
}
