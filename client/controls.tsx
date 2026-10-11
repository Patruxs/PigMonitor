import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { buildSelectorProviders, filterAndRankOptions, filterSelectableModels, formatAgentModeLabel, formatThinkingOptionLabel, getAgentFeatureIcon, getAgentModeIcon, getAgentModeOptionIcon, getFeatureHighlightColor, getFeatureTooltip, isFeatureActive, nextModeId, resolveAgentModelSelection, resolveControlDensity, resolveControlPresentation, resolveToolbarGlyphSize, selectorOpenRefetchDecision, shortModelLabel, type ControlDensity, type ControlPresentation, type Feature, type Mode, type ProviderEntry, type SelectorProvider } from "../shared/controls.ts";
import type { Usage } from "../shared/context-meter.ts";
import { agentConfig } from "../shared/rpc.ts";
import { useLiveAgent } from "./chat/agent-live.ts";
import { useRegisterModeCycle } from "./composer-keys.tsx";
import { ContextWindowMeter } from "./context-meter.tsx";
import { Anchored, ComboList, ControlTrigger, PALETTE, SearchRow, sidebarColour, ToolbarGlyph, TooltipText, useComboKeys, type ComboOption } from "./controls-kit.tsx";
import { ProviderGlyph } from "./controls-provider-icons.tsx";
import { COMPACT_MODEL_VIEWPORT, CompactModelTrigger, DesktopModelSelector, ModelBrowserBody, useModelBrowser, type IconSvgs, type ModelBrowserState } from "./controls-model.tsx";
import { COMPACT_BELOW, SPACING } from "./kit/theme.ts";
import { messageOf } from "../shared/errors.ts";


const isNative = Platform.OS !== "web";
const DESKTOP_SEARCH_THRESHOLD = 6;
const MODE_MIN_WIDTH = 260;
const THINKING_MIN_WIDTH = 200;



interface ProvidersSnapshot {
  entries: ProviderEntry[] | undefined;
  isLoading: boolean;
  isRefreshing: boolean;
  refresh: (providers?: string[]) => Promise<void>;
  refetchIfStale: (provider?: string | null) => void;
}

function useProvidersSnapshot(cwd: string | null): ProvidersSnapshot {
  const paseo = usePaseo();
  const [entries, setEntries] = useState<ProviderEntry[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const scope = cwd?.trim() || null;
  const fetchSnapshot = useCallback(async () => {
    try {
      const result = await paseo.providers.snapshot(scope ? { cwd: scope } : undefined);
      setEntries(result.entries as ProviderEntry[]);
    } catch {
      return;
    } finally {
      setIsLoading(false);
    }
  }, [paseo, scope]);
  useEffect(() => {
    setEntries(undefined);
    setIsLoading(true);
    void fetchSnapshot();
    return paseo.providers.subscribe((update) => {
      if ((update.cwd?.trim() || null) !== scope) return;
      if (update.entries.length === 0) return void fetchSnapshot();
      setEntries(update.entries as ProviderEntry[]);
    });
  }, [paseo, scope, fetchSnapshot]);
  const refresh = useCallback(
    async (providers?: string[]) => {
      setIsRefreshing(true);
      try {
        await paseo.providers.refresh({ ...(scope ? { cwd: scope } : {}), ...(providers ? { providers } : {}) });
        await fetchSnapshot();
      } finally {
        setIsRefreshing(false);
      }
    },
    [paseo, scope, fetchSnapshot],
  );
  const refetchIfStale = useCallback(
    (provider?: string | null) => {
      if (selectorOpenRefetchDecision({ entries, selectedProvider: provider }) === "refetch-always") void fetchSnapshot();
    },
    [entries, fetchSnapshot],
  );
  return { entries, isLoading, isRefreshing, refresh, refetchIfStale };
}

function featureIconColour(theme: PluginTheme, feature: Feature): string {
  if (!isFeatureActive(feature)) return theme.colors.foregroundMuted;
  switch (getFeatureHighlightColor(feature.id)) {
    case "blue":
      return PALETTE.blue400;
    case "green":
      return PALETTE.green400;
    case "yellow":
      return PALETTE.yellow400;
    default:
      return theme.colors.foregroundMuted;
  }
}

function lucide(name: string) {
  return (size: number, color: string) => <Icon name={name} size={size} color={color} />;
}

interface ModeControlValue {
  entry: ProviderEntry | null;
  modeOptions: Mode[];
  selectedModeId: string | null | undefined;
  onSelectMode: (modeId: string) => void;
  disabled: boolean;
}

interface ControlsModel {
  theme: PluginTheme;
  provider: string;
  icons: IconSvgs;
  providers: SelectorProvider[];
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
  thinkingOptions: ComboOption[];
  selectedThinkingId: string | undefined;
  displayThinking: string;
  onSelectThinking: (id: string) => void;
  features: Feature[];
  onSetFeature: (featureId: string, value: string | boolean) => void;
  modeControl: ModeControlValue | null;
  isModelLoading: boolean;
  isRetryingProvider: boolean;
  onModelSelectorOpen: () => void;
  onRetryProvider: (provider: string) => void;
  disabled: boolean;
  glyphSize: number;
}

type OpenSelector = "thinking" | "mode" | "model" | "features" | `feature-${string}` | null;

function useFilter(open: boolean) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  return [query, setQuery] as const;
}

