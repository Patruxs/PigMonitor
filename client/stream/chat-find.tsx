import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Pressable, Text, TextInput, View, type TextStyle } from "react-native";
import { createChatFindModel, findPattern, searchLoadedItems, type ChatFindFailure, type ChatFindOperations } from "../../shared/chat-find.ts";
import { timelineSearch } from "../../shared/rpc.ts";
import type { StreamItem } from "../../shared/stream.ts";
import { TIMELINE_FETCH_PAGE_SIZE } from "./timeline-state.ts";
import { RADIUS, SPACING } from "../kit/theme.ts";
import type { ViewportHandle } from "./stream-viewport.tsx";
import { useChatPaneArea } from "../chat/chat-pane-scope.tsx";
import { FIND_IGNORED_SELECTOR, findWidgetIn, findWidgetProps, historyRowOf, MARKDOWN_BLOCK_SELECTOR, messageRows, messageTextBlocks } from "./find-anchors.ts";
import { isMac, isWeb, NO_OUTLINE } from "../kit/platform.ts";

const SelectedMessage = createContext<string | null>(null);
const FAILURE_TEXT: Record<ChatFindFailure, string> = {
  connection: "Could not search this chat. Check the host connection and retry.",
  historyChanged: "The chat changed while searching. Search again.",
  reveal: "Could not show this match. Retry.",
};
const WIDGET_WIDTH = 340;
const FIELD_HEIGHT = 28;
let nextHighlightId = 0;

export function useChatFindSelectedMessageId(): string | null {
  return useContext(SelectedMessage);
}

function isFindShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">): boolean {
  const primary = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return primary && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "f";
}

function findRenderedMatches(row: HTMLElement, query: string): Range[] {
  if (!query.trim()) return [];
  const groups = new Map<Element, globalThis.Text[]>();
  for (const content of messageTextBlocks(row)) {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!(node instanceof globalThis.Text) || node.parentElement?.closest(FIND_IGNORED_SELECTOR)) continue;
      const block = node.parentElement?.closest(MARKDOWN_BLOCK_SELECTOR) ?? content;
      const texts = groups.get(block) ?? [];
      texts.push(node);
      groups.set(block, texts);
    }
  }
  const pattern = findPattern(query);
  const ranges: Range[] = [];
  for (const texts of groups.values()) {
    const points = texts.map((node) => ({ node, start: 0, end: 0 }));
    let text = "";
    for (const point of points) {
      point.start = text.length;
      text += point.node.data;
      point.end = text.length;
    }
    for (const match of text.matchAll(pattern)) {
      const start = points.find((point) => point.start <= match.index && point.end > match.index);
      const endOffset = match.index + match[0].length;
      const end = points.find((point) => point.start < endOffset && point.end >= endOffset);
      if (!start || !end) continue;
      const range = document.createRange();
      range.setStart(start.node, match.index - start.start);
      range.setEnd(end.node, endOffset - end.start);
      ranges.push(range);
    }
  }
  return ranges;
}

function findMessageMatches(root: HTMLElement | null, messageId: string, query: string): Range[] {
  return messageRows(root, messageId).flatMap((row) => findRenderedMatches(row, query));
}

function rowOf(range: Range): HTMLElement | null {
  return historyRowOf(range.startContainer);
}

interface Bindings {
  viewportRef: { current: ViewportHandle | null };
  revealLoadedMessage: (messageId: string) => boolean;
  visibleMessageIds: ReadonlySet<string>;
}

type Highlights = { set(name: string, value: unknown): void; delete(name: string): void };
type HighlightConstructor = new (...ranges: Range[]) => unknown;

function highlights(): { registry: Highlights; Highlight: HighlightConstructor } | null {
  const css = (globalThis as { CSS?: { highlights?: Highlights } }).CSS;
  const Highlight = (globalThis as { Highlight?: HighlightConstructor }).Highlight;
  return css?.highlights && Highlight ? { registry: css.highlights, Highlight } : null;
}

