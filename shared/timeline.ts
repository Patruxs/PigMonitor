import {
  applyStreamEvent,
  flushHeadToTail,
  hydrateStreamState,
  mergeAgentToolCallItem,
  reduceStreamUpdate,
  replaceWithCanonicalStream,
  streamTimelineItemIdentity,
  upsertUserMessageAcrossStream,
  type AgentStreamEvent,
  type AssistantMessageItem,
  type StreamItem,
  type TimelinePosition,
} from "./stream.ts";

export const TIMELINE_FETCH_PAGE_SIZE = 40;

export interface TimelineLoadedRange {
  startSeq: number;
  endSeq: number;
  hasOlder?: boolean;
}

export interface TimelineCursor {
  epoch: string;
  startSeq: number;
  endSeq: number;
  retainedRanges?: TimelineLoadedRange[];
}

export type TimelineSideEffect = { type: "catch_up"; cursor: { epoch: string; endSeq: number } };

type TimelineDirection = "tail" | "before" | "after";

interface TimelineSeqRange {
  startSeq: number;
  endSeq: number;
}

export interface TimelineResponseEntry {
  seqStart: number;
  seqEnd: number;
  sourceSeqRanges?: TimelineSeqRange[];
  provider: string;
  turnId?: string;
  item: Record<string, unknown>;
  timestamp: string;
}

export interface TimelinePage {
  direction: TimelineDirection;
  projection: "projected" | "canonical";
  reset: boolean;
  epoch: string;
  window: { minSeq: number; maxSeq: number; nextSeq: number };
  startCursor: { seq: number } | null;
  endCursor: { seq: number } | null;
  entries: TimelineResponseEntry[];
  error: string | null;
  hasNewer: boolean;
  hasOlder: boolean;
  mergeWindow?: boolean;
}

export type TimelineFetchPlan =
  | { direction: "tail"; limit: number; projection: "projected" }
  | { direction: "after" | "before"; cursor: { epoch: string; seq: number }; limit: number; projection: "projected"; mergeWindow?: boolean };

export function planTimelineTailFetch(): TimelineFetchPlan {
  return { direction: "tail", limit: TIMELINE_FETCH_PAGE_SIZE, projection: "projected" };
}

export function planTimelineCatchUpAfter(cursor: { epoch: string; seq: number }): TimelineFetchPlan {
  return { direction: "after", cursor, limit: TIMELINE_FETCH_PAGE_SIZE, projection: "projected" };
}

export function planTimelineOlderFetch(cursor: { epoch: string; seq: number }): TimelineFetchPlan {
  return { direction: "before", cursor, limit: TIMELINE_FETCH_PAGE_SIZE, projection: "projected" };
}

export function planTimelinePromptJump(target: { epoch: string; seq: number }): TimelineFetchPlan {
  return { direction: "before", cursor: { epoch: target.epoch, seq: target.seq + Math.floor(TIMELINE_FETCH_PAGE_SIZE / 2) + 1 }, limit: TIMELINE_FETCH_PAGE_SIZE, projection: "projected", mergeWindow: true };
}

interface TimelineUnit {
  seq: number;
  seqEnd: number;
  sourceSeqRanges: TimelineSeqRange[];
  event: AgentStreamEvent;
  timestamp: Date;
}

interface TimelinePathResult {
  tail: StreamItem[];
  head: StreamItem[];
  cursor: TimelineCursor | null | undefined;
  cursorChanged: boolean;
  older: "available" | "none" | "unchanged";
  sideEffects: TimelineSideEffect[];
  acknowledgedClientMessageIds: string[];
}

function mergeTimelineCoverage(current: TimelineCursor, added: TimelineLoadedRange): TimelineCursor {
  const ranges = [{ startSeq: current.startSeq, endSeq: current.endSeq }, ...(current.retainedRanges ?? []), added].sort((a, b) => a.startSeq - b.startSeq || a.endSeq - b.endSeq);
  const merged: TimelineLoadedRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (!previous || range.startSeq > previous.endSeq + 1) {
      merged.push({ ...range });
      continue;
    }
    previous.endSeq = Math.max(previous.endSeq, range.endSeq);
  }
  const contiguousIndex = merged.findIndex((range) => range.startSeq <= current.endSeq && range.endSeq >= current.endSeq);
  const contiguous = merged[contiguousIndex];
  if (!contiguous) return current;
  const retainedRanges = merged.filter((_, index) => index !== contiguousIndex);
  return { epoch: current.epoch, startSeq: contiguous.startSeq, endSeq: contiguous.endSeq, ...(retainedRanges.length > 0 ? { retainedRanges } : {}) };
}

function timelineCursorEquals(left: TimelineCursor, right: TimelineCursor): boolean {
  if (left.epoch !== right.epoch || left.startSeq !== right.startSeq || left.endSeq !== right.endSeq) return false;
  const a = left.retainedRanges ?? [];
  const b = right.retainedRanges ?? [];
  return a.length === b.length && a.every((range, index) => range.startSeq === b[index]?.startSeq && range.endSeq === b[index]?.endSeq && range.hasOlder === b[index]?.hasOlder);
}

