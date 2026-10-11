import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import {
  applyFileMentionReplacement,
  applySlashCommandReplacement,
  fallbackIndex,
  filterAndRankCommands,
  findActiveFileMention,
  findActiveSlashCommand,
  inlineSkillCommands,
  nextActiveIndex,
  orderAboveInput,
  type AgentSlashCommand,
  type DirectoryEntry,
} from "../../shared/autocomplete.ts";
import { dirSuggest } from "../../shared/rpc.ts";
import { hostColours, RADIUS, SPACING } from "../kit/theme.ts";
import { boundedMap } from "../../shared/bounded-map.ts";
import { messageOf } from "../../shared/errors.ts";

const COMMAND_CACHE_LIMIT = 50;
const DIRECTORY_CACHE_LIMIT = 100;

interface AutocompleteOption {
  id: string;
  label: string;
  detail?: string;
  description?: string;
  kind: "command" | "file" | "directory";
  entryPath?: string;
}

interface AgentAutocomplete {
  isVisible: boolean;
  options: AutocompleteOption[];
  selectedIndex: number;
  isLoading: boolean;
  errorMessage?: string;
  loadingText: string;
  emptyText: string;
  onSelectOption: (option: AutocompleteOption) => void;
  onKeyPress: (event: { key: string; preventDefault: () => void }) => boolean;
}

const SESSION_COMMANDS_STALE_MS = 60_000;
const DIRECTORY_STALE_MS = 15_000;
const FILE_QUERY_DEBOUNCE_MS = 180;
const LIST_MAX_HEIGHT = 220;
const POPOVER_OFFSET = SPACING[3];
const BOLT_GLYPH_PATTERN = /⚡|️/gu;

type Loaded<T> = { at: number; value: T } | { at: number; error: string };

const commandCache = boundedMap<string, Loaded<AgentSlashCommand[]>>(COMMAND_CACHE_LIMIT);
const directoryCache = boundedMap<string, Loaded<DirectoryEntry[]>>(DIRECTORY_CACHE_LIMIT);


function useCommands(agentId: string | undefined, enabled: boolean): { commands: AgentSlashCommand[]; isLoading: boolean; error: string | null } {
  const paseo = usePaseo();
  const [, setTick] = useState(0);
  const cached = agentId ? commandCache.get(agentId) : undefined;
  const fresh = cached !== undefined && Date.now() - cached.at < SESSION_COMMANDS_STALE_MS;
  useEffect(() => {
    if (!enabled || !agentId || fresh) return;
    let current = true;
    void paseo.agents
      .ref(agentId)
      .commands()
      .then(
        (r) => commandCache.set(agentId, { at: Date.now(), value: r.commands as AgentSlashCommand[] }),
        (error: unknown) => commandCache.set(agentId, { at: Date.now(), error: messageOf(error) }),
      )
      .then(() => current && setTick((n) => n + 1));
    return () => {
      current = false;
    };
  }, [enabled, agentId, fresh]);
  if (!cached) return { commands: [], isLoading: true, error: null };
  if ("error" in cached) return { commands: [], isLoading: false, error: cached.error };
  return { commands: cached.value, isLoading: false, error: null };
}

function useDirectorySuggestions(cwd: string | undefined, query: string, enabled: boolean): { entries: DirectoryEntry[]; isLoading: boolean; error: string | null } {
  const call = useRpc(dirSuggest);
  const [debounced, setDebounced] = useState(query);
  const [, setTick] = useState(0);
  const previous = useRef<DirectoryEntry[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), FILE_QUERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const key = `${cwd ?? ""}\u0000${debounced}`;
  const cached = directoryCache.get(key);
  const fresh = cached !== undefined && Date.now() - cached.at < DIRECTORY_STALE_MS;
  useEffect(() => {
    if (!enabled || !cwd || fresh) return;
    let current = true;
    void call({ cwd, query: debounced })
      .then(
        (r) => directoryCache.set(key, r.ok ? { at: Date.now(), value: r.entries } : { at: Date.now(), error: r.error }),
        (error: unknown) => directoryCache.set(key, { at: Date.now(), error: messageOf(error) }),
      )
      .then(() => current && setTick((n) => n + 1));
    return () => {
      current = false;
    };
  }, [enabled, cwd, key, fresh]);
  if (cached && "value" in cached) previous.current = cached.value;
  if (cached && "error" in cached) return { entries: [], isLoading: false, error: cached.error };
  return { entries: cached ? cached.value : previous.current, isLoading: !cached, error: null };
}

