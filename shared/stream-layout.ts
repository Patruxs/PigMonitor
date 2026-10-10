import type { AssistantMessageItem, StreamItem } from "./stream.ts";

const GAP = { 1: 4, 3: 12, 4: 16 } as const;

export function continuesTurn(previous: StreamItem | null, next: StreamItem | null): boolean {
  if (!previous || !next) return false;
  if (previous.turnId !== undefined && next.turnId !== undefined) return previous.turnId === next.turnId;
  return !isPrompt(next);
}

export function isPrompt(item: StreamItem): boolean {
  return item.kind === "user_message" || (item.kind === "piggery" && item.prompt);
}

export function continuesResponse(previous: StreamItem | null, next: StreamItem | null): boolean {
  if (!previous || !next) return false;
  return continuesTurn(previous, next) || !isPrompt(next);
}

function isTurnBoundary(previous: StreamItem | null, next: StreamItem | null): boolean {
  return previous !== null && next !== null && !continuesTurn(previous, next);
}

function isResponseBoundary(previous: StreamItem | null, next: StreamItem | null): boolean {
  return previous !== null && next !== null && !continuesResponse(previous, next);
}

export function startsNewTurn(item: StreamItem, previous: StreamItem | null): boolean {
  return previous === null || isTurnBoundary(previous, item);
}

function isSameAssistantBlockGroup(item: StreamItem | null | undefined, other: StreamItem | null | undefined): boolean {
  return item?.kind === "assistant_message" && other?.kind === "assistant_message" && item.blockGroupId !== undefined && item.blockGroupId === other.blockGroupId;
}

export type AssistantSpacing = "default" | "compactTop" | "compactBottom" | "compactBoth";

function getAssistantBlockSpacing(item: StreamItem, aboveItem: StreamItem | null, belowItem: StreamItem | null, hasFooterBelow: boolean): AssistantSpacing {
  if (item.kind !== "assistant_message") return "default";
  const compactTop = isSameAssistantBlockGroup(item, aboveItem);
  const compactBottom = hasFooterBelow || isSameAssistantBlockGroup(item, belowItem);
  if (compactTop && compactBottom) return "compactBoth";
  if (compactTop) return "compactTop";
  if (compactBottom) return "compactBottom";
  return "default";
}

function isToolSequenceItem(item: StreamItem | null | undefined): boolean {
  return item?.kind === "tool_call" || item?.kind === "thought" || item?.kind === "todo_list";
}

export function getGapBetweenStreamItems(item: StreamItem | null, belowItem: StreamItem | null): number {
  if (!item || !belowItem) return 0;
  if (item.kind === "user_message" && belowItem.kind === "user_message") return GAP[1];
  if (item.kind === "user_message" && belowItem.kind === "assistant_message") return 0;
  if (isToolSequenceItem(item) && isToolSequenceItem(belowItem)) return 0;
  if (item.kind === "user_message" && isToolSequenceItem(belowItem)) return GAP[4];
  if (item.kind === "assistant_message" && isToolSequenceItem(belowItem)) return GAP[1];
  if (isToolSequenceItem(item) && belowItem.kind === "assistant_message") return GAP[1];
  if (isSameAssistantBlockGroup(item, belowItem)) return GAP[3];
  return GAP[4];
}

export interface TurnTiming {
  completedAt: Date;
  durationMs: number | null;
  costUsd?: number;
}

export interface StreamTurnTiming {
  byAssistantId: Map<string, TurnTiming>;
  runningStartedAt: Date | null;
}

export function deriveStreamTurnTiming(params: { isTurnActive: boolean; activeTurnStartedAt: Date | null; tail: StreamItem[]; head: StreamItem[] }): StreamTurnTiming {
  const byAssistantId = new Map<string, TurnTiming>();
  let startedAt: Date | null = null;
  let lastAt: Date | null = null;
  let assistantIds: string[] = [];
  let reported: { durationMs?: number; costUsd?: number } | null = null;
  let previous: StreamItem | null = null;
  const flush = () => {
    if (!lastAt || assistantIds.length === 0) return;
    const measured = startedAt ? Math.max(0, lastAt.getTime() - startedAt.getTime()) : null;
    const timing: TurnTiming = { completedAt: lastAt, durationMs: reported?.durationMs ?? measured, ...(reported?.costUsd !== undefined ? { costUsd: reported.costUsd } : {}) };
    for (const id of assistantIds) byAssistantId.set(id, timing);
  };
  for (const item of [...params.tail, ...params.head]) {
    if (startsNewTurn(item, previous)) {
      flush();
      startedAt = isPrompt(item) ? item.timestamp : null;
      lastAt = null;
      assistantIds = [];
      reported = null;
    }
    lastAt = item.timestamp;
    if (item.kind === "assistant_message") assistantIds.push(item.id);
    if (item.kind === "piggery" && item.source.kind === "turn") reported = item.source;
    previous = item;
  }
  if (!params.isTurnActive) flush();
  return { byAssistantId, runningStartedAt: params.isTurnActive ? params.activeTurnStartedAt : null };
}

