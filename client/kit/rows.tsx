// Dense lists in Paseo's finish: small muted labels (styles/settings.ts:14-18) over rows split by a rule
// in the border colour (settings.ts:42-45). Full width: no card, no centred column.
import type { PluginTheme } from "@getpaseo/plugin";
import { Children, isValidElement, type ReactNode } from "react";
import { View } from "react-native";

/** Children stacked with a rule above each (the first too: it closes the label's group); nulls skipped. */
export function Rows({ theme, children, bare }: { theme: PluginTheme; children: ReactNode; /** No rule above the first and below the last: the card around it has them. */ bare?: boolean }) {
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
