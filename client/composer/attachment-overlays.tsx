import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useState } from "react";
import type { ComposerAttachment } from "./attachment.ts";
import { attachmentChoices, type AttachmentChoiceId } from "./attachment-menu.ts";
import { canAttach } from "./attachments.tsx";
import { ForgeGlyph } from "./attachments-forge.tsx";
import type { useComposerAttachments } from "./composer-attachments.ts";
import type { MenuItem } from "../kit/menu.tsx";
import { isWeb } from "../kit/platform.ts";
import { ICON_SIZE } from "../kit/theme.ts";

const PLUGINS_CANNOT_ATTACH = "Paseo's mobile app doesn't let plugins attach photos or files yet";

export function useAttachmentOverlays({ theme, intake }: { theme: PluginTheme; intake: Pick<ReturnType<typeof useComposerAttachments>, "pickImage" | "pickFile"> }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lightboxUri, setLightboxUri] = useState<string | undefined>(undefined);

  const openAttachment = (attachment: ComposerAttachment) => {
    if (attachment.kind === "image") return setLightboxUri(attachment.metadata.dataUrl);
    if (attachment.kind === "file") return;
    void openExternalUrl(attachment.item.url);
  };
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeLightbox = useCallback(() => setLightboxUri(undefined), []);
  const menuIcon = (name: string) => <Icon name={name} size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />;
  const menuEntries: Record<AttachmentChoiceId, Omit<MenuItem, "id" | "disabled">> = {
    image: { label: "Add image", icon: menuIcon("Image"), onSelect: () => void intake.pickImage() },
    "paste-image": { label: "Paste image", icon: menuIcon("ClipboardPaste"), onSelect: () => undefined },
    github: { label: "Add issue or PR", icon: <ForgeGlyph size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />, onSelect: () => setPickerOpen(true) },
    file: { label: "Upload file", icon: menuIcon("Paperclip"), onSelect: () => void intake.pickFile() },
  };
  const choices = attachmentChoices(!isWeb, canAttach);
  const menuItems: MenuItem[] = choices.map((choice) => ({ id: choice.id, ...menuEntries[choice.id], disabled: !choice.enabled }));
  const menuNote = choices.some((choice) => !choice.enabled) ? PLUGINS_CANNOT_ATTACH : undefined;

  return { menuOpen, setMenuOpen, pickerOpen, setPickerOpen, lightboxUri, openAttachment, closeMenu, closeLightbox, menuItems, menuNote };
}