export function useAgentAutocomplete({ text, cursor, agentId, cwd, setText, onApplied }: { text: string; cursor: number; agentId: string | undefined; cwd: string | undefined; setText: (text: string) => void; onApplied: () => void }): AgentAutocomplete {
  const cursorIndex = Math.min(cursor, text.length);
  const slashCommand = useMemo(() => findActiveSlashCommand(text, cursorIndex), [text, cursorIndex]);
  const fileMention = useMemo(() => findActiveFileMention(text, cursorIndex), [text, cursorIndex]);
  const mode = fileMention ? "file" : slashCommand ? "command" : null;
  const canShow = mode === "command" ? Boolean(agentId) : mode === "file" ? Boolean(cwd) : false;
  const commandsQuery = useCommands(agentId, mode === "command" && canShow);
  const files = useDirectorySuggestions(cwd, fileMention?.query ?? "", mode === "file" && canShow);
  const isVisible = canShow && !(mode === "command" && commandsQuery.isLoading);
  const options = useMemo<AutocompleteOption[]>(() => {
    if (!isVisible) return [];
    if (mode === "command") {
      const available = slashCommand?.position === "inline" ? inlineSkillCommands(commandsQuery.commands) : commandsQuery.commands;
      return orderAboveInput(filterAndRankCommands(available, slashCommand?.query ?? "")).map((command) => ({ id: command.name, label: `/${command.name}`, detail: command.argumentHint || undefined, description: command.description, kind: "command" as const }));
    }
    if (mode === "file" && fileMention) return orderAboveInput(files.entries).map((entry) => ({ id: `${entry.kind}:${entry.path}`, label: entry.path, kind: entry.kind, entryPath: entry.path }));
    return [];
  }, [isVisible, mode, slashCommand, fileMention, commandsQuery.commands, files.entries]);
  const onSelectOption = useCallback(
    (option: AutocompleteOption) => {
      if (option.kind === "command") {
        setText(slashCommand ? applySlashCommandReplacement(text, slashCommand, option.id) : `/${option.id} `);
        onApplied();
        return;
      }
      if (!fileMention || !option.entryPath) return;
      setText(applyFileMentionReplacement(text, fileMention, option.entryPath));
      onApplied();
    },
    [text, slashCommand, fileMention, setText, onApplied],
  );
  const query = mode === "command" ? (slashCommand?.query ?? "") : (fileMention?.query ?? "");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const previousQuery = useRef("");
  useEffect(() => {
    if (!isVisible) {
      previousQuery.current = query;
      setSelectedIndex(-1);
      return;
    }
    const queryChanged = previousQuery.current !== query;
    previousQuery.current = query;
    setSelectedIndex((current) => {
      if (options.length === 0) return -1;
      if (queryChanged || current < 0 || current >= options.length) return fallbackIndex(options.length);
      return current;
    });
  }, [isVisible, options.length, query]);
  const onEscape = mode === "command" && slashCommand?.position === "start" ? () => setText("") : undefined;
  const onKeyPress = useCallback(
    (event: { key: string; preventDefault: () => void }) => {
      if (!isVisible || options.length === 0) return false;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const key = event.key;
        setSelectedIndex((current) => nextActiveIndex(current, options.length, key));
        return true;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        const option = options[selectedIndex >= 0 && selectedIndex < options.length ? selectedIndex : fallbackIndex(options.length)];
        if (option) onSelectOption(option);
        return true;
      }
      if (event.key === "Escape" && onEscape) {
        event.preventDefault();
        onEscape();
        return true;
      }
      return false;
    },
    [isVisible, options, selectedIndex, onSelectOption, onEscape],
  );
  const isLoading = mode === "command" ? commandsQuery.isLoading && options.length === 0 : mode === "file" ? files.isLoading && options.length === 0 : false;
  const errorMessage = mode === "command" ? (commandsQuery.error ?? undefined) : mode === "file" ? (files.error ?? undefined) : undefined;
  return {
    isVisible,
    options,
    selectedIndex,
    isLoading,
    errorMessage,
    loadingText: mode === "file" ? "Searching workspace..." : "Loading commands...",
    emptyText: mode === "file" ? "No files or directories found" : "No commands found",
    onSelectOption,
    onKeyPress,
  };
}

