import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { timelinePrompts } from "../../shared/rpc.ts";
import type { StreamItem } from "../../shared/stream/stream.ts";
import { promptsOfLoadedItems, resolveActivePromptSeq, type OutlinePrompt } from "./outline-prompts.ts";
import { getStreamItemMessageId } from "./stream-presentation.ts";
import type { AgentHistory } from "./chat-find.tsx";
import { hostColours, RADIUS, SPACING } from "../kit/theme.ts";
import type { ViewportHandle } from "./stream-viewport.tsx";

const RAIL_WIDTH = 36;
const SLOT_HEIGHT = 8;
const MIN_PANEL_WIDTH = 918;
const RESTING_PILL_HEIGHT = 2;
const MAGNIFIED_PILL_HEIGHT = 4;
const RESTING_PILL_WIDTH = 10;
const ACTIVE_PILL_WIDTH = 18;
const MAGNIFIED_PILL_WIDTH = 26;
const PREVIEW_WIDTH = 260;
const PREVIEW_HEIGHT = 48;
const PREVIEW_GAP = 4;
const OUTLINE_MAGNIFY_RADIUS = 3;
const INITIAL_ACTIVATION_DELAY_MS = 150;
const HORIZONTAL_TRANSIT_DISTANCE_PX = 4;

interface ActivePromptSource {
  subscribe: (listener: () => void) => () => void;
  getActiveSeq: () => number | null;
  publish: (seq: number | null) => void;
}

function createActivePromptPublisher(): ActivePromptSource {
  const listeners = new Set<() => void>();
  let activeSeq: number | null = null;
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getActiveSeq: () => activeSeq,
    publish(seq) {
      if (seq === activeSeq) return;
      activeSeq = seq;
      for (const listener of listeners) listener();
    },
  };
}

function promptTickMagnification(slotDistance: number): number {
  const distance = Math.abs(slotDistance);
  if (!Number.isFinite(distance) || distance >= OUTLINE_MAGNIFY_RADIUS) return 0;
  return (1 + Math.cos((Math.PI * distance) / OUTLINE_MAGNIFY_RADIUS)) / 2;
}

interface ChatOutline {
  prompts: OutlinePrompt[];
  activePrompt: ActivePromptSource;
  jumpToPrompt: (seq: number) => void;
  reportReadingPosition: (seq: number | null) => void;
  seqOf: (item: StreamItem) => number | null;
}

