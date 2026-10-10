import type { PluginTheme } from "@getpaseo/plugin";
import { Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, type ReactNode } from "react";
import { Pressable, Text, useWindowDimensions, View, type PressableStateCallbackType } from "react-native";
import { RADIUS, SPACING, text } from "./theme.ts";

export interface MenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}

const MENU_MIN_WIDTH = 220;
const MENU_OFFSET = 8;
const MENU_ITEM_HEIGHT = 28;
const SHEET_BELOW_WIDTH = 720;

const dom = globalThis as { document?: Document };

function hoveredOf(state: PressableStateCallbackType): boolean {
  return (state as PressableStateCallbackType & { hovered?: boolean }).hovered === true;
}

export function AnchoredPopover({ theme, open, label, role, onClose, panel, minWidth, maxWidth, maxHeight, offset, children }: { theme: PluginTheme; open: boolean; label: string; role?: "menu"; onClose: () => void; panel: ReactNode; minWidth: number; maxWidth?: number; maxHeight?: number; offset: number; children: ReactNode }) {
  const anchor = useRef<View>(null);
  const sheet = useWindowDimensions().width < SHEET_BELOW_WIDTH;
  useEffect(() => {
    const doc = dom.document;
    if (!open || !doc || sheet) return;
    const node = anchor.current as unknown as HTMLElement | null;
    const onPointerDown = (e: Event) => {
      if (node && e.target instanceof Node && node.contains(e.target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    doc.addEventListener("mousedown", onPointerDown);
    doc.addEventListener("keydown", onKeyDown, true);
    return () => {
      doc.removeEventListener("mousedown", onPointerDown);
      doc.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose, sheet]);
  if (sheet) {
    return (
      <View ref={anchor} style={{ position: "relative" }}>
        {children}
        <Modal title={label} open={open} onOpenChange={(next) => !next && onClose()}>
          <Modal.Content contentContainerStyle={{ padding: SPACING[1], gap: 0 }}>{panel}</Modal.Content>
        </Modal>
      </View>
    );
  }
  return (
    <View ref={anchor} style={{ position: "relative" }}>
      {children}
      {open ? (
        <View accessibilityRole={role} accessibilityLabel={label} style={{ position: "absolute", bottom: "100%", left: 0, marginBottom: offset, minWidth, maxWidth, maxHeight, zIndex: 10, paddingVertical: SPACING[1], backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.lg, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
          {maxHeight ? <ScrollView style={{ flexGrow: 0 }}>{panel}</ScrollView> : panel}
        </View>
      ) : null}
    </View>
  );
}

export function AnchoredMenu({ theme, open, label, items, onClose, children }: { theme: PluginTheme; open: boolean; label: string; items: MenuItem[]; onClose: () => void; children: ReactNode }) {
  const panel = items.map((item) => (
    <Pressable
      key={item.id}
      accessibilityRole="menuitem"
      accessibilityLabel={item.label}
      disabled={item.disabled}
      onPress={() => {
        onClose();
        item.onSelect();
      }}
      style={(state) => ({ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: MENU_ITEM_HEIGHT, marginHorizontal: SPACING[1], paddingHorizontal: SPACING[2], paddingVertical: SPACING[1], borderRadius: RADIUS.md, opacity: item.disabled ? 0.5 : 1, backgroundColor: !item.disabled && (state.pressed || hoveredOf(state)) ? theme.colors.surface2 : "transparent" })}
    >
      {item.icon}
      <Text style={text(theme, "rowTitle")} numberOfLines={1}>
        {item.label}
      </Text>
    </Pressable>
  ));
  return (
    <AnchoredPopover theme={theme} open={open} label={label} role="menu" onClose={onClose} panel={panel} minWidth={MENU_MIN_WIDTH} offset={MENU_OFFSET}>
      {children}
    </AnchoredPopover>
  );
}