export type StreamToolSequence = "single" | "first" | "middle" | "last" | "none";

export interface TurnFooterHost {
  itemId: string;
  items: StreamItem[];
  timing?: TurnTiming;
  startIndex: number;
}

export interface StreamLayoutItem {
  item: StreamItem;
  aboveItem: StreamItem | null;
  belowItem: StreamItem | null;
  gapBelow: number;
  assistantSpacing: AssistantSpacing;
  completedFooter: TurnFooterHost | null;
  toolSequence: StreamToolSequence;
  isFirstInUserGroup: boolean;
  isLastInUserGroup: boolean;
  isLastInToolSequence: boolean;
  phase: "streaming" | "complete";
}

export interface StreamLayout {
  history: StreamLayoutItem[];
  liveHead: StreamLayoutItem[];
  auxiliaryTurnFooter: TurnFooterHost | null;
}

function footerHost(item: StreamItem, items: StreamItem[], index: number, timing: Map<string, TurnTiming>): TurnFooterHost {
  return { itemId: item.id, items, timing: timing.get(item.id), startIndex: index };
}

function findLatestAssistantInResponse(input: { items: StreamItem[]; startIndex: number; boundaryAboveItems?: StreamItem[] | null; boundaryAboveIndex?: number | null }): { item: AssistantMessageItem; items: StreamItem[]; index: number } | null {
  let items = input.items;
  let index = input.startIndex;
  let canCrossBoundary = true;
  let laterItem: StreamItem | null = null;
  while (true) {
    for (; index >= 0 && index < items.length; index -= 1) {
      const item = items[index];
      if (!item || (laterItem && !continuesResponse(item, laterItem))) return null;
      if (item.kind === "assistant_message") return { item, items, index };
      laterItem = item;
    }
    if (!canCrossBoundary || !input.boundaryAboveItems || input.boundaryAboveIndex === null || input.boundaryAboveIndex === undefined) return null;
    items = input.boundaryAboveItems;
    index = input.boundaryAboveIndex;
    canCrossBoundary = false;
  }
}

export function collectAssistantResponseContent(items: StreamItem[], startIndex: number): string {
  const messages: string[] = [];
  let laterItem: StreamItem | null = null;
  for (let index = startIndex; index >= 0 && index < items.length; index -= 1) {
    const item = items[index];
    if (!item || (laterItem && !continuesResponse(item, laterItem))) break;
    if (item.kind === "assistant_message") messages.push(item.text);
    laterItem = item;
  }
  return messages.reverse().join("\n\n");
}

const previousLayoutItemByStreamItem = new WeakMap<StreamItem, StreamLayoutItem>();

function footerHostsEqual(left: TurnFooterHost | null, right: TurnFooterHost | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.itemId === right.itemId && left.timing === right.timing && left.startIndex === right.startIndex && left.items === right.items;
}

function shareLayoutItem(next: StreamLayoutItem): StreamLayoutItem {
  const previous = previousLayoutItemByStreamItem.get(next.item);
  if (
    previous &&
    previous.aboveItem === next.aboveItem &&
    previous.belowItem === next.belowItem &&
    previous.gapBelow === next.gapBelow &&
    previous.assistantSpacing === next.assistantSpacing &&
    footerHostsEqual(previous.completedFooter, next.completedFooter) &&
    previous.toolSequence === next.toolSequence &&
    previous.isFirstInUserGroup === next.isFirstInUserGroup &&
    previous.isLastInUserGroup === next.isLastInUserGroup &&
    previous.isLastInToolSequence === next.isLastInToolSequence &&
    previous.phase === next.phase
  ) {
    return previous;
  }
  previousLayoutItemByStreamItem.set(next.item, next);
  return next;
}

