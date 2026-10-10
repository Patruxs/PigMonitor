import type { PluginTheme } from "@getpaseo/plugin";
import { Children, isValidElement, type ReactNode } from "react";
import { View } from "react-native";

export function Rows({ theme, children, bare }: { theme: PluginTheme; children: ReactNode; bare?: boolean }) {
  const shown = Children.toArray(children).filter(isValidElement);
  return (
    <View style={{ borderBottomWidth: shown.length > 0 && !bare ? 1 : 0, borderBottomColor: theme.colors.border }}>
      {shown.map((child, i) => (
        <View key={child.key ?? i} style={{ borderTopWidth: bare && i === 0 ? 0 : 1, borderTopColor: theme.colors.border }}>
          {child}
        </View>
      ))}
    </View>
  );
}
