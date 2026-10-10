import { useWindowDimensions } from "react-native";
import { COMPACT_BELOW } from "./theme.ts";

export function useCompact(): boolean {
  return useWindowDimensions().width < COMPACT_BELOW;
}