function matchesProjectedRow(existing: StreamItem, incoming: StreamItem): boolean {
  const incomingIdentity = streamTimelineItemIdentity(incoming);
  if (incomingIdentity !== null) return streamTimelineItemIdentity(existing) === incomingIdentity;
  if (existing.kind === "assistant_message" && incoming.kind === "assistant_message") return existing.messageId === incoming.messageId && existing.text === incoming.text && existing.timestamp.getTime() === incoming.timestamp.getTime();
  return existing.kind === "thought" && incoming.kind === "thought" && existing.text === incoming.text && existing.timestamp.getTime() === incoming.timestamp.getTime();
}

function reconcilePromptWindowItems(input: { hydrated: StreamItem[]; tail: StreamItem[]; head: StreamItem[] }): { page: StreamItem[]; tail: StreamItem[]; head: StreamItem[]; acknowledgedClientMessageIds: string[] } {
  let tail = input.tail;
  let head = input.head;
  const page: StreamItem[] = [];
  const acknowledged: string[] = [];
  for (const item of input.hydrated) {
    if (item.kind !== "user_message") {
      const tailIndex = tail.findIndex((candidate) => matchesProjectedRow(candidate, item));
      const headIndex = tailIndex < 0 ? head.findIndex((candidate) => matchesProjectedRow(candidate, item)) : -1;
      const lane = tailIndex >= 0 ? tail : head;
      const index = tailIndex >= 0 ? tailIndex : headIndex;
      const existing = lane[index];
      if (index >= 0 && existing) {
        const next = [...lane];
        next[index] = existing.kind === "tool_call" && item.kind === "tool_call" ? mergeAgentToolCallItem(existing, item.payload.data, item.timestamp, item.timelineCursor) : { ...item, id: existing.id };
        if (tailIndex >= 0) tail = next;
        else head = next;
        continue;
      }
      page.push(item);
      continue;
    }
    const reconciled = upsertUserMessageAcrossStream({ tail, head, message: item, insert: "none", presentation: "existing" });
    const location = reconciled.location;
    if (!location?.matched) {
      page.push(item);
      continue;
    }
    page.push(location.message);
    if (item.clientMessageId !== undefined) acknowledged.push(item.clientMessageId);
    tail = reconciled.tail;
    head = reconciled.head;
    if (location.lane === "tail") tail = [...tail.slice(0, location.index), ...tail.slice(location.index + 1)];
    else head = [...head.slice(0, location.index), ...head.slice(location.index + 1)];
  }
  return { page, tail, head, acknowledgedClientMessageIds: acknowledged };
}

type SeqDecision = "accept" | "drop_stale" | "drop_epoch" | "gap" | "init";

function classifySessionTimelineSeq(cursor: { epoch: string; endSeq: number } | null, epoch: string, seq: number): SeqDecision {
  if (!cursor) return "init";
  if (cursor.epoch !== epoch) return "drop_epoch";
  if (seq <= cursor.endSeq) return "drop_stale";
  if (seq === cursor.endSeq + 1) return "accept";
  return "gap";
}

type ResumeTailPolicy = { kind: "not_resume" } | { kind: "discard" } | { kind: "append" } | { kind: "replace"; preserveContinuity: boolean };

function deriveResumeTailPolicy(input: { direction: TimelineDirection; reset: boolean; epoch: string; windowMaxSeq: number; pageStartSeq: number | null; currentCursor: TimelineCursor | undefined; bootstrapReplace: boolean }): ResumeTailPolicy {
  if (input.direction !== "tail" || input.reset || input.bootstrapReplace || !input.currentCursor) return { kind: "not_resume" };
  if (input.currentCursor.epoch !== input.epoch) return { kind: "replace", preserveContinuity: false };
  if (input.windowMaxSeq === input.currentCursor.endSeq) return { kind: "discard" };
  if (input.windowMaxSeq < input.currentCursor.endSeq) return { kind: "replace", preserveContinuity: false };
  if (input.pageStartSeq !== null && input.pageStartSeq <= input.currentCursor.endSeq + 1) return { kind: "append" };
  return { kind: "replace", preserveContinuity: true };
}

function replaceLiveAssistantWithProjectedText(head: StreamItem[], event: AgentStreamEvent, timestamp: Date, timelineCursor: TimelinePosition): StreamItem[] | null {
  if (event.type !== "timeline" || event.item.type !== "assistant_message") return null;
  const index = head.findLastIndex((item) => item.kind === "assistant_message");
  const current = head[index];
  if (!current || current.kind !== "assistant_message" || !event.item.text.startsWith(current.text)) return null;
  const next = [...head];
  next[index] = { ...current, text: event.item.text, timestamp, timelineCursor };
  return next;
}