export function useChatOutline({ streamKey, agent, items, viewportRef, visibleMessageIds, revealLoadedMessage }: { streamKey: string; agent: AgentHistory | null; items: StreamItem[]; viewportRef: { current: ViewportHandle | null }; visibleMessageIds: ReadonlySet<string>; revealLoadedMessage: (messageId: string) => boolean }): ChatOutline {
  const call = useRpc(timelinePrompts);
  const [index, setIndex] = useState<{ epoch: string; prompts: OutlinePrompt[] } | null>(null);
  const [pendingJump, setPendingJump] = useState<{ requestId: number; seq: number; fetchSettled: boolean; hasScrolled: boolean } | null>(null);
  const [activePrompt] = useState(createActivePromptPublisher);
  const readingSeq = useRef<number | null>(null);
  const nextJump = useRef(0);
  const nextIndex = useRef(0);
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const agentId = agent?.agentId ?? null;
  const epoch = agent?.epoch ?? null;
  const loaded = agentId === null;
  const positions = useMemo(() => (loaded ? new Map(items.map((item, seq) => [item.id, seq])) : null), [loaded, items]);
  const seqOf = useCallback((item: StreamItem) => (positions ? (positions.get(getStreamItemMessageId(item)) ?? null) : (item.timelineCursor?.seq ?? null)), [positions]);
  const loadedPrompts = useMemo(() => (loaded ? promptsOfLoadedItems(items) : []), [loaded, items]);
  const prompts = loaded ? loadedPrompts : (index?.prompts ?? []);
  const latestPromptSeq = items.reduce((latest, item) => (item.kind === "user_message" && item.timelineCursor?.epoch === epoch ? Math.max(latest, item.timelineCursor.seq) : latest), -1);
  useEffect(() => setIndex(null), [agentId, epoch]);
  useEffect(() => {
    if (Platform.OS !== "web" || agentId === null || epoch === null) {
      setIndex(null);
      return;
    }
    let active = true;
    const requestId = ++nextIndex.current;
    void call({ agentId }).then(
      (result) => {
        if (active && requestId === nextIndex.current && result.ok && epoch === result.epoch) setIndex({ epoch: result.epoch, prompts: result.prompts });
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [agentId, epoch, latestPromptSeq]);
  const publish = useCallback(() => activePrompt.publish(resolveActivePromptSeq(prompts, readingSeq.current)), [activePrompt, prompts]);
  const reportReadingPosition = useCallback(
    (seq: number | null) => {
      readingSeq.current = seq;
      publish();
    },
    [publish],
  );
  useEffect(() => {
    nextJump.current += 1;
    setPendingJump(null);
    readingSeq.current = null;
    activePrompt.publish(null);
  }, [activePrompt, streamKey, agentId, epoch]);
  useEffect(() => publish(), [publish]);
  useEffect(() => {
    if (pendingJump === null) return;
    const target = items.find((item) => seqOf(item) === pendingJump.seq);
    if (target) {
      if (pendingJump.hasScrolled) return;
      if (!visibleMessageIds.has(target.id)) {
        revealLoadedMessage(target.id);
        return;
      }
      viewportRef.current?.scrollToMessage(target.id);
      setPendingJump((current) => (current?.requestId !== pendingJump.requestId ? current : { ...current, hasScrolled: true }));
      return;
    }
    if (pendingJump.fetchSettled) setPendingJump(null);
  }, [items, pendingJump, revealLoadedMessage, seqOf, viewportRef, visibleMessageIds]);
  const jumpToPrompt = useCallback(
    (seq: number) => {
      nextJump.current += 1;
      setPendingJump(null);
      const target = items.find((item) => seqOf(item) === seq);
      if (target) {
        if (revealLoadedMessage(target.id)) {
          setPendingJump({ requestId: nextJump.current, seq, fetchSettled: true, hasScrolled: false });
          return;
        }
        viewportRef.current?.scrollToMessage(target.id);
        return;
      }
      const source = agentRef.current;
      if (!index || !source) return;
      const requestId = nextJump.current;
      setPendingJump({ requestId, seq, fetchSettled: false, hasScrolled: false });
      void source
        .fetchPromptWindow(seq)
        .catch(() => undefined)
        .finally(() => setPendingJump((current) => (current?.requestId !== requestId ? current : { ...current, fetchSettled: true })));
    },
    [items, index, revealLoadedMessage, seqOf, viewportRef],
  );
  return { prompts, activePrompt, jumpToPrompt, reportReadingPosition, seqOf };
}

function createHoverIntent(activate: (index: number | null) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let candidate: number | null = null;
  let anchor: { x: number; y: number } | null = null;
  let active = false;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    if (candidate === null) return;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      active = true;
      if (candidate !== null) activate(candidate);
    }, INITIAL_ACTIVATION_DELAY_MS);
  };
  return {
    enter(point: { x: number; y: number }) {
      anchor = point;
    },
    pointAt(index: number) {
      candidate = index;
      if (active) return activate(index);
      if (timer === null) schedule();
    },
    move(point: { x: number; y: number }) {
      if (active || anchor === null) return;
      const dx = point.x - anchor.x;
      const dy = point.y - anchor.y;
      if (Math.abs(dy) >= Math.abs(dx)) {
        anchor = point;
        return;
      }
      if (Math.abs(dx) < HORIZONTAL_TRANSIT_DISTANCE_PX) return;
      anchor = point;
      schedule();
    },
    leave() {
      cancel();
      candidate = null;
      anchor = null;
      active = false;
      activate(null);
    },
    dispose() {
      cancel();
      candidate = null;
      anchor = null;
      active = false;
    },
  };
}

