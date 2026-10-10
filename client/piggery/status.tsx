import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useRef } from "react";
import { Animated, Easing, Text, View } from "react-native";
import type { Status } from "../../shared/view.ts";
import { SPACING, text, tint } from "../kit/theme.ts";
import { statusColour, usePalette } from "../palette.tsx";

export function StatusPill({ theme, status, word, dim }: { theme: PluginTheme; status: Status; word: string; dim?: boolean }) {
  const c = statusColour(usePalette(theme), status, dim);
  const plain = word.replace(/^[^\p{L}]+/u, "");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5], paddingHorizontal: SPACING[2], height: 22, borderRadius: 11, backgroundColor: tint(c, "16"), borderWidth: 1, borderColor: tint(c, "44") }} accessibilityLabel={word}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} />
      <Text style={[text(theme, "label"), { color: c, lineHeight: 14 }]} numberOfLines={1}>
        {plain}
      </Text>
    </View>
  );
}

export const STATUS_WORD: Record<Status, string> = { working: "working", waiting: "waiting", idle: "idle", gone: "ended" };

function usePulse(on: boolean): Animated.Value {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!on) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [on, opacity]);
  return opacity;
}

export function StatusDot({ theme, status, dim, size = 12 }: { theme: PluginTheme; status: Status; dim?: boolean; size?: number }) {
  const c = statusColour(usePalette(theme), status, dim);
  const opacity = usePulse(status === "working" && !dim);
  const hollow = status === "idle" || status === "gone";
  return (
    <View style={{ position: "absolute", right: -2, bottom: -2, width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors.surface0, padding: 2 }}>
      <Animated.View style={{ flex: 1, borderRadius: size / 2, opacity, backgroundColor: hollow ? theme.colors.surface0 : c, borderWidth: hollow ? 1.5 : 0, borderColor: c }} />
    </View>
  );
}

export function StatusWord({ theme, status, dim }: { theme: PluginTheme; status: Status; dim?: boolean }) {
  const c = statusColour(usePalette(theme), status, dim);
  const busy = !dim && (status === "working" || status === "waiting");
  return (
    <Text style={[text(theme, "label"), { color: c, fontWeight: busy ? "600" : "400", flexShrink: 0 }]} numberOfLines={1}>
      {STATUS_WORD[status]}
    </Text>
  );
}
