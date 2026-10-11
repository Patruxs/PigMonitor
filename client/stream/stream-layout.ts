import type { AssistantMessageItem, StreamItem } from "../../shared/stream/stream.ts";
import { continuesResponse, continuesTurn, isPrompt, isResponseBoundary, type TurnTiming } from "./turns.ts";

const GAP = { 1: 4, 3: 12, 4: 16 } as const;

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