function overlapsCurrentEnd(unit: TimelineUnit, currentEndSeq: number): boolean {
  return unit.sourceSeqRanges.some((range) => range.startSeq <= currentEndSeq && range.endSeq > currentEndSeq);
}

function reconcileOverlappingProjectedAssistant(tail: StreamItem[], head: StreamItem[], unit: TimelineUnit, epoch: string, currentEndSeq: number): { tail: StreamItem[]; head: StreamItem[]; reconciled: boolean } {
  if (unit.event.type !== "timeline" || unit.event.item.type !== "assistant_message" || !overlapsCurrentEnd(unit, currentEndSeq)) return { tail, head, reconciled: false };
  const projectedText = unit.event.item.text;
  const projectedMessageId = unit.event.item.messageId;
  const matches = (item: StreamItem) => {
    if (item.kind !== "assistant_message") return false;
    if (projectedMessageId && item.messageId) return item.messageId === projectedMessageId;
    return projectedText.startsWith(item.text);
  };
  const findMatch = (items: StreamItem[]) => {
    const index = items.findLastIndex(matches);
    const current = items[index];
    return current?.kind === "assistant_message" ? { current, index } : null;
  };
  const headMatch = findMatch(head);
  const match = headMatch ?? findMatch(tail);
  if (!match) return { tail, head, reconciled: false };
  const messageId = projectedMessageId ?? match.current.messageId;
  const replacement: AssistantMessageItem = { kind: "assistant_message", id: match.current.id, ...(messageId !== undefined ? { messageId } : {}), text: projectedText, timestamp: unit.timestamp, timelineCursor: { epoch, seq: unit.seqEnd } };
  const replaceMatch = (items: StreamItem[], index: number) => {
    const next = [...items];
    next[index] = replacement;
    return next;
  };
  if (headMatch) return { tail, head: replaceMatch(head, headMatch.index), reconciled: true };
  return { tail: replaceMatch(tail, match.index), head, reconciled: true };
}

function reconcileOverlappingProjectedReasoning(tail: StreamItem[], head: StreamItem[], unit: TimelineUnit, currentEndSeq: number): { tail: StreamItem[]; head: StreamItem[]; reconciled: boolean } {
  if (unit.event.type !== "timeline" || unit.event.item.type !== "reasoning" || !overlapsCurrentEnd(unit, currentEndSeq)) return { tail, head, reconciled: false };
  const projectedText = unit.event.item.text;
  const replaceIn = (items: StreamItem[]): StreamItem[] | null => {
    const index = items.findLastIndex((item) => item.kind === "thought" && projectedText.startsWith(item.text));
    const current = items[index];
    if (!current || current.kind !== "thought") return null;
    const next = [...items];
    next[index] = { ...current, text: projectedText, timestamp: unit.timestamp, status: "loading" };
    return next;
  };
  const nextHead = replaceIn(head);
  if (nextHead) return { tail, head: nextHead, reconciled: true };
  const nextTail = replaceIn(tail);
  return nextTail ? { tail: nextTail, head, reconciled: true } : { tail, head, reconciled: false };
}

function reconcileOverlappingProjectedStreamItems(tail: StreamItem[], head: StreamItem[], units: TimelineUnit[], epoch: string, currentEndSeq: number | undefined): { tail: StreamItem[]; head: StreamItem[]; reconciledUnits: Set<TimelineUnit> } {
  const reconciledUnits = new Set<TimelineUnit>();
  if (currentEndSeq === undefined) return { tail, head, reconciledUnits };
  for (const unit of units) {
    let reconciled = reconcileOverlappingProjectedAssistant(tail, head, unit, epoch, currentEndSeq);
    if (!reconciled.reconciled) reconciled = reconcileOverlappingProjectedReasoning(tail, head, unit, currentEndSeq);
    tail = reconciled.tail;
    head = reconciled.head;
    if (reconciled.reconciled) reconciledUnits.add(unit);
  }
  return { tail, head, reconciledUnits };
}

