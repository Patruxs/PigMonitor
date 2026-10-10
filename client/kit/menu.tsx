import type { PluginTheme } from "@getpaseo/plugin";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Pressable, Text, useWindowDimensions, View, type TextProps } from "react-native";
import { dom, isIos, useCompact } from "./platform.ts";
import { hovered } from "./press.tsx";
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
const MENU_ITEM_HEIGHT = { sheet: 40, popover: 28 } as const;
const SHEET_RADIUS = 12;
const SHEET_MAX_HEIGHT_RATIO = 0.8;
const SHEET_BACKDROP_OPACITY = 0.45;

const selectsAfterSheetDismiss = isIos;

const SheetFont = createContext<string | undefined>(undefined);

export function SheetText({ style, ...props }: TextProps) {
  const fontFamily = useContext(SheetFont);
  return <Text {...props} style={fontFamily ? [style, { fontFamily }] : style} />;
}

function useSheetPresentation(): boolean {
  return useCompact();
}

function BottomSheet({ theme, open, title, fontFamily, onClose, onDismiss, children }: { theme: PluginTheme; open: boolean; title: string; fontFamily: string | undefined; onClose: () => void; onDismiss?: () => void; children: ReactNode }) {
  const { height } = useWindowDimensions();
  return (
    <Modal transparent animationType="fade" statusBarTranslucent visible={open} onRequestClose={onClose} onDismiss={onDismiss}>
      <SheetFont.Provider value={fontFamily}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: `rgba(0,0,0,${SHEET_BACKDROP_OPACITY})` }} />
        <View accessibilityLabel={title} style={{ maxHeight: height * SHEET_MAX_HEIGHT_RATIO, backgroundColor: theme.colors.surface0, borderTopLeftRadius: SHEET_RADIUS, borderTopRightRadius: SHEET_RADIUS, borderWidth: 1, borderColor: theme.colors.border, paddingBottom: SPACING[1] }}>
          <View style={{ alignItems: "center", paddingVertical: SPACING[2] }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.colors.surface2 }} />
          </View>
          <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingHorizontal: SPACING[3], paddingTop: SPACING[1], paddingBottom: SPACING[3] }}>
              <Text style={{ fontSize: 14, fontWeight: "500", color: theme.colors.foreground, flexShrink: 1, fontFamily }} numberOfLines={1}>
                {title}
              </Text>
            </View>
            {children}
          </ScrollView>
        </View>
      </View>
      </SheetFont.Provider>
    </Modal>
  );
}

export type Drop = "up-right" | "down-left";

export function AnchoredPopover({ theme, open, label, role, onClose, onSheetDismiss, panel, minWidth, maxWidth, maxHeight, offset, drop = "up-right", children }: { theme: PluginTheme; open: boolean; label: string; role?: "menu"; onClose: () => void; onSheetDismiss?: () => void; panel: ReactNode; minWidth: number; maxWidth?: number; maxHeight?: number; offset: number; drop?: Drop; children: ReactNode }) {
  const anchor = useRef<View>(null);
  const sheet = useSheetPresentation();
  const [fontFamily, setFontFamily] = useState<string | undefined>(undefined);
  useEffect(() => {
    const node = anchor.current as unknown as Element | null;
    if (!open || !sheet || !node || !dom.window?.getComputedStyle) return;
    setFontFamily(dom.window.getComputedStyle(node).fontFamily || undefined);
  }, [open, sheet]);
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
        <BottomSheet theme={theme} open={open} title={label} fontFamily={fontFamily} onClose={onClose} onDismiss={onSheetDismiss}>
          {panel}
        </BottomSheet>
      </View>
    );
  }
  return (
    <View ref={anchor} style={{ position: "relative" }}>
      {children}
      {open ? (
        <View accessibilityRole={role} accessibilityLabel={label} style={{ position: "absolute", ...(drop === "down-left" ? { top: "100%", right: 0, marginTop: offset } : { bottom: "100%", left: 0, marginBottom: offset }), minWidth, maxWidth, maxHeight, zIndex: 10, paddingVertical: SPACING[1], backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.lg, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
          {maxHeight ? <ScrollView style={{ flexGrow: 0 }}>{panel}</ScrollView> : panel}
        </View>
      ) : null}
    </View>
  );
}

export function AnchoredMenu({ theme, open, label, items, note, drop, onClose, children }: { theme: PluginTheme; open: boolean; label: string; items: MenuItem[]; note?: string; drop?: Drop; onClose: () => void; children: ReactNode }) {
  const sheet = useSheetPresentation();
  const itemHeight = sheet ? MENU_ITEM_HEIGHT.sheet : MENU_ITEM_HEIGHT.popover;
  const selectionAwaitingDismiss = useRef<(() => void) | null>(null);
  const runSelectionAwaitingDismiss = () => {
    const select = selectionAwaitingDismiss.current;
    selectionAwaitingDismiss.current = null;
    select?.();
  };
  const rows = items.map((item) => (
    <Pressable
      key={item.id}
      accessibilityRole="menuitem"
      accessibilityLabel={item.label}
      disabled={item.disabled}
      onPress={() => {
        onClose();
        if (sheet && selectsAfterSheetDismiss) selectionAwaitingDismiss.current = item.onSelect;
        else item.onSelect();
      }}
      style={(state) => ({ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: itemHeight, marginHorizontal: SPACING[1], paddingHorizontal: SPACING[2], paddingVertical: SPACING[1], borderRadius: RADIUS.md, opacity: item.disabled ? 0.5 : 1, backgroundColor: !item.disabled && (state.pressed || hovered(state)) ? theme.colors.surface2 : "transparent" })}
    >
      {item.icon}
      <SheetText style={text(theme, "rowTitle")} numberOfLines={1}>
        {item.label}
      </SheetText>
    </Pressable>
  ));
  const panel = note ? (
    <>
      {rows}
      <SheetText style={[text(theme, "label"), { marginHorizontal: SPACING[1], paddingHorizontal: SPACING[2], paddingVertical: SPACING[2] }]}>{note}</SheetText>
    </>
  ) : (
    rows
  );
  return (
    <AnchoredPopover theme={theme} open={open} label={label} role="menu" onClose={onClose} onSheetDismiss={runSelectionAwaitingDismiss} panel={panel} minWidth={MENU_MIN_WIDTH} offset={MENU_OFFSET} drop={drop}>
      {children}
    </AnchoredPopover>
  );
}