function layoutSegment(input: {
  items: StreamItem[];
  timing: Map<string, TurnTiming>;
  auxiliaryTurnFooter: TurnFooterHost | null;
  hasAuxiliaryFooter: boolean;
  boundaryIndex: number | null;
  boundaryAboveItem: StreamItem | null;
  boundaryBelowItem: StreamItem | null;
  boundaryAboveItems: StreamItem[] | null;
  boundaryAboveIndex: number | null;
  phase: "streaming" | "complete";
}): StreamLayoutItem[] {
  return input.items.map((item, index) => {
    const aboveItem = input.items[index - 1] ?? (index === input.boundaryIndex ? input.boundaryAboveItem : null);
    const belowItem = input.items[index + 1] ?? (index === input.boundaryIndex ? input.boundaryBelowItem : null);
    let completedFooter: TurnFooterHost | null = null;
    if (!isPrompt(item) && isResponseBoundary(item, belowItem)) {
      const assistant = findLatestAssistantInResponse({ items: input.items, startIndex: index, boundaryAboveItems: input.boundaryAboveItems, boundaryAboveIndex: input.boundaryAboveIndex });
      if (assistant && input.auxiliaryTurnFooter?.itemId !== assistant.item.id) completedFooter = footerHost(assistant.item, assistant.items, assistant.index, input.timing);
    }
    const hasAbove = isToolSequenceItem(aboveItem) && continuesTurn(aboveItem, item);
    const hasBelow = isToolSequenceItem(belowItem) && continuesTurn(item, belowItem);
    let toolSequence: StreamToolSequence = "none";
    if (isToolSequenceItem(item)) toolSequence = hasAbove && hasBelow ? "middle" : hasAbove ? "last" : hasBelow ? "first" : "single";
    return shareLayoutItem({
      item,
      aboveItem,
      belowItem,
      gapBelow: completedFooter ? 0 : getGapBetweenStreamItems(item, belowItem),
      assistantSpacing: getAssistantBlockSpacing(item, aboveItem, belowItem, completedFooter !== null || (input.hasAuxiliaryFooter && belowItem === null)),
      completedFooter,
      toolSequence,
      isFirstInUserGroup: item.kind === "user_message" && aboveItem?.kind !== "user_message",
      isLastInUserGroup: item.kind === "user_message" && belowItem?.kind !== "user_message",
      isLastInToolSequence: isToolSequenceItem(item) && !hasBelow,
      phase: input.phase,
    });
  });
}

export function layoutStream(input: { isTurnActive: boolean; history: StreamItem[]; liveHead: StreamItem[]; timing: Map<string, TurnTiming> }): StreamLayout {
  let auxiliaryTurnFooter: TurnFooterHost | null = null;
  if (!input.isTurnActive) {
    const footerItems = input.liveHead.length > 0 ? input.liveHead : input.history;
    if (footerItems.length > 0) {
      const assistant = findLatestAssistantInResponse({ items: footerItems, startIndex: footerItems.length - 1 });
      if (assistant) auxiliaryTurnFooter = footerHost(assistant.item, assistant.items, assistant.index, input.timing);
    }
  }
  const hasAuxiliaryFooter = input.isTurnActive || auxiliaryTurnFooter !== null;
  const historyBoundaryIndex = input.history.length === 0 ? null : input.history.length - 1;
  const liveHeadBoundaryIndex = input.liveHead.length === 0 ? null : 0;
  const shared = { timing: input.timing, auxiliaryTurnFooter, hasAuxiliaryFooter };
  return {
    history: layoutSegment({ ...shared, items: input.history, boundaryIndex: historyBoundaryIndex, boundaryAboveItem: null, boundaryBelowItem: liveHeadBoundaryIndex === null ? null : input.liveHead[0], boundaryAboveItems: null, boundaryAboveIndex: null, phase: "complete" }),
    liveHead: layoutSegment({ ...shared, items: input.liveHead, boundaryIndex: liveHeadBoundaryIndex, boundaryAboveItem: historyBoundaryIndex === null ? null : input.history[historyBoundaryIndex], boundaryBelowItem: null, boundaryAboveItems: input.history, boundaryAboveIndex: historyBoundaryIndex, phase: input.isTurnActive ? "streaming" : "complete" }),
    auxiliaryTurnFooter,
  };
}

export const MOUNTED_RECENT_STREAM_ITEMS = 20;

export function findMountedWindowStart(items: StreamItem[], minMountedCount: number): number {
  if (items.length <= minMountedCount) return 0;
  let start = Math.max(items.length - minMountedCount, 0);
  while (start > 0 && !isPrompt(items[start])) start -= 1;
  return start;
}

export function findEarlierHistoryWindowStart(items: StreamItem[], start: number, itemId: string | undefined): number {
  const targetIndex = itemId ? items.findIndex((item) => (item.kind === "assistant_message" ? (item.blockGroupId ?? item.id) : item.id) === itemId) : -1;
  const targetStart = targetIndex >= 0 && targetIndex < start ? targetIndex : start;
  if (!itemId) return findMountedWindowStart(items.slice(0, targetStart), MOUNTED_RECENT_STREAM_ITEMS);
  return findMountedWindowStart(items.slice(0, targetStart + 1), 1);
}

export const HISTORY_START_THRESHOLD_PX = 96;

export type HistoryStartPaginationState =
  | { status: "dormant" }
  | { status: "ready" }
  | { status: "loading"; requestedProgressKey: string; requestObserved: boolean }
  | { status: "settling"; loadedProgressKey: string }
  | { status: "latched" };