function applyCanonicalForwardUnit(tail: StreamItem[], head: StreamItem[], unit: TimelineUnit, epoch: string): { tail: StreamItem[]; head: StreamItem[]; acknowledgedClientMessageIds: string[] } {
  const { event, timestamp, seqEnd } = unit;
  const timelineCursor = { epoch, seq: seqEnd };
  if (event.type === "timeline" && event.item.type === "user_message") {
    const applied = applyStreamEvent({ tail, head, event, timestamp, source: "canonical", timelineCursor });
    return { tail: applied.tail, head: applied.head, acknowledgedClientMessageIds: applied.acknowledgedClientMessageIds ?? [] };
  }
  if (head.length === 0) return { tail: reduceStreamUpdate(tail, event, timestamp, { source: "canonical", timelineCursor }), head, acknowledgedClientMessageIds: [] };
  const replacedHead = replaceLiveAssistantWithProjectedText(head, event, timestamp, timelineCursor);
  if (replacedHead) return { tail, head: replacedHead, acknowledgedClientMessageIds: [] };
  const activeAssistant = head.findLast((item): item is AssistantMessageItem => item.kind === "assistant_message");
  if (event.type === "timeline" && event.item.type === "assistant_message" && event.item.messageId !== undefined && event.item.messageId !== activeAssistant?.messageId) {
    return { tail: flushHeadToTail(tail, head), head: reduceStreamUpdate([], event, timestamp, { source: "canonical", timelineCursor }), acknowledgedClientMessageIds: [] };
  }
  const applied = applyStreamEvent({ tail, head, event, timestamp, source: "canonical", timelineCursor });
  return { tail: applied.tail, head: applied.head, acknowledgedClientMessageIds: applied.acknowledgedClientMessageIds ?? [] };
}

function deriveCanonicalAcknowledgements(units: TimelineUnit[], epoch: string, currentTail: StreamItem[], currentHead: StreamItem[]): string[] {
  let tail = currentTail;
  let head = currentHead;
  const acknowledged = new Set<string>();
  for (const unit of units) {
    if (unit.event.type !== "timeline" || unit.event.item.type !== "user_message") continue;
    const applied = applyCanonicalForwardUnit(tail, head, unit, epoch);
    tail = applied.tail;
    head = applied.head;
    for (const id of applied.acknowledgedClientMessageIds) acknowledged.add(id);
  }
  return [...acknowledged];
}

function applyAcceptedForwardTimelineUnits(units: TimelineUnit[], epoch: string, currentTail: StreamItem[], currentHead: StreamItem[], currentEndSeq: number | undefined): { tail: StreamItem[]; head: StreamItem[]; acknowledgedClientMessageIds: string[] } {
  const reconciled = reconcileOverlappingProjectedStreamItems(currentTail, currentHead, units, epoch, currentEndSeq);
  let tail = reconciled.tail;
  let head = reconciled.head;
  for (const unit of units) {
    if (reconciled.reconciledUnits.has(unit)) continue;
    const applied = applyCanonicalForwardUnit(tail, head, unit, epoch);
    tail = applied.tail;
    head = applied.head;
  }
  return { tail, head, acknowledgedClientMessageIds: deriveCanonicalAcknowledgements(units, epoch, currentTail, currentHead) };
}

function mergePrependedCanonicalTail(olderTail: StreamItem[], currentTail: StreamItem[]): StreamItem[] {
  if (olderTail.length === 0) return currentTail;
  if (currentTail.length === 0) return olderTail;
  const remainingOlder: StreamItem[] = [];
  let reconciledCurrent = currentTail;
  for (const item of olderTail) {
    if (item.kind !== "user_message") {
      remainingOlder.push(item);
      continue;
    }
    const result = upsertUserMessageAcrossStream({ tail: reconciledCurrent, head: [], message: item, insert: "prepend-tail", presentation: "existing" });
    if (result.location?.matched) {
      remainingOlder.push(result.location.message);
      reconciledCurrent = [...result.tail.slice(0, result.location.index), ...result.tail.slice(result.location.index + 1)];
    } else remainingOlder.push(item);
  }
  if (remainingOlder.length === 0) return reconciledCurrent;
  const olderLast = remainingOlder.at(-1);
  const currentFirst = reconciledCurrent[0];
  const olderIdentity = olderLast ? streamTimelineItemIdentity(olderLast) : null;
  if (olderLast && currentFirst && olderIdentity !== null && olderIdentity === streamTimelineItemIdentity(currentFirst)) {
    if (olderLast.kind === "plugin" && currentFirst.kind === "plugin") return [...remainingOlder.slice(0, -1), currentFirst, ...reconciledCurrent.slice(1)];
    if (olderLast.kind === "tool_call" && currentFirst.kind === "tool_call") return [...remainingOlder.slice(0, -1), mergeAgentToolCallItem(olderLast, currentFirst.payload.data, currentFirst.timestamp), ...reconciledCurrent.slice(1)];
  }
  if (olderLast?.kind !== "assistant_message" || currentFirst?.kind !== "assistant_message") return [...remainingOlder, ...reconciledCurrent];
  const mergedAssistant: AssistantMessageItem = { ...currentFirst, text: `${olderLast.text}${currentFirst.text}` };
  if (mergedAssistant.messageId === undefined && olderLast.messageId !== undefined) mergedAssistant.messageId = olderLast.messageId;
  return [...remainingOlder.slice(0, -1), mergedAssistant, ...reconciledCurrent.slice(1)];
}