function createFindViewport(getBindings: () => Bindings, getRoot: () => HTMLElement | null, highlightName: string): Pick<ChatFindOperations, "reveal" | "clear"> {
  const paint = (range: Range) => {
    const api = highlights();
    api?.registry.set(highlightName, new api.Highlight(range));
  };
  return {
    clear() {
      highlights()?.registry.delete(highlightName);
    },
    reveal(messageId, query, occurrence, signal) {
      return new Promise((resolve, reject) => {
        let frame = 0;
        let started = false;
        const deadline = performance.now() + 5000;
        const cleanup = () => {
          cancelAnimationFrame(frame);
          signal.removeEventListener("abort", cancelled);
        };
        const cancelled = () => {
          cleanup();
          reject(new Error("Search cancelled"));
        };
        const poll = () => {
          if (signal.aborted) return cancelled();
          if (performance.now() >= deadline) {
            cleanup();
            reject(new Error("Could not reveal this match; retry"));
            return;
          }
          const current = getBindings();
          if (!current.visibleMessageIds.has(messageId)) {
            current.revealLoadedMessage(messageId);
            frame = requestAnimationFrame(poll);
            return;
          }
          if (!started) {
            current.viewportRef.current?.scrollToMessage(messageId);
            started = true;
          }
          const rows = messageRows(getRoot(), messageId);
          if (!rows.some((row) => row.getBoundingClientRect().height)) {
            frame = requestAnimationFrame(poll);
            return;
          }
          const ranges = findMessageMatches(getRoot(), messageId, query);
          const index = occurrence < 0 ? ranges.length - 1 : Math.min(occurrence, ranges.length - 1);
          const range = ranges[index];
          cleanup();
          if (!range) return resolve({ occurrence: 0, count: 0 });
          const row = rowOf(range);
          const indexInRow = ranges.slice(0, index).filter((earlier) => rowOf(earlier) === row).length;
          current.viewportRef.current?.scrollToMessage(messageId, {
            signal,
            targetTop() {
              const selected = row ? findRenderedMatches(row, query)[indexInRow] : undefined;
              if (!selected) return null;
              paint(selected);
              const widget = findWidgetIn(getRoot());
              const clearance = widget ? widget.getBoundingClientRect().height + 8 : 0;
              return selected.getBoundingClientRect().top - clearance;
            },
          });
          paint(range);
          resolve({ occurrence: index, count: ranges.length });
        };
        signal.addEventListener("abort", cancelled, { once: true });
        frame = requestAnimationFrame(poll);
      });
    },
  };
}

function ToolbarButton({ theme, label, icon, disabled, onPress }: { theme: PluginTheme; label: string; icon: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={(state) => ({ width: FIELD_HEIGHT, height: FIELD_HEIGHT, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : 1, backgroundColor: (state as { hovered?: boolean }).hovered && !disabled ? theme.colors.surface2 : "transparent" })}>
      <Icon name={icon} size={14} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}

function FindWidget({ theme, query, status, canNavigate, inputRef, onQueryChange, onNext, onPrevious, onClose }: { theme: PluginTheme; query: string; status: string; canNavigate: boolean; inputRef: { current: TextInput | null }; onQueryChange: (query: string) => void; onNext: () => void; onPrevious: () => void; onClose: () => void }) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(query);
  useLayoutEffect(() => setText(query), [query]);
  const onKey = (event: { nativeEvent: { key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; isComposing?: boolean }; preventDefault?: () => void; stopPropagation?: () => void }) => {
    const key = event.nativeEvent;
    if (key.isComposing) return;
    if (isFindShortcut({ key: key.key, metaKey: key.metaKey === true, ctrlKey: key.ctrlKey === true, shiftKey: key.shiftKey === true, altKey: key.altKey === true })) {
      event.preventDefault?.();
      event.stopPropagation?.();
      inputRef.current?.focus();
      return;
    }
    if (key.key === "Escape" || key.key === "Enter") {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (key.key === "Escape") onClose();
      else if (key.shiftKey) onPrevious();
      else onNext();
    }
  };
  return (
    <View accessibilityLabel="Find" style={{ width: WIDGET_WIDTH, maxWidth: "100%", flexDirection: "row", padding: SPACING[1.5], gap: SPACING[1], backgroundColor: theme.colors.surface1, borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.lg, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: SPACING[1] }}>
        <View style={{ flex: 1, minWidth: 0, minHeight: FIELD_HEIGHT, flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingHorizontal: SPACING[2], backgroundColor: theme.colors.surface2, borderRadius: RADIUS.md, borderWidth: 1, borderColor: focused ? theme.colors.foregroundMuted : "transparent" }}>
          <TextInput
            ref={inputRef}
            autoFocus
            selectTextOnFocus
            value={text}
            onChangeText={(value) => {
              setText(value);
              onQueryChange(value);
            }}
            onKeyPress={onKey as never}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            accessibilityLabel="Find in pane"
            placeholder="Find in pane"
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            blurOnSubmit={false}
            returnKeyType="search"
            style={[{ flex: 1, minWidth: 0, paddingHorizontal: 0, paddingVertical: 0, color: theme.colors.foreground, fontSize: 12 }, NO_OUTLINE]}
          />
          <Text role="status" accessibilityLabel="Find matches" accessibilityLiveRegion="polite" style={{ flexShrink: 0, color: theme.colors.foregroundMuted, fontSize: 12 }}>
            {status}
          </Text>
        </View>
        <ToolbarButton theme={theme} label="Previous match" icon="ArrowUp" disabled={!canNavigate} onPress={onPrevious} />
        <ToolbarButton theme={theme} label="Next match" icon="ArrowDown" disabled={!canNavigate} onPress={onNext} />
        <ToolbarButton theme={theme} label="Close Find" icon="X" onPress={onClose} />
      </View>
    </View>
  );
}

