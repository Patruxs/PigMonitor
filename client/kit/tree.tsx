import type { PluginTheme } from "@getpaseo/plugin";
import { View } from "react-native";
import { tint } from "./chat.tsx";
import { SPACING } from "./theme.ts";

export const TREE_STEP = 18;
const TREE_INK = "77";
const RAIL_INSET = 6;

export interface TreeSpot {
  depth: number;
  firstChild: boolean;
  lastSibling: boolean;
}

export function treeSpotsOf(depths: number[]): TreeSpot[] {
  const shown: number[] = [];
  for (const depth of depths) shown.push(Math.min(depth, shown.length === 0 ? 0 : shown[shown.length - 1] + 1));
  return shown.map((depth, i) => {
    const later = shown.slice(i + 1);
    const nextAtOrAbove = later.find((d) => d <= depth);
    return { depth, firstChild: depth > 0 && shown[i - 1] < depth, lastSibling: nextAtOrAbove === undefined || nextAtOrAbove < depth };
  });
}

export function treeIndent(depth: number): number {
  return SPACING[3] + depth * TREE_STEP;
}

export function TreeGuides({ theme, spot, colour, reach }: { theme: PluginTheme; spot: TreeSpot; colour: string; reach: number }) {
  if (spot.depth === 0) return null;
  const x = SPACING[3] + (spot.depth - 1) * TREE_STEP + RAIL_INSET;
  const top = spot.firstChild ? -reach : 0;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: x + TREE_STEP }}>
      {Array.from({ length: spot.depth - 1 }, (_, i) => (
        <View key={i} style={{ position: "absolute", left: SPACING[3] + i * TREE_STEP + RAIL_INSET, top: 0, bottom: 0, width: 1, backgroundColor: tint(theme.colors.foregroundMuted, "44") }} />
      ))}
      <View style={{ position: "absolute", left: x, top, bottom: spot.lastSibling ? "50%" : 0, width: 2, borderRadius: 1, backgroundColor: tint(colour, TREE_INK) }} />
      <View style={{ position: "absolute", left: x, top: "50%", marginTop: -1, width: TREE_STEP - 4, height: 2, borderRadius: 1, backgroundColor: tint(colour, TREE_INK) }} />
    </View>
  );
}