function mergeOlderTimelinePage(page: StreamItem[], currentTail: StreamItem[], epoch: string, startSeq: number, endSeq: number): StreamItem[] {
  const retainedBefore: StreamItem[] = [];
  const atOrAfter: StreamItem[] = [];
  for (const item of currentTail) {
    const cursor = item.timelineCursor;
    if (cursor?.epoch !== epoch) atOrAfter.push(item);
    else if (cursor.seq < startSeq) retainedBefore.push(item);
    else if (cursor.seq > endSeq) atOrAfter.push(item);
  }
  return [...retainedBefore, ...mergePrependedCanonicalTail(page, atOrAfter)];
}

function reservedIdsOf(items: StreamItem[]): Set<string> {
  return new Set(items.map((item) => item.id));
}

function hydratedEventsOf(units: TimelineUnit[], epoch: string) {
  return units.map(({ event, timestamp, seqEnd }) => ({ event, timestamp, timelineCursor: { epoch, seq: seqEnd } }));
}

function mergeTimelineWindow(units: TimelineUnit[], payload: TimelinePage, currentTail: StreamItem[], currentHead: StreamItem[], currentCursor: TimelineCursor | undefined): TimelinePathResult {
  if (!payload.startCursor || !payload.endCursor || currentCursor?.epoch !== payload.epoch) {
    return { tail: currentTail, head: currentHead, cursor: currentCursor, cursorChanged: false, older: "unchanged", sideEffects: [], acknowledgedClientMessageIds: [] };
  }
  const startSeq = payload.startCursor.seq;
  const endSeq = payload.endCursor.seq;
  const projected = reconcileOverlappingProjectedStreamItems(currentTail, currentHead, units, payload.epoch, currentCursor.endSeq);
  const retainedTail = projected.tail.filter((item) => {
    const cursor = item.timelineCursor;
    return cursor?.epoch !== payload.epoch || cursor.seq < startSeq || cursor.seq > endSeq;
  });
  const hydrated = hydrateStreamState(hydratedEventsOf(units.filter((unit) => !projected.reconciledUnits.has(unit)), payload.epoch), { source: "canonical", reservedItemIds: reservedIdsOf([...retainedTail, ...projected.head]) });
  const reconciled = reconcilePromptWindowItems({ hydrated, tail: retainedTail, head: projected.head });
  const tail = [...reconciled.tail, ...reconciled.page]
    .map((item, order) => ({ item, order }))
    .sort((a, b) => (a.item.timelineCursor?.seq ?? Number.POSITIVE_INFINITY) - (b.item.timelineCursor?.seq ?? Number.POSITIVE_INFINITY) || a.order - b.order)
    .map(({ item }) => item);
  const cursor = mergeTimelineCoverage(currentCursor, { startSeq, endSeq, hasOlder: payload.hasOlder });
  const earliestLoadedSeq = Math.min(currentCursor.startSeq, ...(currentCursor.retainedRanges ?? []).map((range) => range.startSeq));
  const older: TimelinePathResult["older"] = startSeq <= earliestLoadedSeq ? (payload.hasOlder ? "available" : "none") : "unchanged";
  return { tail, head: reconciled.head, cursor, cursorChanged: !timelineCursorEquals(currentCursor, cursor), older, sideEffects: [], acknowledgedClientMessageIds: reconciled.acknowledgedClientMessageIds };
}

function acceptIncrementalTimelineUnits(units: TimelineUnit[], payload: TimelinePage, currentCursor: TimelineCursor | undefined): { acceptedUnits: TimelineUnit[]; cursor: TimelineCursor | undefined; gapCursor: { epoch: string; endSeq: number } | null } {
  const responseStartSeq = payload.startCursor?.seq ?? units[0]?.seq;
  const responseEndSeq = payload.endCursor?.seq ?? units.at(-1)?.seqEnd;
  if (responseStartSeq === undefined || responseEndSeq === undefined) return { acceptedUnits: [], cursor: currentCursor, gapCursor: null };
  if (!currentCursor) return { acceptedUnits: units, cursor: { epoch: payload.epoch, startSeq: responseStartSeq, endSeq: responseEndSeq }, gapCursor: null };
  if (currentCursor.epoch !== payload.epoch) return { acceptedUnits: [], cursor: currentCursor, gapCursor: null };
  const gap = { epoch: currentCursor.epoch, endSeq: currentCursor.endSeq };
  if ((!payload.startCursor || !payload.endCursor) && responseStartSeq <= currentCursor.endSeq && responseEndSeq > currentCursor.endSeq) return { acceptedUnits: [], cursor: currentCursor, gapCursor: gap };
  if (responseEndSeq <= currentCursor.endSeq) return { acceptedUnits: [], cursor: currentCursor, gapCursor: null };
  if (responseStartSeq > currentCursor.endSeq + 1) return { acceptedUnits: [], cursor: currentCursor, gapCursor: gap };
  return { acceptedUnits: units, cursor: { ...currentCursor, endSeq: responseEndSeq }, gapCursor: null };
}

