import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { filterAndRankModelRows, normalizeSearchQuery, providerModelRows, providerQualifiedDescription, resolveDesktopFixedHeight, resolveInitialModelBrowserView, resolveModelBrowserAllView, resolveSelectedModelLabel, type ModelBrowserView, type ModelRow, type SelectorProvider } from "./model-selection.ts";
import { LABELS } from "./control-options.ts";
import { Anchored, FONT_BASE, FONT_SM, HeaderRow, hoveredOf, SearchRow, ToolbarGlyph, toolbarStyle, Caret } from "./controls-kit.tsx";
import { ProviderGlyph } from "./controls-provider-icons.tsx";
import { hostColours, SPACING } from "../kit/theme.ts";
import { isWeb } from "../kit/platform.ts";

const DESKTOP_MIN_WIDTH = 360;
const MODEL_LIST_TOP_INSET = 4;
const MODEL_ROW_STRIDE = 44;
const MODEL_VIEWPORT_VISIBLE_ROWS = 4.5;
const FIXED_MODEL_VIEWPORT_HEIGHT = MODEL_LIST_TOP_INSET + MODEL_ROW_STRIDE * MODEL_VIEWPORT_VISIBLE_ROWS;

export type IconSvgs = Record<string, string | undefined>;

export interface ModelBrowserState {
  providers: SelectorProvider[];
  selectedProvider: string;
  selectedModel: string;
  view: ModelBrowserView;
  searchQuery: string;
  isSearchFocused: boolean;
  searchResetKey: number;
  selectedModelLabel: string;
  desktopFixedHeight: number;
  setSearchQuery: (value: string) => void;
  setSearchFocused: (value: boolean) => void;
  prepareToOpen: () => void;
  showAll: () => void;
  reset: () => void;
  drillDown: (providerId: string, providerLabel: string) => void;
}

export function useModelBrowser({ providers, selectedProvider, selectedModel, isLoading }: { providers: SelectorProvider[]; selectedProvider: string; selectedModel: string; isLoading: boolean }): ModelBrowserState {
  const [view, setView] = useState<ModelBrowserView>({ kind: "all" });
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setSearchFocused] = useState(false);
  const [searchResetKey, setSearchResetKey] = useState(0);
  const reset = useCallback(() => {
    setSearchQuery("");
    setSearchFocused(false);
    setSearchResetKey((key) => key + 1);
  }, []);
  const initialView = useMemo(() => resolveInitialModelBrowserView({ providers, selectedProvider, selectedModel }), [providers, selectedProvider, selectedModel]);
  return {
    providers,
    selectedProvider,
    selectedModel,
    view,
    searchQuery,
    isSearchFocused,
    searchResetKey,
    selectedModelLabel: resolveSelectedModelLabel({ providers, selectedProvider, selectedModel, isLoading }),
    desktopFixedHeight: resolveDesktopFixedHeight(view, providers),
    setSearchQuery,
    setSearchFocused,
    prepareToOpen: () => setView(initialView),
    showAll: () => {
      setView({ kind: "all" });
      reset();
    },
    reset,
    drillDown: (providerId, providerLabel) => {
      setView({ kind: "provider", providerId, providerLabel });
      reset();
    },
  };
}

function BrowserHeader({ theme, state, icons, autoFocus, searchPlaceholder }: { theme: PluginTheme; state: ModelBrowserState; icons: IconSvgs; autoFocus: boolean; searchPlaceholder?: string }) {
  const { view } = state;
  const singleProviderView = state.providers.length === 1;
  return (
    <View>
      {view.kind === "provider" ? <HeaderRow theme={theme} title={view.providerLabel} leading={<ProviderGlyph provider={view.providerId} iconSvg={icons[view.providerId]} size={16} color={theme.colors.foreground} />} onBack={singleProviderView ? undefined : state.showAll} /> : null}
      <SearchRow
        theme={theme}
        resetKey={`${view.kind === "provider" ? view.providerId : "all"}:${state.searchResetKey}`}
        placeholder={searchPlaceholder ?? (view.kind === "all" ? "Search all models..." : "Search models...")}
        onChange={state.setSearchQuery}
        onFocus={() => state.setSearchFocused(true)}
        onBlur={() => state.setSearchFocused(false)}
        autoFocus={autoFocus}
      />
    </View>
  );
}

function EmptyState({ theme, icon, text, children }: { theme: PluginTheme; icon: string; text: string; children?: ReactNode }) {
  return (
    <View style={{ paddingVertical: SPACING[4], alignItems: "center", gap: SPACING[2] }}>
      <Icon name={icon} size={16} color={theme.colors.foregroundMuted} />
      <Text style={{ fontSize: FONT_BASE, color: theme.colors.foregroundMuted }}>{text}</Text>
      {children}
    </View>
  );
}