export interface AgentHistory {
  agentId: string;
  epoch: string | null;
  fetchPromptWindow: (seq: number) => Promise<void>;
}

export function ChatFind({ theme, agent, items, viewportRef, revealLoadedMessage, visibleMessageIds, children }: { theme: PluginTheme; agent: AgentHistory | null; items: StreamItem[]; viewportRef: { current: ViewportHandle | null }; revealLoadedMessage: (messageId: string) => boolean; visibleMessageIds: ReadonlySet<string>; children: ReactNode }) {
  const call = useRpc(timelineSearch);
  const input = useRef<TextInput | null>(null);
  const paneArea = useChatPaneArea();
  const pane = useRef(paneArea);
  pane.current = paneArea;
  const root = useRef<HTMLDivElement | null>(null);
  const bindings = useRef<Bindings>({ viewportRef, revealLoadedMessage, visibleMessageIds });
  bindings.current = { viewportRef, revealLoadedMessage, visibleMessageIds };
  const [highlightName] = useState(() => `pigmonitor-chat-find-${++nextHighlightId}`);
  const callRef = useRef(call);
  callRef.current = call;
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const agentId = agent?.agentId ?? null;
  const epoch = agent?.epoch ?? null;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const historyWaiters = useRef(new Set<() => void>());
  const historyNear = (seq: number) =>
    new Promise<void>((resolve) => {
      const near = () => itemsRef.current.some((item) => item.timelineCursor !== undefined && Math.abs(item.timelineCursor.seq - seq) <= TIMELINE_FETCH_PAGE_SIZE);
      const check = () => {
        if (!near()) return;
        clearTimeout(timer);
        historyWaiters.current.delete(check);
        resolve();
      };
      const timer = setTimeout(() => {
        historyWaiters.current.delete(check);
        resolve();
      }, 2000);
      historyWaiters.current.add(check);
      check();
    });
  const model = useMemo(
    () =>
      createChatFindModel({
        async search(query, cursor) {
          if (agentId === null) return searchLoadedItems(itemsRef.current, query);
          const result = await callRef.current({ agentId, query, ...(cursor !== undefined ? { cursor } : {}) });
          if (!result.ok) throw new Error(result.error);
          return result;
        },
        async load(_epoch, seq) {
          if (!agentRef.current) return;
          await agentRef.current.fetchPromptWindow(seq);
          await historyNear(seq);
        },
        ...createFindViewport(() => bindings.current, () => root.current, highlightName),
      }),
    [agentId, highlightName],
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => {
    model.updateHistory(epoch, items);
    for (const waiter of [...historyWaiters.current]) waiter();
  }, [model, epoch, items]);
  useEffect(() => () => model.close(), [model]);
  useEffect(() => {
    if (!isWeb) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !isFindShortcut(event)) return;
      const active = document.activeElement;
      const container = root.current;
      if (active && active !== document.body && container && !container.contains(active) && !pane.current?.contains(active)) return;
      event.preventDefault();
      model.open();
      input.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [model]);
  if (!isWeb) return <SelectedMessage.Provider value={null}>{children}</SelectedMessage.Provider>;
  const close = () => {
    model.close();
    root.current?.focus({ preventScroll: true });
  };
  let status = "";
  if (state.phase === "searching") status = "Searching…";
  else if (state.phase === "loading") status = "Loading…";
  else if (state.phase === "error") status = "Failed";
  else if (state.query.trim()) status = state.count ? `${state.occurrence + 1} of ${state.count}` : "No matches";
  return (
    <div ref={root} tabIndex={-1} style={{ display: "flex", flex: 1, minHeight: 0, position: "relative", outline: "none" }}>
      <style>{`::highlight(${highlightName}) { background-color: ${theme.colors.statusWarning}; color: ${theme.colors.surface0}; }`}</style>
      <SelectedMessage.Provider value={state.selectedItemId}>{children}</SelectedMessage.Provider>
      {state.open ? (
        <View style={{ position: "absolute", top: SPACING[2], right: SPACING[3], zIndex: 10, maxWidth: "100%" }} {...findWidgetProps}>
          <FindWidget theme={theme} query={state.query} status={status} canNavigate={state.phase === "ready" && state.count > 0} inputRef={input} onQueryChange={model.setQuery} onNext={model.next} onPrevious={model.previous} onClose={close} />
          {state.failure ? (
            <View style={{ flexDirection: "row", alignItems: "center", padding: SPACING[2], backgroundColor: theme.colors.surface1 }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 12, flex: 1 }}>{FAILURE_TEXT[state.failure]}</Text>
              <Pressable accessibilityRole="button" onPress={model.retry} style={{ paddingHorizontal: SPACING[2], paddingVertical: SPACING[1] }}>
                <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>Retry</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </div>
  );
}