function acceptOlderTimelineUnits(units: TimelineUnit[], payload: TimelinePage, currentCursor: TimelineCursor | undefined): { acceptedUnits: TimelineUnit[]; cursor: TimelineCursor | undefined } {
  if (!currentCursor || currentCursor.epoch !== payload.epoch) return { acceptedUnits: [], cursor: currentCursor };
  const responseStartSeq = payload.startCursor?.seq ?? units[0]?.seq;
  const responseEndSeq = payload.endCursor?.seq ?? units.at(-1)?.seqEnd;
  if (responseStartSeq === undefined || responseEndSeq === undefined || responseEndSeq !== currentCursor.startSeq - 1) return { acceptedUnits: [], cursor: currentCursor };
  return { acceptedUnits: units, cursor: mergeTimelineCoverage(currentCursor, { startSeq: responseStartSeq, endSeq: responseEndSeq, hasOlder: payload.hasOlder }) };
}

function applyTimelineIncrementalPath(units: TimelineUnit[], payload: TimelinePage, currentTail: StreamItem[], currentHead: StreamItem[], currentCursor: TimelineCursor | undefined): TimelinePathResult {
  if (units.length === 0 && payload.direction !== "before") return { tail: currentTail, head: currentHead, cursor: currentCursor, cursorChanged: false, older: "unchanged", sideEffects: [], acknowledgedClientMessageIds: [] };
  const older = payload.direction === "before";
  const accepted = older ? { ...acceptOlderTimelineUnits(units, payload, currentCursor), gapCursor: null } : acceptIncrementalTimelineUnits(units, payload, currentCursor);
  let tail = currentTail;
  let head = currentHead;
  let acknowledgedClientMessageIds: string[] = [];
  if (accepted.acceptedUnits.length > 0 && !older) {
    const applied = applyAcceptedForwardTimelineUnits(accepted.acceptedUnits, payload.epoch, currentTail, currentHead, currentCursor?.endSeq);
    tail = applied.tail;
    head = applied.head;
    acknowledgedClientMessageIds = applied.acknowledgedClientMessageIds;
  } else if (accepted.acceptedUnits.length > 0) {
    const page = hydrateStreamState(hydratedEventsOf(accepted.acceptedUnits, payload.epoch), { source: "canonical", reservedItemIds: reservedIdsOf(currentTail) });
    tail = mergeOlderTimelinePage(page, currentTail, payload.epoch, payload.startCursor?.seq ?? accepted.acceptedUnits[0]?.seq ?? 0, payload.endCursor?.seq ?? accepted.acceptedUnits.at(-1)?.seqEnd ?? 0);
  }
  const cursorChanged = accepted.cursor !== undefined && (!currentCursor || !timelineCursorEquals(currentCursor, accepted.cursor));
  let olderState: TimelinePathResult["older"] = "unchanged";
  if (older && accepted.cursor && currentCursor && accepted.cursor.startSeq !== currentCursor.startSeq) {
    const connected = currentCursor.retainedRanges?.find((range) => range.startSeq === accepted.cursor?.startSeq);
    olderState = (connected?.hasOlder ?? payload.hasOlder) ? "available" : "none";
  }
  return { tail, head, cursor: cursorChanged ? accepted.cursor : currentCursor, cursorChanged, older: olderState, sideEffects: accepted.gapCursor ? [{ type: "catch_up", cursor: accepted.gapCursor }] : [], acknowledgedClientMessageIds };
}

function selectEntriesOwnedByTimelinePage(payload: TimelinePage): TimelineResponseEntry[] {
  if (payload.direction !== "before" || payload.projection !== "projected" || !payload.startCursor || !payload.endCursor) return payload.entries;
  const start = payload.startCursor.seq;
  const end = payload.endCursor.seq;
  return payload.entries.filter((entry) => entry.seqStart >= start && entry.seqStart <= end);
}

export interface TimelineState {
  tail: StreamItem[];
  head: StreamItem[];
  cursor: TimelineCursor | undefined;
  hasOlder: boolean;
  initialized: boolean;
}

export const EMPTY_TIMELINE: TimelineState = { tail: [], head: [], cursor: undefined, hasOlder: false, initialized: false };

export interface TimelineResponseResult {
  state: TimelineState;
  error: string | null;
  sideEffects: TimelineSideEffect[];
  acknowledgedClientMessageIds: string[];
}