type PointerLike = { nativeEvent: { clientX: number; clientY: number } };

export function ChatOutlineRail({ theme, outline }: { theme: PluginTheme; outline: ChatOutline }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [narrow, setNarrow] = useState(true);
  const activeSeq = useSyncExternalStore(outline.activePrompt.subscribe, outline.activePrompt.getActiveSeq);
  const hoverIntent = useMemo(() => createHoverIntent(setHovered), []);
  useEffect(() => () => hoverIntent.dispose(), [hoverIntent]);
  useEffect(() => {
    if (narrow) hoverIntent.leave();
  }, [hoverIntent, narrow]);
  if (Platform.OS !== "web" || outline.prompts.length < 2) return null;
  const attention = hovered ?? focused;
  const colours = hostColours(theme);
  const railEvents = {
    onPointerEnter: (event: PointerLike) => hoverIntent.enter({ x: event.nativeEvent.clientX, y: event.nativeEvent.clientY }),
    onPointerMove: (event: PointerLike) => hoverIntent.move({ x: event.nativeEvent.clientX, y: event.nativeEvent.clientY }),
    onPointerLeave: () => hoverIntent.leave(),
  };
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="box-none" onLayout={(event: LayoutChangeEvent) => setNarrow(event.nativeEvent.layout.width < MIN_PANEL_WIDTH)}>
      {narrow ? null : (
        <View style={{ position: "absolute", left: SPACING[2], top: "10%", bottom: "10%", width: RAIL_WIDTH, alignItems: "center", justifyContent: "center", zIndex: 2 }} {...({ role: "tablist", ...railEvents } as object)}>
          {outline.prompts.map((prompt, index) => {
            const isActive = prompt.seq === activeSeq;
            const hasAttention = index === attention;
            const magnification = attention === null ? 0 : promptTickMagnification(index - attention);
            const resting = isActive ? ACTIVE_PILL_WIDTH : RESTING_PILL_WIDTH;
            return (
              <View key={prompt.seq} style={{ width: RAIL_WIDTH, flexBasis: SLOT_HEIGHT, flexShrink: 1, alignItems: "center", justifyContent: "center" }} {...({ onPointerEnter: () => hoverIntent.pointAt(index) } as object)}>
                <Pressable
                  style={{ width: "100%", height: "100%", alignItems: "flex-start", justifyContent: "center", paddingLeft: SPACING[1], borderRadius: 4 }}
                  onPress={() => {
                    outline.jumpToPrompt(prompt.seq);
                    setFocused((current) => (current === index ? null : current));
                  }}
                  onFocus={() => setFocused(index)}
                  onBlur={() => setFocused((current) => (current === index ? null : current))}
                  accessibilityRole="tab"
                  aria-selected={isActive}
                  accessibilityLabel={`${index + 1} of ${outline.prompts.length}: ${prompt.preview}`}
                >
                  <View style={{ borderRadius: 9999, width: resting + magnification * (MAGNIFIED_PILL_WIDTH - resting), height: RESTING_PILL_HEIGHT + magnification * (MAGNIFIED_PILL_HEIGHT - RESTING_PILL_HEIGHT), backgroundColor: hasAttention ? theme.colors.foreground : isActive ? colours.foregroundExtraMuted : colours.borderAccent, ...({ transitionProperty: "width, height, background-color", transitionDuration: "140ms", transitionTimingFunction: "ease-out" } as object) }} />
                </Pressable>
                {hasAttention ? (
                  <View pointerEvents="none" aria-hidden style={{ position: "absolute", left: RAIL_WIDTH + PREVIEW_GAP, top: "50%", marginTop: -PREVIEW_HEIGHT / 2, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, justifyContent: "center", paddingHorizontal: SPACING[3], borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface2, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}>
                    <Text style={{ fontSize: 12, color: theme.colors.foreground }} numberOfLines={2}>
                      {prompt.preview}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
