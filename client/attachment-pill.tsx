import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState, type ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useCompact } from "./kit/platform.ts";
import { hostColours, RADIUS, SPACING } from "./kit/theme.ts";

const CONTENT_HEIGHT = 48;
const LABEL_MAX_WIDTH = 260;
const ICON_SLOT = 18;
const REMOVE_SIZE = 24;

const isNative = (globalThis as { document?: Document }).document === undefined;

function frameStyle(theme: PluginTheme) {
  return { borderRadius: RADIUS.md, borderWidth: 1, borderColor: hostColours(theme).borderAccent, overflow: "hidden" as const };
}

export function AttachmentFrame({ theme, onPress, accessibilityLabel, children }: { theme: PluginTheme; onPress?: () => void; accessibilityLabel?: string; children: ReactNode }) {
  if (!onPress) return <View style={frameStyle(theme)}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={frameStyle(theme)}>
      {children}
    </Pressable>
  );
}

export function AttachmentLabel({ theme, icon, title, subtitle }: { theme: PluginTheme; icon?: string | ReactNode; title: string; subtitle: string }) {
  return (
    <View style={{ height: CONTENT_HEIGHT, maxWidth: LABEL_MAX_WIDTH, flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingHorizontal: SPACING[3], backgroundColor: theme.colors.surface1 }}>
      {icon ? (
        <View style={{ width: ICON_SLOT, alignItems: "center", justifyContent: "center" }}>
          {typeof icon === "string" ? <Icon name={icon} size={14} color={theme.colors.foregroundMuted} /> : icon}
        </View>
      ) : null}
      <View style={{ minWidth: 0, flexShrink: 1 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 14 }} numberOfLines={1}>
          {title}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

export function AttachmentThumbnail({ theme, uri }: { theme: PluginTheme; uri: string | null }) {
  if (!uri) return <View style={{ width: CONTENT_HEIGHT, height: CONTENT_HEIGHT, backgroundColor: theme.colors.surface1 }} />;
  return <Image source={{ uri }} style={{ width: CONTENT_HEIGHT, height: CONTENT_HEIGHT }} />;
}

export function AttachmentPill({ theme, openLabel, removeLabel, disabled, onOpen, onRemove, children }: { theme: PluginTheme; openLabel: string; removeLabel: string; disabled?: boolean; onOpen?: () => void; onRemove: () => void; children: ReactNode }) {
  const [bodyHovered, setBodyHovered] = useState(false);
  const [removeHovered, setRemoveHovered] = useState(false);
  const isCompact = useCompact();
  const showRemove = isNative || isCompact || bodyHovered || removeHovered;
  return (
    <View style={{ position: "relative" }}>
      <Pressable onPress={onOpen} disabled={disabled} onHoverIn={() => setBodyHovered(true)} onHoverOut={() => setBodyHovered(false)} accessibilityRole="button" accessibilityLabel={openLabel} style={frameStyle(theme)}>
        {children}
      </Pressable>
      <Pressable onPress={onRemove} disabled={disabled} onHoverIn={() => setRemoveHovered(true)} onHoverOut={() => setRemoveHovered(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel={removeLabel} style={{ position: "absolute", top: -8, left: -8, width: REMOVE_SIZE, height: REMOVE_SIZE, borderRadius: REMOVE_SIZE / 2, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border, zIndex: 1, opacity: showRemove ? 1 : 0, pointerEvents: showRemove ? "auto" : "none" }}>
        <Icon name="X" size={12} color={theme.colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}