export function processTimelineResponse(payload: TimelinePage, current: TimelineState, sendingClientMessageIds: readonly string[]): TimelineResponseResult {
  if (payload.error) return { state: current, error: payload.error, sideEffects: [], acknowledgedClientMessageIds: [] };
  const units: TimelineUnit[] = selectEntriesOwnedByTimelinePage(payload).map((entry) => ({
    seq: entry.seqStart,
    seqEnd: entry.seqEnd,
    sourceSeqRanges: entry.sourceSeqRanges && entry.sourceSeqRanges.length > 0 ? entry.sourceSeqRanges : [{ startSeq: entry.seqStart, endSeq: entry.seqEnd }],
    event: { type: "timeline", provider: entry.provider, item: entry.item, ...(entry.turnId ? { turnId: entry.turnId } : {}) } as AgentStreamEvent,
    timestamp: new Date(entry.timestamp),
  }));
  const bootstrap = payload.reset || (payload.direction === "tail" && !current.initialized);
  const catchUp = !payload.reset && bootstrap && payload.endCursor ? { epoch: payload.epoch, endSeq: payload.endCursor.seq } : null;
  const resume = deriveResumeTailPolicy({ direction: payload.direction, reset: payload.reset, epoch: payload.epoch, windowMaxSeq: payload.window.maxSeq, pageStartSeq: payload.startCursor?.seq ?? null, currentCursor: current.cursor, bootstrapReplace: bootstrap });
  let result: TimelinePathResult;
  if (resume.kind === "discard") {
    result = { tail: current.tail, head: current.head, cursor: current.cursor, cursorChanged: false, older: "unchanged", sideEffects: [], acknowledgedClientMessageIds: deriveCanonicalAcknowledgements(units, payload.epoch, current.tail, current.head).filter((id) => sendingClientMessageIds.includes(id)) };
  } else if (payload.mergeWindow === true) {
    result = mergeTimelineWindow(units, payload, current.tail, current.head, current.cursor);
  } else if (bootstrap || resume.kind === "replace") {
    const preserveContinuity = resume.kind === "replace" ? resume.preserveContinuity : current.cursor?.epoch === payload.epoch || !payload.reset;
    const canonical = hydrateStreamState(hydratedEventsOf(units, payload.epoch), { source: "canonical" });
    const replaced = replaceWithCanonicalStream({ canonical, previousTail: current.tail, previousHead: current.head, sendingClientMessageIds, preserveContinuity, canonicalCoverage: { epoch: payload.epoch, endSeq: payload.endCursor?.seq ?? null } });
    result = {
      tail: replaced.tail,
      head: replaced.head,
      cursor: payload.startCursor && payload.endCursor ? { epoch: payload.epoch, startSeq: payload.startCursor.seq, endSeq: payload.endCursor.seq } : null,
      cursorChanged: true,
      older: payload.hasOlder ? "available" : "none",
      sideEffects: resume.kind !== "replace" && catchUp ? [{ type: "catch_up", cursor: catchUp }] : [],
      acknowledgedClientMessageIds: replaced.acknowledgedClientMessageIds,
    };
  } else {
    const incremental = resume.kind === "append" && current.cursor ? units.filter((unit) => unit.seqEnd > (current.cursor as TimelineCursor).endSeq) : units;
    result = applyTimelineIncrementalPath(incremental, payload, current.tail, current.head, current.cursor);
  }
  const complete = payload.direction !== "after" || !payload.hasNewer;
  return {
    state: {
      tail: result.tail,
      head: result.head,
      cursor: result.cursor ?? undefined,
      hasOlder: result.older === "unchanged" ? current.hasOlder : result.older === "available",
      initialized: current.initialized || complete,
    },
    error: null,
    sideEffects: result.sideEffects,
    acknowledgedClientMessageIds: result.acknowledgedClientMessageIds,
  };
}

export interface StreamEventInput {
  event: AgentStreamEvent;
  seq: number | undefined;
  epoch: string | undefined;
  timestamp: Date;
}

export interface StreamEventsResult {
  state: TimelineState;
  sideEffects: TimelineSideEffect[];
  acknowledgedClientMessageIds: string[];
}

function sequenceGate(event: AgentStreamEvent, seq: number | undefined, epoch: string | undefined, cursor: TimelineCursor | undefined, baseline: boolean): { apply: boolean; cursor: TimelineCursor | null; changed: boolean; reset: boolean; sideEffects: TimelineSideEffect[] } {
  const base = { apply: true, cursor: null, changed: false, reset: false, sideEffects: [] as TimelineSideEffect[] };
  if (event.type !== "timeline" || typeof seq !== "number" || typeof epoch !== "string" || !baseline) return base;
  const decision = classifySessionTimelineSeq(cursor ? { epoch: cursor.epoch, endSeq: cursor.endSeq } : null, epoch, seq);
  if (decision === "init") return { ...base, cursor: { epoch, startSeq: seq, endSeq: seq }, changed: true };
  if (decision === "accept") return { ...base, cursor: { ...(cursor ?? { epoch, startSeq: seq, endSeq: seq }), epoch, endSeq: seq }, changed: true };
  if (decision === "gap") return { ...base, apply: false, sideEffects: cursor ? [{ type: "catch_up", cursor: { epoch: cursor.epoch, endSeq: cursor.endSeq } }] : [] };
  if (decision === "drop_epoch" && seq === 1) return { ...base, cursor: { epoch, startSeq: seq, endSeq: seq }, changed: true, reset: true };
  return { ...base, apply: false };
}