function DesktopCombo({ theme, open, onOpenChange, options, value, onSelect, searchable, searchPlaceholder, minWidth, leadingOf, tooltip, style, children }: { theme: PluginTheme; open: boolean; onOpenChange: (open: boolean) => void; options: ComboOption[]; value: string; onSelect: (id: string) => void; searchable: boolean; searchPlaceholder?: string; minWidth?: number; leadingOf?: (option: ComboOption) => ReactNode; tooltip?: ReactNode; style?: object; children: ReactNode }) {
  const [query, setQuery] = useFilter(open);
  const visible = searchable ? filterAndRankOptions(options, query) : options;
  const select = (id: string) => {
    onSelect(id);
    onOpenChange(false);
  };
  const keys = useComboKeys(visible, open, select, value, searchable ? query : "");
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  return (
    <Anchored theme={theme} open={open} onClose={close} onKey={keys.onKey} tooltip={tooltip} minWidth={minWidth} style={style} popover={<ComboList theme={theme} options={visible} value={value} activeIndex={keys.activeIndex} searchable={searchable} searchPlaceholder={searchPlaceholder} onSearch={setQuery} onSelect={select} leadingOf={leadingOf} emptyText="No options match your search." />}>
      {children}
    </Anchored>
  );
}

function ModeControl({ theme, value, presentation, glyphSize, open, onOpenChange }: { theme: PluginTheme; value: ModeControlValue; presentation: ControlPresentation; glyphSize: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useFilter(open);
  const selectedMode = value.modeOptions.find((m) => m.id === value.selectedModeId) ?? value.modeOptions[0];
  const all = value.modeOptions.map((m) => ({ id: m.id, label: formatAgentModeLabel(m) }));
  const q = query.trim().toLowerCase();
  const options = q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
  const select = (id: string) => {
    value.onSelectMode(id);
    onOpenChange(false);
  };
  const keys = useComboKeys(options, open, select, selectedMode?.id ?? "");
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  if (!selectedMode) return null;
  const label = formatAgentModeLabel(selectedMode);
  const leadingOf = (option: ComboOption) => {
    const icon = getAgentModeOptionIcon(value.entry, option.id);
    return icon ? <Icon name={icon} size={16} color={theme.colors.foreground} /> : null;
  };
  return (
    <Anchored theme={theme} open={open} onClose={close} onKey={keys.onKey} minWidth={MODE_MIN_WIDTH} style={{ flexShrink: presentation.showModeLabel ? 1 : 0 }} tooltip={<TooltipText theme={theme}>Change mode</TooltipText>} popover={<ComboList theme={theme} options={options} value={selectedMode.id} activeIndex={keys.activeIndex} searchable searchPlaceholder="Search modes..." onSearch={setQuery} onSelect={select} leadingOf={leadingOf} emptyText="No options match your search." />}>
      <ControlTrigger theme={theme} icon={lucide(getAgentModeIcon(value.entry, selectedMode.id))} surface="toolbar" label="Mode" value={label} showToolbarLabel={presentation.showModeLabel} showCaret={presentation.showCarets} open={open} disabled={value.disabled} glyphSize={glyphSize} onPress={() => onOpenChange(!open)} accessibilityLabel={`Select agent mode (${label})`} />
    </Anchored>
  );
}

function DesktopFeatureItem({ model, feature, open, onOpenChange }: { model: ControlsModel; feature: Feature; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { theme } = model;
  const icon = lucide(getAgentFeatureIcon(feature.icon));
  const iconColor = featureIconColour(theme, feature);
  if (feature.type === "toggle") {
    return (
      <Anchored theme={theme} open={false} onClose={() => undefined} style={{ flexShrink: 0 }} tooltip={<TooltipText theme={theme}>{getFeatureTooltip(feature)}</TooltipText>}>
        <ControlTrigger theme={theme} icon={icon} iconColor={iconColor} surface="toolbar" label={feature.label} showToolbarLabel={false} disabled={model.disabled} glyphSize={model.glyphSize} onPress={() => model.onSetFeature(feature.id, !feature.value)} accessibilityLabel={getFeatureTooltip(feature)} />
      </Anchored>
    );
  }
  const selected = feature.options.find((o) => o.id === feature.value);
  const iconOnly = feature.desktopTrigger === "icon";
  const tooltip = iconOnly ? `${feature.label}: ${selected?.label ?? feature.label}` : getFeatureTooltip(feature);
  return (
    <DesktopCombo theme={theme} open={open} onOpenChange={onOpenChange} options={feature.options.map((o) => ({ id: o.id, label: o.label }))} value={String(feature.value)} onSelect={(id) => model.onSetFeature(feature.id, id)} searchable style={{ flexShrink: iconOnly ? 0 : 1 }} tooltip={<TooltipText theme={theme}>{tooltip}</TooltipText>}>
      <ControlTrigger theme={theme} icon={icon} iconColor={iconColor} surface="toolbar" label={feature.label} value={selected?.label ?? feature.label} showToolbarLabel={!iconOnly} open={open} disabled={model.disabled} glyphSize={model.glyphSize} onPress={() => onOpenChange(!open)} accessibilityLabel={tooltip} />
    </DesktopCombo>
  );
}

function initialActiveIndex(options: ComboOption[], value: string, query: string): number {
  if (options.length === 0) return -1;
  if (query.trim()) return 0;
  const selected = options.findIndex((option) => option.id === value);
  return selected >= 0 ? selected : 0;
}

type Pushed = { kind: "model" } | { kind: "thinking" } | { kind: "mode" } | { kind: "feature"; id: string } | null;

function PushedOptions({ theme, options, value, searchable, searchPlaceholder, leadingOf, onSelect }: { theme: PluginTheme; options: ComboOption[]; value: string; searchable: boolean; searchPlaceholder?: string; leadingOf?: (option: ComboOption) => ReactNode; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const visible = searchable ? filterAndRankOptions(options, query) : options;
  return <ComboList theme={theme} options={visible} value={value} activeIndex={initialActiveIndex(visible, value, query)} sheet searchable={searchable} searchPlaceholder={searchPlaceholder} onSearch={setQuery} onSelect={onSelect} leadingOf={leadingOf} emptyText="No options match your search." />;
}

function SheetControls({ model, onPush }: { model: ControlsModel; onPush: (pushed: Pushed) => void }) {
  const { theme } = model;
  const mode = model.modeControl;
  const selectedMode = mode ? (mode.modeOptions.find((m) => m.id === mode.selectedModeId) ?? mode.modeOptions[0]) : undefined;
  return (
    <View style={{ gap: SPACING[1] }}>
      {model.thinkingOptions.length > 0 ? <ControlTrigger theme={theme} icon={lucide("Brain")} surface="sheet" label="Thinking" value={model.displayThinking} disabled={model.disabled} glyphSize={model.glyphSize} onPress={() => onPush({ kind: "thinking" })} accessibilityLabel={`Select thinking option (${model.displayThinking})`} /> : null}
      {mode && selectedMode ? <ControlTrigger theme={theme} icon={lucide(getAgentModeIcon(mode.entry, selectedMode.id))} surface="sheet" label="Mode" value={formatAgentModeLabel(selectedMode)} disabled={mode.disabled} glyphSize={model.glyphSize} onPress={() => onPush({ kind: "mode" })} accessibilityLabel={`Select agent mode (${formatAgentModeLabel(selectedMode)})`} /> : null}
      {model.features.map((feature) => (
        <ControlTrigger key={feature.id} theme={theme} icon={lucide(getAgentFeatureIcon(feature.icon))} iconColor={featureIconColour(theme, feature)} surface="sheet" label={feature.label} value={feature.type === "toggle" ? (feature.value ? "On" : "Off") : (feature.options.find((o) => o.id === feature.value)?.label ?? feature.label)} disabled={model.disabled} glyphSize={model.glyphSize} onPress={() => onPush({ kind: "feature", id: feature.id })} accessibilityLabel={getFeatureTooltip(feature)} />
      ))}
    </View>
  );
}

function pushedTitle(model: ControlsModel, pushed: Exclude<Pushed, null>, browser: ModelBrowserState): string {
  if (pushed.kind === "model") return browser.view.kind === "provider" ? browser.view.providerLabel : "Select provider";
  if (pushed.kind === "thinking") return "Thinking";
  if (pushed.kind === "mode") return "Mode";
  return model.features.find((f) => f.id === pushed.id)?.label ?? "";
}

function PushedBody({ model, pushed, browser, usesBottomSheet, onPop }: { model: ControlsModel; pushed: Exclude<Pushed, null>; browser: ModelBrowserState; usesBottomSheet: boolean; onPop: () => void }) {
  const { theme } = model;
  if (pushed.kind === "model") {
    return (
      <View style={{ flex: 1, minHeight: 0 }}>
        <SearchRow theme={theme} sheet resetKey={browser.searchResetKey} placeholder={browser.view.kind === "all" ? "Search all models..." : "Search models..."} onChange={browser.setSearchQuery} onFocus={() => browser.setSearchFocused(true)} onBlur={() => browser.setSearchFocused(false)} autoFocus={!isNative && !usesBottomSheet} />
        <ModelBrowserBody
          theme={theme}
          state={browser}
          icons={model.icons}
          searchAllOnFocus
          onSelect={(_provider, modelId) => {
            model.onSelectModel(modelId);
            onPop();
          }}
          onRetryProvider={model.onRetryProvider}
          isRetryingProvider={model.isRetryingProvider}
        />
      </View>
    );
  }
  if (pushed.kind === "thinking") {
    return (
      <PushedOptions
        theme={theme}
        options={model.thinkingOptions}
        value={model.selectedThinkingId ?? ""}
        searchable={false}
        leadingOf={() => <Icon name="Brain" size={16} color={theme.colors.foreground} />}
        onSelect={(id) => {
          model.onSelectThinking(id);
          onPop();
        }}
      />
    );
  }
  if (pushed.kind === "mode" && model.modeControl) {
    const mode = model.modeControl;
    const selected = mode.modeOptions.find((m) => m.id === mode.selectedModeId) ?? mode.modeOptions[0];
    return (
      <ModeSheetOptions
        theme={theme}
        mode={mode}
        value={selected?.id ?? ""}
        onSelect={(id) => {
          mode.onSelectMode(id);
          onPop();
        }}
      />
    );
  }
  const feature = pushed.kind === "feature" ? model.features.find((f) => f.id === pushed.id) : undefined;
  if (!feature) return null;
  const options = feature.type === "select" ? feature.options.map((o) => ({ id: o.id, label: o.label })) : [{ id: "true", label: "On" }, { id: "false", label: "Off" }];
  return (
    <PushedOptions
      theme={theme}
      options={options}
      value={String(feature.value)}
      searchable={feature.type === "select"}
      onSelect={(id) => {
        model.onSetFeature(feature.id, feature.type === "toggle" ? id === "true" : id);
        onPop();
      }}
    />
  );
}

function ModeSheetOptions({ theme, mode, value, onSelect }: { theme: PluginTheme; mode: ModeControlValue; value: string; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const all = mode.modeOptions.map((m) => ({ id: m.id, label: formatAgentModeLabel(m) }));
  const q = query.trim().toLowerCase();
  const options = q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
  const leadingOf = (option: ComboOption) => {
    const icon = getAgentModeOptionIcon(mode.entry, option.id);
    return icon ? <Icon name={icon} size={16} color={theme.colors.foreground} /> : null;
  };
  return <ComboList theme={theme} options={options} value={value} activeIndex={initialActiveIndex(options, value, query)} sheet searchable searchPlaceholder="Search modes..." onSearch={setQuery} onSelect={onSelect} leadingOf={leadingOf} emptyText="No options match your search." />;
}

function SheetModal({ model, title, open, onClose, browser, usesBottomSheet, pushed, setPushed, children }: { model: ControlsModel; title: string; open: boolean; onClose: () => void; browser: ModelBrowserState; usesBottomSheet: boolean; pushed: Pushed; setPushed: (pushed: Pushed) => void; children: ReactNode }) {
  const { theme } = model;
  const pop = () => {
    if (pushed?.kind === "model") browser.reset();
    setPushed(null);
  };
  return (
    <Modal title={pushed ? pushedTitle(model, pushed, browser) : title} icon={pushed?.kind === "model" && browser.view.kind === "provider" ? <ProviderGlyph provider={browser.view.providerId} iconSvg={model.icons[browser.view.providerId]} size={16} color={theme.colors.foreground} /> : undefined} open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content scrollable={!usesBottomSheet} contentContainerStyle={{ padding: 0, gap: 0 }}>
        {pushed ? (
          <View style={{ minHeight: 0, flexShrink: 1 }}>
            <Pressable onPress={pop} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back" style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingHorizontal: SPACING[3], paddingVertical: SPACING[2] }}>
              {({ pressed }) => <Icon name="ArrowLeft" size={16} color={pressed ? theme.colors.foreground : theme.colors.foregroundMuted} />}
            </Pressable>
            <PushedBody model={model} pushed={pushed} browser={browser} usesBottomSheet={usesBottomSheet} onPop={pop} />
          </View>
        ) : (
          children
        )}
      </Modal.Content>
    </Modal>
  );
}

function CompactControls({ model }: { model: ControlsModel }) {
  const { theme } = model;
  const { width } = useWindowDimensions();
  const usesBottomSheet = width < COMPACT_BELOW;
  const [isOpen, setIsOpen] = useState(false);
  const [pushed, setPushed] = useState<Pushed>(null);
  const rootBrowser = useModelBrowser({ providers: model.providers, selectedProvider: model.provider, selectedModel: model.selectedModelId, isLoading: model.isModelLoading });
  const modelBrowser = useModelBrowser({ providers: model.providers, selectedProvider: model.provider, selectedModel: model.selectedModelId, isLoading: model.isModelLoading });
  const close = () => {
    setPushed(null);
    setIsOpen(false);
    rootBrowser.reset();
    modelBrowser.reset();
  };
  const open = () => {
    rootBrowser.showAll();
    setIsOpen(true);
    model.onModelSelectorOpen();
  };
  const push = (next: Pushed) => {
    if (next?.kind === "model") {
      const provider = model.providers.find((entry) => entry.id === model.provider) ?? model.providers[0];
      if (provider) modelBrowser.drillDown(provider.id, provider.label);
      else modelBrowser.showAll();
    }
    setPushed(next);
  };
  const controls = <SheetControls model={model} onPush={push} />;
  const controlsContent = <View style={{ paddingHorizontal: SPACING[2], paddingTop: SPACING[3], paddingBottom: SPACING[3], gap: SPACING[1] }}>{usesBottomSheet ? <><ControlTrigger theme={theme} icon={(size, color) => <ModelGlyph model={model} size={size} color={color} />} surface="sheet" label="Model" value={rootBrowser.selectedModelLabel} disabled={model.disabled} glyphSize={model.glyphSize} onPress={() => push({ kind: "model" })} accessibilityLabel={`Select model (${rootBrowser.selectedModelLabel})`} />{controls}</> : controls}</View>;
  const thinkingLabel = model.thinkingOptions.length > 0 ? model.displayThinking : null;
  return (
    <>
      <CompactModelTrigger theme={theme} label={shortModelLabel(rootBrowser.selectedModelLabel)} thinkingLabel={thinkingLabel} provider={model.provider} icons={model.icons} glyphSize={model.glyphSize} open={isOpen} disabled={model.disabled} onPress={() => (isOpen ? close() : open())} />
      <SheetModal model={model} title="Select model" open={isOpen} onClose={close} browser={modelBrowser} usesBottomSheet={usesBottomSheet} pushed={pushed} setPushed={setPushed}>
        <SearchRow theme={theme} sheet resetKey={rootBrowser.searchResetKey} placeholder="Search models..." onChange={rootBrowser.setSearchQuery} onFocus={() => rootBrowser.setSearchFocused(true)} onBlur={() => rootBrowser.setSearchFocused(false)} autoFocus={!isNative && !usesBottomSheet} />
        <View style={[{ overflow: "hidden", backgroundColor: sidebarColour(theme) }, usesBottomSheet ? { flex: 1, minHeight: 0 } : { height: COMPACT_MODEL_VIEWPORT, minHeight: COMPACT_MODEL_VIEWPORT }]}>
          <ModelBrowserBody
            theme={theme}
            state={rootBrowser}
            icons={model.icons}
            searchAllOnFocus={usesBottomSheet}
            rootBrowseContent={usesBottomSheet ? controlsContent : undefined}
            onSelect={(_provider, modelId) => {
              model.onSelectModel(modelId);
              if (usesBottomSheet) rootBrowser.showAll();
              else close();
            }}
            onRetryProvider={model.onRetryProvider}
            isRetryingProvider={model.isRetryingProvider}
          />
        </View>
        {!usesBottomSheet ? (
          <>
            <View style={{ height: 1, flexShrink: 0, backgroundColor: theme.colors.border }} />
            {controlsContent}
          </>
        ) : null}
      </SheetModal>
    </>
  );
}

function ModelGlyph({ model, size, color }: { model: ControlsModel; size: number; color: string }) {
  return <ProviderGlyph provider={model.provider} iconSvg={model.icons[model.provider]} size={size} color={color} />;
}

function FeaturesSheet({ model, open, onClose }: { model: ControlsModel; open: boolean; onClose: () => void }) {
  const [pushed, setPushed] = useState<Pushed>(null);
  const browser = useModelBrowser({ providers: model.providers, selectedProvider: model.provider, selectedModel: model.selectedModelId, isLoading: model.isModelLoading });
  const close = () => {
    setPushed(null);
    onClose();
  };
  return (
    <SheetModal model={model} title="Features" open={open} onClose={close} browser={browser} usesBottomSheet={false} pushed={pushed} setPushed={setPushed}>
      <View style={{ padding: SPACING[4], gap: SPACING[1] }}>
        <SheetControls model={{ ...model, thinkingOptions: [], modeControl: null }} onPush={setPushed} />
      </View>
    </SheetModal>
  );
}

function DesktopControls({ model, presentation, openSelector, setOpenSelector }: { model: ControlsModel; presentation: ControlPresentation; openSelector: OpenSelector; setOpenSelector: (next: OpenSelector) => void }) {
  const { theme } = model;
  const openChange = (selector: Exclude<OpenSelector, null>) => (next: boolean) => setOpenSelector(next ? selector : null);
  return (
    <>
      <DesktopModelSelector theme={theme} providers={model.providers} selectedProvider={model.provider} selectedModel={model.selectedModelId} icons={model.icons} isLoading={model.isModelLoading} disabled={model.disabled} glyphSize={model.glyphSize} showCaret={presentation.showCarets} onSelect={(_provider, modelId) => model.onSelectModel(modelId)} onOpen={model.onModelSelectorOpen} onRetryProvider={model.onRetryProvider} isRetryingProvider={model.isRetryingProvider} tooltip={<TooltipText theme={theme}>Change model</TooltipText>} />
      {model.thinkingOptions.length > 0 ? (
        <DesktopCombo theme={theme} open={openSelector === "thinking"} onOpenChange={openChange("thinking")} options={model.thinkingOptions} value={model.selectedThinkingId ?? ""} onSelect={model.onSelectThinking} searchable={model.thinkingOptions.length > DESKTOP_SEARCH_THRESHOLD} minWidth={THINKING_MIN_WIDTH} leadingOf={() => <Icon name="Brain" size={16} color={theme.colors.foreground} />} style={{ flexShrink: presentation.showThinkingLabel ? 1 : 0 }} tooltip={<TooltipText theme={theme}>Thinking mode</TooltipText>}>
          <ControlTrigger theme={theme} icon={lucide("Brain")} surface="toolbar" label="Thinking" value={model.displayThinking} showToolbarLabel={presentation.showThinkingLabel} showCaret={presentation.showCarets} open={openSelector === "thinking"} disabled={model.disabled} glyphSize={model.glyphSize} onPress={() => openChange("thinking")(openSelector !== "thinking")} accessibilityLabel={`Select thinking option (${model.displayThinking})`} />
        </DesktopCombo>
      ) : null}
      {model.modeControl ? <ModeControl theme={theme} value={model.modeControl} presentation={presentation} glyphSize={model.glyphSize} open={openSelector === "mode"} onOpenChange={openChange("mode")} /> : null}
      {presentation.aggregateFeatures && model.features.length > 0 ? (
        <>
          <Pressable onPress={() => setOpenSelector("features")} disabled={model.disabled} accessibilityRole="button" accessibilityLabel="Open agent features" style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: 9999 }}>
            <ToolbarGlyph size={model.glyphSize}>
              <Icon name="Settings2" size={model.glyphSize} color={theme.colors.foregroundMuted} />
            </ToolbarGlyph>
          </Pressable>
          <FeaturesSheet model={model} open={openSelector === "features"} onClose={() => setOpenSelector(null)} />
        </>
      ) : (
        model.features.map((feature) => <DesktopFeatureItem key={feature.id} model={model} feature={feature} open={openSelector === `feature-${feature.id}`} onOpenChange={openChange(`feature-${feature.id}`)} />)
      )}
    </>
  );
}

function ControlledAgentControls({ model, isCompact }: { model: ControlsModel; isCompact: boolean }) {
  const { fontScale } = useWindowDimensions();
  const initial: ControlDensity = isCompact ? "tight" : "full";
  const [density, setDensity] = useState<ControlDensity>(initial);
  const densityRef = useRef<ControlDensity>(initial);
  const widthRef = useRef(0);
  const [openSelector, setOpenSelector] = useState<OpenSelector>(null);
  const presence = useMemo(
    () => ({
      hasModel: true,
      hasThinking: model.thinkingOptions.length > 0,
      hasMode: model.modeControl !== null,
      features: model.features.map((feature) => (feature.type === "toggle" ? { type: "toggle" as const } : { type: "select" as const, label: feature.options.find((o) => o.id === feature.value)?.label ?? feature.label })),
      fontScale,
    }),
    [model.thinkingOptions.length, model.modeControl !== null, model.features, fontScale],
  );
  const update = useCallback(
    (availableWidth: number) => {
      const next = resolveControlDensity({ availableWidth, currentDensity: densityRef.current, controls: presence });
      if (next === densityRef.current) return;
      densityRef.current = next;
      setDensity(next);
    },
    [presence],
  );
  useEffect(() => {
    if (widthRef.current > 0) update(widthRef.current);
  }, [update]);
  const onLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width <= 0) return;
    widthRef.current = width;
    update(width);
  };
  const presentation = resolveControlPresentation(density);
  return (
    <View onLayout={onLayout} style={{ minWidth: 0, flexGrow: 1, flexShrink: 1, flexDirection: "row", alignItems: "center", gap: SPACING[1] }}>
      {isCompact ? <CompactControls model={model} /> : <DesktopControls model={model} presentation={presentation} openSelector={openSelector} setOpenSelector={setOpenSelector} />}
    </View>
  );
}

