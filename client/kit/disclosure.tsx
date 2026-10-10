import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { PressRow } from "./press.tsx";
import { Lead } from "./row.tsx";
import { ASIDE, ICON_SIZE, ROW_MIN, SPACING } from "./theme.ts";

/**
 * A line that folds what is under it: the host's chevron (providers-section.tsx:227-230), down when
 * open, then `children` (its icon, its name), then the `tail` (the columns a participant's line
 * has), so its columns sit under theirs. The rows it folds are the caller's, drawn as siblings so the
 * list's rules run on. `aside` is at the right edge, outside the pressable part (an info button).
 * With `onBody` there is no aside: the chevron alone folds, and a press on the rest of the line does
 * `onBody` (opens its detail, as a participant's line does), so the line keeps the room the button
 * would take. `left` is the room before the chevron.
 */
export function Disclosure({ theme, open, onToggle, onBody, label, left, tail, aside, children }: { theme: PluginTheme; open: boolean; onToggle: () => void; onBody?: () => void; label: string; left: number; tail?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  const chevron = <Icon name={open ? "ChevronDown" : "ChevronRight"} size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />;
  const line = { flex: 1, minWidth: 0, flexDirection: "row", minHeight: ROW_MIN } as const;
  if (onBody) {
    return (
      <View style={{ flexDirection: "row" }}>
        <PressRow theme={theme} onPress={onBody} label={label} style={line}>
          <Lead left={left}>
            <View style={{ width: ICON_SIZE.sm }} />
            {children}
          </Lead>
          {tail}
        </PressRow>
        <PressRow theme={theme} onPress={onToggle} expanded={open} label={`${open ? "Fold" : "Unfold"} ${label}`} style={{ position: "absolute", left: left - SPACING[2], top: 0, bottom: 0, width: ICON_SIZE.sm + SPACING[4], alignItems: "center", justifyContent: "center" }}>
          {chevron}
        </PressRow>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row" }}>
      <PressRow theme={theme} onPress={onToggle} expanded={open} label={label} style={line}>
        <Lead left={left}>
          {chevron}
          {children}
        </Lead>
        {tail}
      </PressRow>
      <View style={{ width: ASIDE, alignItems: "flex-end", justifyContent: "center" }}>{aside}</View>
    </View>
  );
}