export function processAgentStreamEvents(events: StreamEventInput[], current: TimelineState): StreamEventsResult {
  let { tail, head, cursor } = current;
  const sideEffects: TimelineSideEffect[] = [];
  const acknowledged = new Set<string>();
  const baseline = current.initialized;
  for (const { event, seq, epoch, timestamp } of events) {
    const gate = sequenceGate(event, seq, epoch, cursor, baseline);
    const timelineCursor = event.type === "timeline" && seq !== undefined && epoch !== undefined ? { epoch, seq } : undefined;
    sideEffects.push(...gate.sideEffects);
    if (gate.apply) {
      if (!baseline) {
        if (event.type === "timeline" && event.item.type === "user_message") {
          const applied = applyStreamEvent({ tail, head, event, timestamp, source: "live", timelineCursor, unmatchedUserMessageInsert: "head" });
          tail = applied.tail;
          head = applied.head;
          for (const id of applied.acknowledgedClientMessageIds ?? []) acknowledged.add(id);
        } else {
          const overlay = applyStreamEvent({ tail: head, head: [], event, timestamp, source: "live", timelineCursor });
          head = [...overlay.tail, ...overlay.head];
        }
      } else {
        const applied = applyStreamEvent({ tail: gate.reset ? [] : tail, head: gate.reset ? [] : head, event, timestamp, source: "live", timelineCursor });
        tail = applied.tail;
        head = applied.head;
        for (const id of applied.acknowledgedClientMessageIds ?? []) acknowledged.add(id);
      }
    }
    if (gate.changed) cursor = gate.cursor ?? undefined;
  }
  return { state: { ...current, tail, head, cursor }, sideEffects, acknowledgedClientMessageIds: [...acknowledged] };
}

export type TurnLiveness = { phase: "idle"; cancellationRequestId: number | null } | { phase: "open"; turnId: string | null; startedAt: Date | null; cancellationRequestId: number | null };

export type TurnLivenessTransition =
  | { type: "snapshot"; activeTurn: { turnId: string | null; startedAt: Date | null } | null }
  | { type: "stream_open"; turn: { turnId: string | null; startedAt: Date | null } }
  | { type: "stream_close"; turnId: string | null }
  | { type: "cancellation_started"; requestId: number }
  | { type: "cancellation_settled"; requestId: number };

export const TURN_LIVENESS_IDLE: TurnLiveness = { phase: "idle", cancellationRequestId: null };

export function reduceTurnLiveness(current: TurnLiveness, transition: TurnLivenessTransition): TurnLiveness {
  if (transition.type === "cancellation_started") return current.cancellationRequestId === transition.requestId ? current : { ...current, cancellationRequestId: transition.requestId };
  if (transition.type === "cancellation_settled") return current.cancellationRequestId !== transition.requestId ? current : { ...current, cancellationRequestId: null };
  if (transition.type === "stream_close") {
    const differentTurn = current.phase === "open" && transition.turnId !== null && current.turnId !== null && transition.turnId !== current.turnId;
    return differentTurn ? current : TURN_LIVENESS_IDLE;
  }
  const activeTurn = transition.type === "snapshot" ? transition.activeTurn : transition.turn;
  if (!activeTurn) return TURN_LIVENESS_IDLE;
  const sameTurn = current.phase === "open" && ((activeTurn.turnId !== null && current.turnId === activeTurn.turnId) || (activeTurn.turnId === null && current.turnId === null));
  return {
    phase: "open",
    turnId: activeTurn.turnId,
    startedAt: sameTurn ? (current.startedAt ?? activeTurn.startedAt) : activeTurn.startedAt,
    cancellationRequestId: sameTurn || current.phase === "idle" ? current.cancellationRequestId : null,
  };
}

export function turnLivenessOfEvents(events: readonly StreamEventInput[]): TurnLivenessTransition[] {
  const out: TurnLivenessTransition[] = [];
  for (const { event, timestamp } of events) {
    if (event.type === "turn_started") out.push({ type: "stream_open", turn: { turnId: event.turnId ?? null, startedAt: timestamp } });
    else if (event.type === "turn_completed" || event.type === "turn_failed" || event.type === "turn_canceled") out.push({ type: "stream_close", turnId: event.turnId ?? null });
  }
  return out;
}

export interface TurnPresentation {
  isActive: boolean;
  isCancelling: boolean;
  startedAt: Date | null;
  turnId: string | null;
}

export function resolveTurnPresentation(liveness: TurnLiveness, hasActiveSubmission: boolean): TurnPresentation {
  if (liveness.phase === "open") return { isActive: true, isCancelling: liveness.cancellationRequestId !== null, startedAt: liveness.startedAt, turnId: liveness.turnId };
  return { isActive: hasActiveSubmission, isCancelling: liveness.cancellationRequestId !== null, startedAt: null, turnId: null };
}