function BrowserRow({ theme, label, description, leading, trailing, selected, selectionIndicator, onPress, elevated }: { theme: PluginTheme; label: string; description?: string; leading: ReactNode; trailing?: ReactNode; selected?: boolean; selectionIndicator?: boolean; onPress: () => void; elevated?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={selectionIndicator ? { selected: selected === true } : undefined} style={(state) => ({ flexDirection: "row", paddingVertical: SPACING[2], minHeight: 36, marginBottom: isWeb ? 0 : SPACING[1], backgroundColor: hoveredOf(state) ? (elevated ? theme.colors.surface2 : theme.colors.surface1) : state.pressed ? (elevated ? theme.colors.surface2 : theme.colors.surface1) : "transparent" })}>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingHorizontal: isWeb ? SPACING[3] : SPACING[6] }}>
        <View style={{ width: 16, alignItems: "center", justifyContent: "center" }}>{leading}</View>
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
        {selectionIndicator || trailing ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1], marginLeft: "auto" }}>
            {selectionIndicator ? <View style={{ width: 16, alignItems: "center", justifyContent: "center" }}>{selected ? <Icon name="Check" size={14} color={theme.colors.foregroundMuted} /> : null}</View> : null}
            {trailing}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function ModelRows({ theme, rows, state, icons, showProviderLabel, onSelect }: { theme: PluginTheme; rows: ModelRow[]; state: ModelBrowserState; icons: IconSvgs; showProviderLabel?: boolean; onSelect: (provider: string, modelId: string) => void }) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: SPACING[1], paddingBottom: SPACING[8] }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {rows.map((row) => (
        <BrowserRow key={row.key} theme={theme} label={row.modelLabel} description={showProviderLabel ? providerQualifiedDescription(row) : row.description} leading={<ProviderGlyph provider={row.provider} iconSvg={icons[row.provider]} size={14} color={theme.colors.foregroundMuted} />} selected={row.provider === state.selectedProvider && row.modelId === state.selectedModel} selectionIndicator onPress={() => onSelect(row.provider, row.modelId)} />
      ))}
    </ScrollView>
  );
}

function ProviderRows({ theme, state, icons }: { theme: PluginTheme; state: ModelBrowserState; icons: IconSvgs }) {
  return (
    <View>
      {state.providers.map((provider, index) => {
        const selection = provider.modelSelection;
        const count = selection.kind === "models" ? selection.rows.length : 0;
        const stateNode =
          selection.kind === "models" ? (
            <Text style={{ fontSize: FONT_SM, color: theme.colors.foregroundMuted }}>{count === 1 ? `${count} model` : `${count} models`}</Text>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1], flexShrink: 1, minWidth: 0 }}>
              <Icon name={selection.kind === "loading" ? "Loader" : "TriangleAlert"} size={14} color={theme.colors.foregroundMuted} />
              <Text style={{ fontSize: FONT_SM, color: theme.colors.foregroundMuted }}>{selection.kind === "loading" ? "Loading" : LABELS.error}</Text>
            </View>
          );
        return (
          <View key={provider.id}>
            {index > 0 ? <View style={{ height: 1, backgroundColor: theme.colors.border }} /> : null}
            <BrowserRow
              theme={theme}
              elevated
              label={provider.label}
              leading={<ProviderGlyph provider={provider.id} iconSvg={icons[provider.id]} size={14} color={theme.colors.foregroundMuted} />}
              trailing={
                <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1] }}>
                  {stateNode}
                  <Icon name="ChevronRight" size={14} color={theme.colors.foregroundMuted} />
                </View>
              }
              onPress={() => state.drillDown(provider.id, provider.label)}
            />
          </View>
        );
      })}
    </View>
  );
}

export function ModelBrowserBody({ theme, state, icons, onSelect, onRetryProvider, isRetryingProvider, searchAllOnFocus = false, rootBrowseContent }: { theme: PluginTheme; state: ModelBrowserState; icons: IconSvgs; onSelect: (provider: string, modelId: string) => void; onRetryProvider?: (provider: string) => void; isRetryingProvider: boolean; searchAllOnFocus?: boolean; rootBrowseContent?: ReactNode }) {
  const normalizedQuery = normalizeSearchQuery(state.searchQuery);
  const { view } = state;
  if (view.kind === "provider") {
    const provider = state.providers.find((entry) => entry.id === view.providerId) ?? null;
    if (!provider) return <EmptyState theme={theme} icon="Search" text="No models match your search" />;
    const selection = provider.modelSelection;
    if (selection.kind === "loading") return <EmptyState theme={theme} icon="Loader" text="Loading" />;
    if (selection.kind === "error")
      return (
        <EmptyState theme={theme} icon="TriangleAlert" text={selection.message}>
          {onRetryProvider ? (
            <Pressable onPress={() => onRetryProvider(view.providerId)} disabled={isRetryingProvider} accessibilityRole="button" style={(s) => ({ paddingHorizontal: SPACING[3], paddingVertical: SPACING[1.5], borderRadius: 8, backgroundColor: s.pressed || hoveredOf(s) ? theme.colors.surface2 : theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border, opacity: isRetryingProvider ? 0.5 : 1 })}>
              <Text style={{ fontSize: FONT_BASE, color: theme.colors.foreground }}>{isRetryingProvider ? "Retrying..." : "Retry"}</Text>
            </Pressable>
          ) : null}
        </EmptyState>
      );
    const rows = filterAndRankModelRows(providerModelRows(provider), normalizedQuery);
    if (rows.length === 0) return <EmptyState theme={theme} icon="Search" text="No models match your search" />;
    return <ModelRows theme={theme} rows={rows} state={state} icons={icons} onSelect={onSelect} />;
  }
  const allView = resolveModelBrowserAllView({ providers: state.providers, normalizedQuery, isSearchFocused: searchAllOnFocus && state.isSearchFocused });
  if (allView.kind === "noSearchMatches") return <EmptyState theme={theme} icon="Search" text={`No models match "${state.searchQuery.trim()}"`} />;
  if (allView.kind === "searchResults") return <ModelRows theme={theme} rows={allView.rows} state={state} icons={icons} showProviderLabel onSelect={onSelect} />;
  const hasResults = state.providers.length > 0 || rootBrowseContent != null;
  return (
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {rootBrowseContent ?? (state.providers.length > 0 ? <ProviderRows theme={theme} state={state} icons={icons} /> : null)}
      {!hasResults ? <EmptyState theme={theme} icon="Search" text="No models match your search" /> : null}
    </ScrollView>
  );
}