function removeBoltGlyphs(value?: string): string | undefined {
  if (!value) return value;
  const cleaned = value.replace(BOLT_GLYPH_PATTERN, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function hoveredOf(state: PressableStateCallbackType): boolean {
  return (state as PressableStateCallbackType & { hovered?: boolean }).hovered === true;
}

function boxStyle(theme: PluginTheme) {
  return { backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: hostColours(theme).borderAccent, borderRadius: RADIUS.lg, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 4 } };
}

function AutocompleteRow({ theme, option, selected, onSelect, onLayout }: { theme: PluginTheme; option: AutocompleteOption; selected: boolean; onSelect: () => void; onLayout: (top: number, height: number) => void }) {
  const label = removeBoltGlyphs(option.label) ?? option.label;
  const description = removeBoltGlyphs(option.description);
  const isEntry = option.kind !== "command";
  return (
    <Pressable onLayout={(e) => onLayout(e.nativeEvent.layout.y, e.nativeEvent.layout.height)} onPress={onSelect} style={(state) => ({ flexDirection: "row", alignItems: "center", minHeight: 36, paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], backgroundColor: selected || state.pressed || hoveredOf(state) ? theme.colors.surface2 : "transparent" })}>
      {isEntry ? (
        <>
          <View style={{ width: 18, alignItems: "center", justifyContent: "center", marginRight: SPACING[1] }}>
            <Icon name={option.kind === "directory" ? "Folder" : "File"} size={14} color={theme.colors.foregroundMuted} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>{label}</Text>
          </View>
        </>
      ) : (
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>{label}</Text>
          {description ? (
            <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 12 }} numberOfLines={1}>
              {description}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

export function AutocompletePopover({ theme, autocomplete }: { theme: PluginTheme; autocomplete: AgentAutocomplete }) {
  const { isVisible, options, selectedIndex, isLoading, errorMessage, loadingText, emptyText, onSelectOption } = autocomplete;
  const scroll = useRef<ScrollView>(null);
  const rows = useRef(new Map<number, { top: number; height: number }>());
  const viewport = useRef(0);
  const offset = useRef(0);
  const ensureVisible = useCallback(() => {
    const layout = rows.current.get(selectedIndex);
    if (!layout || viewport.current <= 0) return;
    let next = offset.current;
    if (layout.top < offset.current) next = Math.max(0, layout.top);
    else if (layout.top + layout.height > offset.current + viewport.current) next = Math.max(0, layout.top + layout.height - viewport.current);
    if (Math.abs(next - offset.current) < 1) return;
    offset.current = next;
    scroll.current?.scrollTo({ y: next, animated: false });
  }, [selectedIndex]);
  useEffect(() => {
    rows.current.clear();
    offset.current = 0;
    if (options.length > 0) scroll.current?.scrollToEnd({ animated: false });
  }, [options]);
  useEffect(() => {
    const raf = requestAnimationFrame(ensureVisible);
    return () => cancelAnimationFrame(raf);
  }, [ensureVisible, options.length]);
  if (!isVisible || (options.length > 0 && selectedIndex < 0)) return null;
  const position = { position: "absolute" as const, left: 0, right: 0, bottom: "100%" as const, marginBottom: POPOVER_OFFSET, zIndex: 20 };
  const message = isLoading ? loadingText : errorMessage ? `Error: ${errorMessage}` : options.length === 0 ? emptyText : null;
  if (message !== null) {
    return (
      <View style={[position, boxStyle(theme), { maxHeight: LIST_MAX_HEIGHT, overflow: "hidden" }]}>
        <View style={{ paddingHorizontal: SPACING[3], paddingVertical: SPACING[3] }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 14 }}>{message}</Text>
        </View>
      </View>
    );
  }
  const selected = options[selectedIndex];
  return (
    <View style={[position, { gap: SPACING[1] }]}>
      {selected?.kind === "command" && selected.description ? (
        <View style={[boxStyle(theme), { paddingHorizontal: SPACING[3], paddingVertical: SPACING[3] }]}>
          <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>{removeBoltGlyphs(selected.label) ?? selected.label}</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginTop: SPACING[1] }}>{removeBoltGlyphs(selected.description)}</Text>
          {selected.detail ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginTop: SPACING[1] }}>{removeBoltGlyphs(selected.detail)}</Text> : null}
        </View>
      ) : null}
      <View style={[boxStyle(theme), { maxHeight: LIST_MAX_HEIGHT, overflow: "hidden" }]}>
        <ScrollView
          ref={scroll}
          onLayout={(e) => {
            viewport.current = e.nativeEvent.layout.height;
            ensureVisible();
          }}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
          onScroll={(e) => (offset.current = e.nativeEvent.contentOffset.y)}
          scrollEventThrottle={16}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ paddingVertical: SPACING[1] }}
          keyboardShouldPersistTaps="always"
        >
          {options.map((option, index) => (
            <AutocompleteRow
              key={option.id}
              theme={theme}
              option={option}
              selected={index === selectedIndex}
              onSelect={() => onSelectOption(option)}
              onLayout={(top, height) => {
                rows.current.set(index, { top, height });
                ensureVisible();
              }}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}
