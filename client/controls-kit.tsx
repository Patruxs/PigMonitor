import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions, type PressableStateCallbackType, type TextStyle, type ViewStyle } from "react-native";
import { hostColours, mix, SPACING } from "./kit/theme.ts";
import { NO_OUTLINE } from "./kit/platform.ts";

export const FONT_BASE = 14;
export const FONT_SM = 12;
const RADIUS_LG = 8;
const RADIUS_XL = 12;
const RADIUS_2XL = 16;
export const PALETTE = { blue400: "#60a5fa", green400: "#4ade80", yellow400: "#fbbf24", amber500: "#f59e0b" } as const;

const POPOVER_OFFSET = 5;
const TOOLTIP_OFFSET = 8;
const POPOVER_MAX_HEIGHT = 400;
const TOOLTIP_SPAN = 400;
const VIEWPORT_EDGE = 16;
const HOVER_CARD_CLOSE_GRACE_MS = 100;

const dom = globalThis as { document?: Document };

export function hoveredOf(state: PressableStateCallbackType): boolean {
  return (state as PressableStateCallbackType & { hovered?: boolean }).hovered === true;
}

function isDark(theme: PluginTheme): boolean {
  const hex = /^#([0-9a-f]{6})/i.exec(theme.colors.surface0)?.[1];
  if (!hex) return true;
  const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

function popoverColour(theme: PluginTheme): string {
  return isDark(theme) ? theme.colors.surface2 : theme.colors.surface0;
}

export function sidebarColour(theme: PluginTheme): string {
  return isDark(theme) ? mix(theme.colors.surface0, "#000000", 0.17) : theme.colors.surface2;
}

function shadowMd(theme: PluginTheme): ViewStyle {
  return isDark(theme) ? { shadowColor: "rgba(0, 0, 0, 0.20)", shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 8 } : { shadowColor: "rgba(0, 0, 0, 0.04)", shadowOffset: { width: 0, height: 4 }, shadowRadius: 16, elevation: 4 };
}

type DesktopKey = "ArrowDown" | "ArrowUp" | "Enter" | "Escape";

function clampLeft(anchorX: number | null, preferred: number, width: number, windowWidth: number): number {
  if (anchorX === null || width <= 0) return preferred;
  const left = Math.max(VIEWPORT_EDGE, Math.min(anchorX + preferred, windowWidth - VIEWPORT_EDGE - width));
  return left - anchorX;
}

export function Anchored({ theme, open, onClose, onKey, tooltip, tooltipStyle, tooltipDelay = 0, interactive = false, popover, popoverWidth, minWidth, fixedHeight, style, children }: { theme: PluginTheme; open: boolean; onClose: () => void; onKey?: (key: DesktopKey) => boolean; tooltip?: ReactNode; tooltipStyle?: ViewStyle; tooltipDelay?: number; interactive?: boolean; popover?: ReactNode; popoverWidth?: number; minWidth?: number; fixedHeight?: number; style?: ViewStyle; children: ReactNode }) {
  const anchor = useRef<View>(null);
  const { width: windowWidth } = useWindowDimensions();
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [width, setWidth] = useState(0);
  const [anchorX, setAnchorX] = useState<number | null>(null);
  const [tipWidth, setTipWidth] = useState(0);
  const [popWidth, setPopWidth] = useState(0);
  const showTip = Boolean(tooltip) && hovered && !open;
  useEffect(() => {
    if (open || showTip) anchor.current?.measureInWindow((x) => setAnchorX(x));
  }, [open, showTip, windowWidth]);
  useEffect(() => {
    const doc = dom.document;
    if (!open || !doc) return;
    const node = anchor.current as unknown as HTMLElement | null;
    const onPointerDown = (e: Event) => {
      if (node && e.target instanceof Node && node.contains(e.target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter" && e.key !== "Escape") return;
      if (onKey?.(e.key)) {
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") onClose();
    };
    doc.addEventListener("mousedown", onPointerDown);
    doc.addEventListener("keydown", onKeyDown, true);
    return () => {
      doc.removeEventListener("mousedown", onPointerDown);
      doc.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose, onKey]);
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);
  const hover = (next: boolean) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    const wait = next ? tooltipDelay : interactive ? HOVER_CARD_CLOSE_GRACE_MS : 0;
    if (wait === 0) return setHovered(next);
    hoverTimer.current = setTimeout(() => setHovered(next), wait);
  };
  const popoverMin = Math.max(minWidth ?? 0, popoverWidth ? 0 : width);
  const tipLeft = clampLeft(anchorX, width / 2 - tipWidth / 2, tipWidth, windowWidth);
  const popLeft = clampLeft(anchorX, 0, popWidth, windowWidth);
  return (
    <View ref={anchor} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)} style={[{ position: "relative", minWidth: 0 }, style]}>
      {children}
      {showTip ? (
        <View pointerEvents={interactive ? "box-none" : "none"} style={{ position: "absolute", bottom: "100%", left: -TOOLTIP_SPAN, right: -TOOLTIP_SPAN, paddingBottom: TOOLTIP_OFFSET, alignItems: "flex-start", zIndex: 20 }}>
          <View onLayout={(e) => setTipWidth(e.nativeEvent.layout.width)} style={{ marginLeft: TOOLTIP_SPAN + tipLeft, opacity: tipWidth > 0 && anchorX !== null ? 1 : 0, paddingVertical: SPACING[1], paddingHorizontal: SPACING[2], borderRadius: RADIUS_XL, backgroundColor: popoverColour(theme), borderWidth: 1, borderColor: hostColours(theme).borderAccent, ...shadowMd(theme), ...tooltipStyle }}>{tooltip}</View>
        </View>
      ) : null}
      {open && popover ? (
        <View accessibilityRole="menu" onLayout={(e) => setPopWidth(e.nativeEvent.layout.width)} style={{ position: "absolute", bottom: "100%", left: popLeft, marginBottom: POPOVER_OFFSET, minWidth: popoverMin, width: popoverWidth, maxHeight: POPOVER_MAX_HEIGHT, height: fixedHeight, zIndex: 30, backgroundColor: theme.colors.surface0, borderRadius: RADIUS_LG, borderWidth: 1, borderColor: theme.colors.border, overflow: "hidden", ...shadowMd(theme) }}>
          {popover}
        </View>
      ) : null}
    </View>
  );
}

export function TooltipText({ theme, children }: { theme: PluginTheme; children: ReactNode }) {
  return <Text style={{ color: theme.colors.foreground, fontSize: FONT_BASE, lineHeight: FONT_BASE * 1.4 }} numberOfLines={1}>{children}</Text>;
}

export function SearchRow({ theme, placeholder, onChange, onFocus, onBlur, onSubmit, autoFocus, resetKey, sheet = false }: { theme: PluginTheme; placeholder: string; onChange: (value: string) => void; onFocus?: () => void; onBlur?: () => void; onSubmit?: () => void; autoFocus?: boolean; resetKey?: string | number; sheet?: boolean }) {
  const input = useRef<TextInput>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const timer = setTimeout(() => input.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [autoFocus, resetKey]);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingHorizontal: sheet ? SPACING[6] : SPACING[3], paddingVertical: SPACING[2], borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <Icon name="Search" size={sheet ? 16 : 14} color={theme.colors.foregroundMuted} />
      <TextInput
        key={resetKey}
        ref={input}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        onChangeText={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        onSubmitEditing={onSubmit}
        autoCapitalize="none"
        autoCorrect={false}
        style={[{ flex: 1, paddingVertical: SPACING[2], color: theme.colors.foreground, fontSize: FONT_BASE, borderWidth: 0 }, NO_OUTLINE]}
      />
    </View>
  );
}

export function HeaderRow({ theme, title, leading, onBack }: { theme: PluginTheme; title: string; leading?: ReactNode; onBack?: () => void }) {
  return (
    <View style={{ paddingHorizontal: SPACING[3], paddingTop: SPACING[2], flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back" style={{ borderRadius: RADIUS_LG }}>
          {({ pressed }) => <Icon name="ArrowLeft" size={16} color={pressed ? theme.colors.foreground : theme.colors.foregroundMuted} />}
        </Pressable>
      ) : null}
      {leading ? <View style={{ alignItems: "center", justifyContent: "center" }}>{leading}</View> : null}
      <Text style={{ flex: 1, fontSize: FONT_BASE, fontWeight: "500", color: theme.colors.foreground }} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

function ComboItem({ theme, label, description, leading, selected, active, elevated, onPress }: { theme: PluginTheme; label: string; description?: string; leading?: ReactNode; selected?: boolean; active?: boolean; elevated?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      style={(state) => ({ flexDirection: "row", alignItems: "center", minHeight: 36, gap: SPACING[2], paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], backgroundColor: hoveredOf(state) || state.pressed ? (elevated ? theme.colors.surface2 : theme.colors.surface1) : active ? theme.colors.surface1 : "transparent" })}
    >
      {leading ? <View style={{ width: 16, alignItems: "center", justifyContent: "center" }}>{leading}</View> : null}
      <View style={[{ flex: 1, flexShrink: 1 }, description ? { flexDirection: "row", alignItems: "baseline", gap: SPACING[2] } : null]}>
        <Text numberOfLines={1} style={{ fontSize: FONT_BASE, color: theme.colors.foreground, flexShrink: 0 }}>
          {label}
        </Text>
        {description ? (
          <Text numberOfLines={1} style={{ fontSize: FONT_SM, color: theme.colors.foregroundMuted, flexShrink: 1 }}>
            {description}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1], marginLeft: "auto" }}>
          <View style={{ width: 16, alignItems: "center", justifyContent: "center" }}>
            <Icon name="Check" size={16} color={theme.colors.foregroundMuted} />
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

export interface ComboOption {
  id: string;
  label: string;
}

export function useComboKeys(options: ComboOption[], open: boolean, onSelect: (id: string) => void, value: string, query = "") {
  const [activeIndex, setActiveIndex] = useState(-1);
  const ids = options.map((option) => option.id).join("\n");
  useEffect(() => {
    if (!open || options.length === 0) return setActiveIndex(-1);
    const selectedIndex = query.trim() ? -1 : options.findIndex((option) => option.id === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, ids, value, query]);
  const onKey = (key: DesktopKey): boolean => {
    if (key === "ArrowDown" || key === "ArrowUp") {
      if (options.length === 0) return true;
      setActiveIndex((index) => (key === "ArrowDown" ? (index + 1) % options.length : index <= 0 ? options.length - 1 : index - 1));
      return true;
    }
    if (key === "Enter") {
      const option = options[activeIndex];
      if (!option) return false;
      onSelect(option.id);
      return true;
    }
    return false;
  };
  return { activeIndex, onKey };
}

export function ComboList({ theme, options, value, activeIndex, searchable, searchPlaceholder, onSearch, onSelect, leadingOf, emptyText, sheet = false }: { theme: PluginTheme; options: ComboOption[]; value: string; activeIndex: number; searchable: boolean; searchPlaceholder?: string; onSearch: (query: string) => void; onSelect: (id: string) => void; leadingOf?: (option: ComboOption) => ReactNode; emptyText?: string; sheet?: boolean }) {
  return (
    <>
      {searchable ? <SearchRow theme={theme} placeholder={searchPlaceholder ?? "Search..."} onChange={onSearch} autoFocus sheet={sheet} /> : null}
      <ScrollView style={{ flexShrink: 1, minHeight: 0 }} contentContainerStyle={{ paddingVertical: SPACING[1] }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {options.length === 0 ? <Text style={{ paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], color: theme.colors.foregroundMuted, fontSize: FONT_BASE }}>{emptyText ?? "No results"}</Text> : null}
        {options.map((option, index) => (
          <ComboItem key={option.id} theme={theme} label={option.label} leading={leadingOf?.(option)} selected={option.id === value} active={index === activeIndex} onPress={() => onSelect(option.id)} />
        ))}
      </ScrollView>
    </>
  );
}

export function ToolbarGlyph({ size, children }: { size: number; children: ReactNode }) {
  const box = size >= 20 ? 20 : 16;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: box, height: box, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
      {children}
    </View>
  );
}

export function Caret({ theme }: { theme: PluginTheme }) {
  return (
    <View style={{ flexShrink: 0, transform: [{ translateY: 1 }] }}>
      <Icon name="ChevronDown" size={14} color={theme.colors.foregroundMuted} />
    </View>
  );
}

export function toolbarStyle(theme: PluginTheme, { iconOnly, open, disabled }: { iconOnly?: boolean; open?: boolean; disabled?: boolean }) {
  return (state: PressableStateCallbackType): ViewStyle => ({
    height: 28,
    minWidth: 0,
    flexShrink: iconOnly ? 0 : 1,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING[1],
    paddingHorizontal: iconOnly ? 0 : SPACING[2],
    width: iconOnly ? 28 : undefined,
    justifyContent: iconOnly ? "center" : undefined,
    borderRadius: RADIUS_2XL,
    backgroundColor: state.pressed || open ? theme.colors.surface0 : hoveredOf(state) ? theme.colors.surface2 : "transparent",
    opacity: disabled ? 0.5 : 1,
  });
}

export function ControlTrigger({ theme, icon, iconColor, surface, label, value, showToolbarLabel = true, showCaret = false, open = false, disabled = false, glyphSize, onPress, accessibilityLabel }: { theme: PluginTheme; icon: ReactNode | ((size: number, color: string) => ReactNode); iconColor?: string; surface: "toolbar" | "sheet"; label: string; value?: string; showToolbarLabel?: boolean; showCaret?: boolean; open?: boolean; disabled?: boolean; glyphSize: number; onPress: () => void; accessibilityLabel: string }) {
  const isSheet = surface === "sheet";
  const size = isSheet ? 16 : glyphSize;
  const colour = iconColor ?? theme.colors.foregroundMuted;
  const glyph = typeof icon === "function" ? icon(size, colour) : icon;
  const showValue = isSheet || showToolbarLabel;
  if (isSheet) {
    return (
      <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={(state) => ({ minHeight: 44, minWidth: 0, flexDirection: "row", alignItems: "center", gap: SPACING[2], marginHorizontal: -SPACING[1], paddingHorizontal: SPACING[4], borderRadius: RADIUS_2XL, backgroundColor: hoveredOf(state) || state.pressed || open ? theme.colors.surface2 : theme.colors.surface1, opacity: disabled ? 0.5 : 1 })}>
        <View style={{ width: 20, height: 20, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>{glyph}</View>
        <Text style={{ minWidth: 0, flexShrink: 1, color: theme.colors.foreground, fontSize: FONT_BASE }} numberOfLines={1}>
          {label}
        </Text>
        <Text style={{ maxWidth: "45%", minWidth: 0, flexShrink: 1, color: theme.colors.foregroundMuted, fontSize: FONT_BASE }} numberOfLines={1}>
          {value ?? label}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={toolbarStyle(theme, { iconOnly: !showToolbarLabel, open, disabled })}>
      <ToolbarGlyph size={size}>{glyph}</ToolbarGlyph>
      {showValue ? (
        <Text style={{ minWidth: 0, flexShrink: 1, color: theme.colors.foregroundMuted, fontSize: FONT_BASE }} numberOfLines={1}>
          {value ?? label}
        </Text>
      ) : null}
      {showCaret ? <Caret theme={theme} /> : null}
    </Pressable>
  );
}