export interface HistoryStartPaginationInput {
  distanceFromHistoryStart: number;
  hasOlderHistory: boolean;
  isLoadingOlderHistory: boolean;
  isReady: boolean;
  progressKey: string | null;
}

export interface HistoryStartPaginationTransition {
  state: HistoryStartPaginationState;
  shouldLoad: boolean;
}

export function isHistoryStartLoadingOperation(state: HistoryStartPaginationState): boolean {
  return state.status === "loading" || state.status === "settling";
}

export function rearmHistoryStartPagination(state: HistoryStartPaginationState): HistoryStartPaginationState {
  return state.status === "dormant" || state.status === "latched" ? { status: "ready" } : state;
}

export function abandonHistoryStartPaginationRequest(state: HistoryStartPaginationState, requestedProgressKey: string): HistoryStartPaginationState {
  if (state.status !== "loading" || state.requestObserved || state.requestedProgressKey !== requestedProgressKey) return state;
  return { status: "latched" };
}

function startLoading(progressKey: string): HistoryStartPaginationTransition {
  return { state: { status: "loading", requestedProgressKey: progressKey, requestObserved: false }, shouldLoad: true };
}

export function evaluateHistoryStartPagination(state: HistoryStartPaginationState, input: HistoryStartPaginationInput): HistoryStartPaginationTransition {
  if (state.status === "dormant" || state.status === "settling") return { state, shouldLoad: false };
  if (state.status === "loading") {
    if (input.progressKey !== null && input.progressKey !== state.requestedProgressKey) return { state: { status: "settling", loadedProgressKey: input.progressKey }, shouldLoad: false };
    if (input.isLoadingOlderHistory && !state.requestObserved) return { state: { ...state, requestObserved: true }, shouldLoad: false };
    if (!input.isLoadingOlderHistory && !input.hasOlderHistory) return { state: { status: "latched" }, shouldLoad: false };
    if (state.requestObserved && !input.isLoadingOlderHistory && input.progressKey === state.requestedProgressKey) return { state: { status: "latched" }, shouldLoad: false };
    return { state, shouldLoad: false };
  }
  if (input.distanceFromHistoryStart > HISTORY_START_THRESHOLD_PX) return state.status === "ready" ? { state, shouldLoad: false } : { state: { status: "ready" }, shouldLoad: false };
  if (state.status === "latched" || !input.isReady || !input.hasOlderHistory || input.isLoadingOlderHistory || input.progressKey === null) return { state, shouldLoad: false };
  return startLoading(input.progressKey);
}

export function settleHistoryStartPagination(state: HistoryStartPaginationState, input: HistoryStartPaginationInput): HistoryStartPaginationTransition {
  if (state.status !== "settling") return { state, shouldLoad: false };
  const atStart = input.distanceFromHistoryStart <= HISTORY_START_THRESHOLD_PX;
  if (!atStart || !input.isReady || !input.hasOlderHistory || input.isLoadingOlderHistory || input.progressKey === null) return { state: atStart ? { status: "latched" } : { status: "ready" }, shouldLoad: false };
  return startLoading(input.progressKey);
}

export interface RowGeometry {
  id: string;
  top: number;
  height: number;
}

const READING_POSITION_OFFSET_PX = 8;

export function createReadingAnchor() {
  let anchor: { id: string; top: number } | null = null;
  let geometry: readonly RowGeometry[] = [];
  const readingRow = (scrollTop: number) => geometry.find((row) => row.top + row.height > scrollTop + READING_POSITION_OFFSET_PX);
  const project = (scrollTop: number, row: Pick<RowGeometry, "id" | "top"> | undefined) => scrollTop + (anchor && row?.id === anchor.id ? row.top - anchor.top : 0);
  return {
    getRowId: () => anchor?.id ?? null,
    getReadingRowId: (scrollTop: number) => readingRow(scrollTop)?.id ?? geometry.at(-1)?.id ?? null,
    project,
    reset() {
      anchor = null;
    },
    scroll(scrollTop: number) {
      const next = readingRow(scrollTop);
      anchor = next ? { id: next.id, top: next.top } : null;
    },
    reconcile(scrollTop: number, rows: readonly RowGeometry[], userScrolled = false): number {
      geometry = rows;
      const previous = anchor && rows.find((row) => row.id === anchor?.id);
      if (anchor && !previous && !userScrolled) return scrollTop;
      const correctedTop = project(scrollTop, previous ?? undefined);
      const next = previous && !userScrolled ? previous : readingRow(correctedTop);
      anchor = next ? { id: next.id, top: next.top } : null;
      return correctedTop;
    },
  };
}
