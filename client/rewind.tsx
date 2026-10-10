import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { rewoundImageOf, type ComposerAttachment, type ComposerContent } from "../shared/composer.ts";
import { imageFile, rewind } from "../shared/rpc.ts";
import type { UserMessageImage } from "../shared/stream.ts";
import { ConfirmDialog } from "./kit/confirm.tsx";
import { RADIUS, SPACING, text } from "./kit/theme.ts";
import { messageOf } from "../shared/errors.ts";

type RewindMode = "conversation" | "files" | "both";

interface RewindCapabilities {
  supportsRewindConversation?: boolean;
  supportsRewindFiles?: boolean;
  supportsRewindBoth?: boolean;
}

const MODES: { mode: RewindMode; label: string; icon: string; flag: keyof RewindCapabilities; effect: string }[] = [
  { mode: "conversation", label: "Rewind conversation", icon: "MessageSquare", flag: "supportsRewindConversation", effect: "The agent forgets everything from this message on, and the message goes back into your composer." },
  { mode: "files", label: "Rewind files", icon: "FileText", flag: "supportsRewindFiles", effect: "Files the agent changed from this message on go back to how they were. The conversation stays." },
  { mode: "both", label: "Rewind conversation and files", icon: "Layers", flag: "supportsRewindBoth", effect: "The agent forgets everything from this message on, its file changes since then are undone, and the message goes back into your composer." },
];

const MODAL_FONT = { fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' };

const restorers = new Map<string, (rewound: ComposerContent) => void>();

export function registerComposerRestore(draftKey: string, restore: (rewound: ComposerContent) => void): () => void {
  restorers.set(draftKey, restore);
  return () => {
    if (restorers.get(draftKey) === restore) restorers.delete(draftKey);
  };
}


function hoveredOf(state: PressableStateCallbackType): boolean {
  return (state as PressableStateCallbackType & { hovered?: boolean }).hovered === true;
}

export function RewindMenu({ theme, capabilities, agentId, messageId, rewoundText, rewoundImages = [], draftKey, onRewound }: { theme: PluginTheme; capabilities: RewindCapabilities | null | undefined; agentId: string; messageId: string; rewoundText: string; rewoundImages?: UserMessageImage[]; draftKey: string; onRewound: () => Promise<void> }) {
  const call = useRpc(rewind);
  const callImage = useRpc(imageFile);
  const imagesToRestore = async (): Promise<ComposerAttachment[]> => {
    const now = Date.now();
    const restored = await Promise.all(
      rewoundImages.map(async (image) => {
        if (image.uri?.startsWith("data:")) return rewoundImageOf(image, image.uri, now);
        if (!image.path) return null;
        const r = await callImage({ path: image.path });
        return r.ok ? rewoundImageOf({ ...image, mimeType: r.mimeType }, `data:${r.mimeType};base64,${r.data}`, now) : null;
      }),
    );
    return restored.filter((attachment): attachment is ComposerAttachment => attachment !== null);
  };
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<RewindMode | null>(null);
  const [confirming, setConfirming] = useState<RewindMode | null>(null);
  const [place, setPlace] = useState<{ right: number; top: number } | null>(null);
  const anchor = useRef<View>(null);
  const items = capabilities ? MODES.filter((item) => capabilities[item.flag]) : [];
  useEffect(() => {
    const win = (globalThis as { window?: Window }).window;
    if (!open || !win) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pending === null) setOpen(false);
    };
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  }, [open, pending]);
  const toggle = () => {
    if (open) return setOpen(false);
    anchor.current?.measureInWindow((x, y, width, height) => {
      const win = (globalThis as { window?: Window }).window;
      setPlace({ right: Math.max(8, (win?.innerWidth ?? x + width) - (x + width)), top: y + height + SPACING[1] });
      setOpen(true);
    });
  };
  if (items.length === 0) return null;
  const locked = pending !== null;
  const select = async (mode: RewindMode) => {
    if (locked) return;
    setPending(mode);
    try {
      const result = await call({ agentId, messageId, mode });
      if (!result.ok) throw new Error(result.error);
      if (mode !== "files") await onRewound();
      if (mode === "conversation" || mode === "both") restorers.get(draftKey)?.({ text: rewoundText, attachments: await imagesToRestore() });
    } catch (failure) {
      toast.error(messageOf(failure, "Failed to rewind agent"));
    } finally {
      setPending(null);
      setConfirming(null);
    }
  };
  const ask = (mode: RewindMode) => {
    setOpen(false);
    setConfirming(mode);
  };
  const asked = MODES.find((item) => item.mode === confirming);
  return (
    <View ref={anchor} style={{ alignSelf: "center", position: "relative" }}>
      <Pressable onPress={toggle} disabled={locked} accessibilityRole="button" accessibilityLabel="Rewind to this message" style={{ padding: SPACING[1], alignItems: "center", justifyContent: "center", opacity: locked ? 0.5 : 1 }}>
        {(state) => <Icon name="Undo2" size={16} color={hoveredOf(state) || open ? theme.colors.foreground : theme.colors.foregroundMuted} />}
      </Pressable>
      <Modal transparent visible={open && place !== null} animationType="none" onRequestClose={() => pending === null && setOpen(false)}>
        <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={() => pending === null && setOpen(false)} accessibilityLabel="Close menu" />
        <View accessibilityRole="menu" style={{ position: "absolute", top: place?.top ?? 0, right: place?.right ?? 0, minWidth: 220, paddingVertical: SPACING[1], backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.lg, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
          <View style={{ paddingHorizontal: SPACING[3], paddingVertical: SPACING[2] }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, ...MODAL_FONT }}>This action cannot be undone</Text>
          </View>
          <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: SPACING[1] }} />
          {items.map((item) => (
            <Pressable key={item.mode} accessibilityRole="menuitem" disabled={locked && pending !== item.mode} onPress={() => ask(item.mode)} style={(state) => ({ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: 32, marginHorizontal: SPACING[1], paddingHorizontal: SPACING[2], borderRadius: RADIUS.md, opacity: locked && pending !== item.mode ? 0.5 : 1, backgroundColor: hoveredOf(state) || state.pressed ? theme.colors.surface2 : "transparent" })}>
              {pending === item.mode ? <ActivityIndicator size={16} color={theme.colors.foreground} /> : <Icon name={item.icon} size={16} color={theme.colors.foreground} />}
              <Text style={{ color: theme.colors.foreground, fontSize: 14, ...MODAL_FONT }} numberOfLines={1}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Modal>
      <ConfirmDialog theme={theme} title={asked ? `${asked.label}?` : ""} icon="Undo2" tone="danger" confirmLabel={asked?.label ?? "Rewind"} busy={locked} open={asked !== undefined} onConfirm={() => asked && void select(asked.mode)} onClose={() => !locked && setConfirming(null)}>
        <Text style={text(theme, "rowTitle")}>{asked?.effect}</Text>
        <Text style={text(theme, "meta")}>This can't be undone.</Text>
      </ConfirmDialog>
    </View>
  );
}
