import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState } from "react";
import { Image, Modal, Pressable, Text, View } from "react-native";
import { SPACING } from "./theme.ts";

const dom = globalThis as { window?: Window };

export function AttachmentLightbox({ theme, uri, onClose }: { theme: PluginTheme; uri: string | null | undefined; onClose: () => void }) {
  const [errored, setErrored] = useState(false);
  const open = uri !== undefined;
  useEffect(() => setErrored(false), [uri]);
  useEffect(() => {
    const win = dom.window;
    if (!open || !win) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    win.addEventListener("keydown", onKey, true);
    return () => win.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  if (!open) return null;
  const failed = errored || !uri;
  return (
    <Modal transparent animationType="fade" statusBarTranslucent visible onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss image" onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.9)" }} />
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "box-none" }}>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING[4], pointerEvents: "box-none" }}>
            {failed ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>Couldn't load image</Text>
            ) : (
              <Pressable onPress={() => {}} style={{ flex: 1, width: "100%", alignSelf: "center", maxWidth: 960, maxHeight: 640 }}>
                <Image source={{ uri }} resizeMode="contain" onError={() => setErrored(true)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
              </Pressable>
            )}
          </View>
          <View style={{ position: "absolute", top: SPACING[3], left: 0, right: 0, alignItems: "flex-end", pointerEvents: "box-none" }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close image" hitSlop={8} onPress={onClose} style={{ width: 32, height: 32, borderRadius: 16, marginRight: SPACING[3], backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border, alignItems: "center", justifyContent: "center", zIndex: 1 }}>
              <Icon name="X" size={16} color={theme.colors.foregroundMuted} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
