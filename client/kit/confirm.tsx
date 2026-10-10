import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import type { ReactNode } from "react";
import { Actions, Button, type ButtonTone } from "./button.tsx";
import { ICON_SIZE } from "./theme.ts";

export function ConfirmDialog({ theme, title, icon, tone, confirmLabel, busy, open, onConfirm, onClose, children }: { theme: PluginTheme; title: string; icon: string; tone: ButtonTone; confirmLabel: string; busy: boolean; open: boolean; onConfirm: () => void; onClose: () => void; children: ReactNode }) {
  return (
    <Modal title={title} icon={<Icon name={icon} size={ICON_SIZE.md} color={tone === "danger" ? theme.colors.statusDanger : theme.colors.foregroundMuted} />} open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content>
        {children}
        <Actions>
          <Button theme={theme} label="Cancel" disabled={busy} onPress={onClose} />
          <Button theme={theme} label={confirmLabel} icon={icon} tone={tone} busy={busy} onPress={onConfirm} />
        </Actions>
      </Modal.Content>
    </Modal>
  );
}