export function AgentControls({ theme, agentId, isCompactLayout: isCompact }: { theme: PluginTheme; agentId: string; isCompactLayout: boolean }) {
  const call = useRpc(agentConfig);
  const toast = useToast();
  const { agent, refresh: refreshAgent } = useLiveAgent(agentId);
  const snapshot = useProvidersSnapshot(agent?.cwd ?? null);
  const provider = agent?.provider ?? "";
  const entry = useMemo(() => snapshot.entries?.find((e) => e.provider === provider) ?? null, [snapshot.entries, provider]);
  const models = filterSelectableModels(entry?.models ?? null);
  const providers = useMemo(() => (entry ? buildSelectorProviders([entry]) : []), [entry]);
  const icons = useMemo<IconSvgs>(() => Object.fromEntries((snapshot.entries ?? []).map((e) => [e.provider, e.iconSvg])), [snapshot.entries]);
  const send = useCallback(
    async (input: { field: "model" | "mode" | "thinking" | "feature"; value: string | boolean | null; featureId?: string }) => {
      try {
        const r = await call({ agentId, ...input });
        void refreshAgent();
        if (!r.ok) return toast.error(r.error);
        const notice = r.notice;
        if (!notice) return;
        if (notice.type === "error") toast.error(notice.message);
        else toast.show(notice.message, { variant: notice.type, durationMs: notice.type === "warning" ? 5000 : undefined });
      } catch (error) {
        toast.error(messageOf(error));
      }
    },
    [agentId, call, toast, refreshAgent],
  );
  const cycleModes = (agent?.availableModes ?? []) as Mode[];
  const nextMode = agent ? nextModeId(cycleModes, agent.currentModeId) : null;
  useRegisterModeCycle(nextMode ? () => void send({ field: "mode", value: nextMode }) : null);
  if (!agent) return null;
  const selection = resolveAgentModelSelection({ models, runtimeModelId: agent.runtimeInfo?.model ?? null, configuredModelId: agent.model, runtimeThinkingOptionId: agent.runtimeInfo?.thinkingOptionId ?? null, explicitThinkingOptionId: agent.thinkingOptionId });
  const thinkingOptions = (selection.thinkingOptions ?? []).map((option) => ({ id: option.id, label: formatThinkingOptionLabel(option) }));
  const availableModes = (agent.availableModes ?? []) as Mode[];
  const modeControl: ModeControlValue | null = availableModes.length > 0 ? { entry, modeOptions: availableModes, selectedModeId: agent.currentModeId, onSelectMode: (modeId) => void send({ field: "mode", value: modeId }), disabled: false } : null;
  const model: ControlsModel = {
    theme,
    provider: agent.provider,
    icons,
    providers,
    selectedModelId: selection.activeModelId ?? "",
    onSelectModel: (modelId) => void send({ field: "model", value: modelId }),
    thinkingOptions,
    selectedThinkingId: selection.selectedThinkingId ?? undefined,
    displayThinking: thinkingOptions.find((o) => o.id === selection.selectedThinkingId)?.label ?? thinkingOptions[0]?.label ?? "Unknown",
    onSelectThinking: (id) => void send({ field: "thinking", value: id }),
    features: (agent.features ?? []) as Feature[],
    onSetFeature: (featureId, value) => void send({ field: "feature", featureId, value }),
    modeControl,
    isModelLoading: snapshot.isLoading || entry?.status === "loading",
    isRetryingProvider: snapshot.isRefreshing,
    onModelSelectorOpen: () => snapshot.refetchIfStale(agent.provider),
    onRetryProvider: (id) => void snapshot.refresh([id]),
    disabled: false,
    glyphSize: resolveToolbarGlyphSize(isNative ? "native" : "web"),
  };
  return <ControlledAgentControls model={model} isCompact={isCompact} />;
}

export function AgentContextMeter({ theme, agentId, isCompactLayout }: { theme: PluginTheme; agentId: string; isCompactLayout: boolean }) {
  const { agent } = useLiveAgent(agentId);
  if (!agent) return null;
  return (
    <View style={{ width: 28, height: 28, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
      <ContextWindowMeter theme={theme} agentId={agentId} usage={(agent.lastUsage ?? null) as Usage | null} status={agent.status} glyphSize={isCompactLayout || !isNative ? 16 : 20} />
    </View>
  );
}
