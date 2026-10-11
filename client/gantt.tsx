import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import type { Piece } from "../shared/segments.ts";
import type { Status } from "../shared/view.ts";
import { statusColour, usePalette, type Palette } from "./piggery/palette.tsx";
import { SPACING, text, tint } from "./kit/theme.ts";

const PAST_WORD_MIN = 64;
const PIECE_GAP = 1;

const STATE_WORDS: Record<Status, string> = { working: "working", waiting: "waiting", idle: "idle", gone: "gone" };

export function barColours(theme: PluginTheme, palette: Palette, status: Status, own: string): { fill: string; ink: string; border: string } {
  const c = statusColour(palette, status);
  if (status === "idle") return { fill: tint(own, "2a"), ink: theme.colors.foreground, border: tint(own, "88") };
  return { fill: c, ink: theme.colors.surface0, border: c };
}

export function PastSegments({ theme, pieces, xOf, top, height, own }: { theme: PluginTheme; pieces: Piece[]; xOf: (t: number) => number; top: number; height: number; own: string }) {
  const palette = usePalette(theme);
  return (
    <>
      {pieces.map((piece) => {
        const left = xOf(piece.start);
        const width = Math.max(2, xOf(piece.end) - left - PIECE_GAP);
        const colours = barColours(theme, palette, piece.state, own);
        return (
          <View key={piece.start} pointerEvents="none" style={{ position: "absolute", left, width, top, height, borderRadius: 6, backgroundColor: colours.fill, borderWidth: 1, borderColor: colours.border, opacity: 0.85, overflow: "hidden", justifyContent: "center", paddingHorizontal: width >= PAST_WORD_MIN ? SPACING[2] : 0 }}>
            {width >= PAST_WORD_MIN ? (
              <Text style={[text(theme, "label"), { color: colours.ink, fontWeight: "600", lineHeight: 16 }]} numberOfLines={1}>
                {STATE_WORDS[piece.state]}
              </Text>
            ) : null}
          </View>
        );
      })}
    </>
  );
}
