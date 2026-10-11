import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Image, Text, View } from "react-native";
import { useAvatarPicture } from "./avatar-pictures.ts";
import { ICON_SIZE, tint } from "./theme.ts";

export const AVATAR = 28;
export const AVATAR_SM = 20;

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} _-]/gu, " ").split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Avatar({ theme, name, colour, size = AVATAR, icon, imageId, imageUri, dim }: { theme: PluginTheme; name: string; colour: string; size?: number; icon?: string; imageId?: string; imageUri?: string; dim?: boolean }) {
  const fetched = useAvatarPicture(imageUri ? undefined : imageId);
  const [broken, setBroken] = useState<string | null>(null);
  const uri = imageUri ?? fetched;
  const picture = uri && uri !== broken ? uri : null;
  const c = dim ? theme.colors.foregroundMuted : colour;
  const big = size >= AVATAR;
  const inner = size - 2;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint(c, dim ? "14" : "2a"), borderWidth: 1, borderColor: tint(c, "66"), alignItems: "center", justifyContent: "center", overflow: "hidden" }} accessibilityLabel={name}>
      {picture ? (
        <Image source={{ uri: picture }} resizeMode="cover" onError={() => setBroken(picture)} style={{ width: inner, height: inner, borderRadius: inner / 2, opacity: dim ? 0.45 : 1 }} />
      ) : icon ? (
        <Icon name={icon} size={big ? ICON_SIZE.sm : 11} color={c} />
      ) : (
        <Text style={{ fontSize: big ? 11 : 9, lineHeight: big ? 13 : 11, fontWeight: "600", color: c }}>{initials(name)}</Text>
      )}
    </View>
  );
}