export function DesktopModelSelector({ theme, providers, selectedProvider, selectedModel, icons, isLoading, disabled, glyphSize, showCaret, onSelect, onOpen, onClose, onRetryProvider, isRetryingProvider, tooltip }: { theme: PluginTheme; providers: SelectorProvider[]; selectedProvider: string; selectedModel: string; icons: IconSvgs; isLoading: boolean; disabled: boolean; glyphSize: number; showCaret: boolean; onSelect: (provider: string, modelId: string) => void; onOpen?: () => void; onClose?: () => void; onRetryProvider?: (provider: string) => void; isRetryingProvider: boolean; tooltip: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const browser = useModelBrowser({ providers, selectedProvider, selectedModel, isLoading });
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      browser.prepareToOpen();
      onOpen?.();
      return;
    }
    browser.reset();
    onClose?.();
  };
  const close = () => handleOpenChange(false);
  const popover = (
    <>
      <BrowserHeader theme={theme} state={browser} icons={icons} autoFocus={isWeb} />
      <View style={{ flex: 1, minHeight: 0 }}>
        <ModelBrowserBody
          theme={theme}
          state={browser}
          icons={icons}
          onSelect={(provider, modelId) => {
            onSelect(provider, modelId);
            handleOpenChange(false);
          }}
          onRetryProvider={onRetryProvider}
          isRetryingProvider={isRetryingProvider}
        />
      </View>
    </>
  );
  return (
    <Anchored theme={theme} open={isOpen} onClose={close} tooltip={tooltip} popover={popover} popoverWidth={Math.max(DESKTOP_MIN_WIDTH, width)} fixedHeight={browser.desktopFixedHeight} style={{ flexShrink: 1 }}>
      <Pressable onLayout={(e) => setWidth(e.nativeEvent.layout.width)} onPress={() => handleOpenChange(!isOpen)} disabled={disabled} accessibilityRole="button" accessibilityLabel={`Select model (${browser.selectedModelLabel})`} style={toolbarStyle(theme, { open: isOpen, disabled })}>
        {selectedProvider.trim().length > 0 ? (
          <ToolbarGlyph size={glyphSize}>
            <ProviderGlyph provider={selectedProvider} iconSvg={icons[selectedProvider]} size={glyphSize} color={theme.colors.foregroundMuted} />
          </ToolbarGlyph>
        ) : null}
        <Text style={{ minWidth: 0, flexShrink: 1, color: theme.colors.foregroundMuted, fontSize: FONT_BASE }} numberOfLines={1} ellipsizeMode="tail">
          {browser.selectedModelLabel}
        </Text>
        {showCaret ? <Caret theme={theme} /> : null}
      </Pressable>
    </Anchored>
  );
}

export function CompactModelTrigger({ theme, label, thinkingLabel, provider, icons, glyphSize, open, disabled, onPress }: { theme: PluginTheme; label: string; thinkingLabel: string | null; provider: string; icons: IconSvgs; glyphSize: number; open: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={`Select model (${label})`} style={toolbarStyle(theme, { open, disabled })}>
      {provider.trim().length > 0 ? (
        <ToolbarGlyph size={glyphSize}>
          <ProviderGlyph provider={provider} iconSvg={icons[provider]} size={glyphSize} color={theme.colors.foregroundMuted} />
        </ToolbarGlyph>
      ) : null}
      <View style={{ minWidth: 0, flexShrink: 1, flexDirection: "row", alignItems: "center", gap: SPACING[1] }}>
        <Text style={{ minWidth: 0, flexShrink: 1, color: theme.colors.foregroundMuted, fontSize: FONT_BASE }} numberOfLines={1}>
          {label}
        </Text>
        {thinkingLabel ? (
          <Text style={{ flexShrink: 0, color: hostColours(theme).foregroundExtraMuted, fontSize: FONT_BASE }} numberOfLines={1}>
            {thinkingLabel}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export const COMPACT_MODEL_VIEWPORT = FIXED_MODEL_VIEWPORT_HEIGHT;
