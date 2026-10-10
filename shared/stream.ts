import type { AttachmentData } from "./rpc.ts";
import { extractTaskEntriesFromToolCall, normalizeTaskToolName, type ToolCallDetail } from "./tool-call.ts";

export interface AgentUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  contextWindowMaxTokens?: number;
  contextWindowUsedTokens?: number;
}

export interface AgentTaskEntry {
  text: string;
  completed: boolean;
  id?: string;
  status?: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export type TimelineItem =
  | { type: "user_message"; text: string; messageId?: string; clientMessageId?: string }
  | { type: "assistant_message"; text: string; messageId?: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; callId: string; name: string; status: "running" | "completed" | "failed" | "canceled"; error: unknown; detail: ToolCallDetail; metadata?: Record<string, unknown> }
  | { type: "todo"; items: AgentTaskEntry[] }
  | { type: "error"; message: string }
  | { type: "notification"; level: "info" | "warning" | "error"; message: string }
  | { type: "compaction"; status: "loading" | "completed"; trigger?: "auto" | "manual"; preTokens?: number }
  | { type: "plugin"; pluginId: string; id: string; kind: string; version: number; data: unknown };

export type AgentStreamEvent =
  | { type: "timeline"; provider: string; item: TimelineItem; turnId?: string }
  | { type: "thread_started"; provider: string; sessionId?: string }
  | { type: "turn_started"; provider: string; turnId?: string }
  | { type: "turn_completed"; provider: string; turnId?: string; usage?: AgentUsage }
  | { type: "turn_failed"; provider: string; turnId?: string; error?: string }
  | { type: "turn_canceled"; provider: string; turnId?: string; reason?: string }
  | { type: "usage_updated"; provider: string; usage: AgentUsage; turnId?: string }
  | { type: "permission_requested"; provider: string; request: unknown; turnId?: string }
  | { type: "permission_resolved"; provider: string; requestId: string; turnId?: string }
  | { type: "attention_required"; provider: string; reason?: string; turnId?: string }
  | { type: "mode_changed" | "model_changed" | "thinking_option_changed"; provider: string };

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function createTimelineId(prefix: string, text: string, timestamp: Date): string {
  return `${prefix}_${timestamp.getTime()}_${simpleHash(text)}`;
}

function createUniqueTimelineId(state: StreamItem[], prefix: string, text: string, timestamp: Date): string {
  return `${createTimelineId(prefix, text, timestamp)}_${state.length.toString(36)}`;
}

function createAssistantItemId(state: StreamItem[], messageId: string | undefined, text: string, timestamp: Date, reservedItemIds?: ReadonlySet<string>): string {
  if (!messageId) return createUniqueTimelineId(state, "assistant", text, timestamp);
  const isOccupied = (id: string) => reservedItemIds?.has(id) === true || state.some((item) => item.id === id);
  if (!isOccupied(messageId)) return messageId;
  const segmentId = `${messageId}:segment:${timestamp.getTime().toString(36)}`;
  if (!isOccupied(segmentId)) return segmentId;
  let suffix = 1;
  while (isOccupied(`${segmentId}:${suffix.toString(36)}`)) suffix += 1;
  return `${segmentId}:${suffix.toString(36)}`;
}

export interface TimelinePosition {
  epoch: string;
  seq: number;
}

export interface UserMessageImage {
  id: string;
  uri?: string;
  path?: string;
  mimeType?: string;
}

export interface UserMessageItem {
  kind: "user_message";
  id: string;
  clientMessageId?: string;
  messageId?: string;
  turnId?: string;
  timelineCursor?: TimelinePosition;
  text: string;
  timestamp: Date;
  images?: UserMessageImage[];
  attachments?: AttachmentData[];
  note?: string;
}

export interface AssistantMessageItem {
  kind: "assistant_message";
  id: string;
  messageId?: string;
  turnId?: string;
  timelineCursor?: TimelinePosition;
  text: string;
  timestamp: Date;
  blockGroupId?: string;
  blockIndex?: number;
}

export interface ThoughtItem {
  kind: "thought";
  id: string;
  timelineCursor?: TimelinePosition;
  turnId?: string;
  text: string;
  timestamp: Date;
  status: "loading" | "ready";
}

export type AgentToolCallStatus = "running" | "completed" | "failed" | "canceled";

export interface AgentToolCallData {
  provider: string;
  callId: string;
  name: string;
  status: AgentToolCallStatus;
  error: unknown;
  detail: ToolCallDetail;
  metadata?: Record<string, unknown>;
}

export interface ToolCallItem {
  kind: "tool_call";
  id: string;
  timelineCursor?: TimelinePosition;
  turnId?: string;
  timestamp: Date;
  payload: { source: "agent"; data: AgentToolCallData };
}

export interface NotificationItem {
  kind: "notification";
  sourceType: "error" | "notification";
  id: string;
  timelineCursor?: TimelinePosition;
  turnId?: string;
  timestamp: Date;
  level: "info" | "warning" | "error";
  message: string;
}

export interface PluginTimelineStreamItem {
  kind: "plugin";
  id: string;
  timelineCursor?: TimelinePosition;
  turnId?: string;
  timestamp: Date;
  pluginId: string;
  pluginItemId: string;
  itemKind: string;
  version: number;
  data: unknown;
}

export interface CompactionItem {
  kind: "compaction";
  id: string;
  timelineCursor?: TimelinePosition;
  turnId?: string;
  timestamp: Date;
  status: "loading" | "completed";
  trigger?: "auto" | "manual";
  preTokens?: number;
}

export type TodoEntry = AgentTaskEntry;

export type TaskActivity = { type: "created"; count: number } | { type: "added" | "started" | "completed"; task: string };

export interface TodoListItem {
  kind: "todo_list";
  id: string;
  timelineCursor?: TimelinePosition;
  turnId?: string;
  timestamp: Date;
  provider: string;
  items: TodoEntry[];
  activity: TaskActivity;
}

export interface PiggeryStreamItem {
  kind: "piggery";
  id: string;
  timelineCursor?: TimelinePosition;
  turnId?: string;
  timestamp: Date;
  prompt: boolean;
  source: { kind: "run-start" | "wake" | "mail" | "turn-end"; text: string; from?: string; to?: string; ref?: string; reply?: string; durationMs?: number; costUsd?: number };
}

export type StreamItem = UserMessageItem | AssistantMessageItem | ThoughtItem | ToolCallItem | TodoListItem | NotificationItem | CompactionItem | PluginTimelineStreamItem | PiggeryStreamItem;

export type StreamUpdateSource = "live" | "canonical";

export function createUserMessage(input: Omit<UserMessageItem, "kind" | "id"> & { id?: string }): UserMessageItem {
  const id = input.id ?? input.clientMessageId ?? input.messageId;
  if (!id) throw new Error("User message identity is required");
  return {
    kind: "user_message",
    id,
    ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.timelineCursor ? { timelineCursor: input.timelineCursor } : {}),
    text: input.text,
    timestamp: input.timestamp,
    ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
    ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
}

export function isUnreconciledLocalUserMessage(message: UserMessageItem): boolean {
  return message.clientMessageId !== undefined && message.messageId === undefined && message.timelineCursor === undefined;
}

export function appendSubmittedUserMessage(input: { tail: StreamItem[]; head: StreamItem[]; message: UserMessageItem }): { tail: StreamItem[]; head: StreamItem[] } {
  const clientMessageId = input.message.clientMessageId;
  if (!clientMessageId) throw new Error("Submitted user message requires client identity");
  if ([...input.tail, ...input.head].some((item) => item.kind === "user_message" && item.clientMessageId === clientMessageId)) throw new Error(`Submitted user message already exists: ${clientMessageId}`);
  return input.head.length > 0 ? { tail: input.tail, head: [...input.head, input.message] } : { tail: [...input.tail, input.message], head: input.head };
}

export function removeSubmittedUserMessage(input: { tail: StreamItem[]; head: StreamItem[]; clientMessageId: string }): { tail: StreamItem[]; head: StreamItem[] } {
  const remove = (items: StreamItem[]) => {
    const next = items.filter((item) => item.kind !== "user_message" || item.clientMessageId !== input.clientMessageId || !isUnreconciledLocalUserMessage(item));
    return next.length === items.length ? items : next;
  };
  return { tail: remove(input.tail), head: remove(input.head) };
}

function matchesLegacyCanonicalUserMessage(submitted: UserMessageItem, canonical: UserMessageItem): boolean {
  if (submitted.clientMessageId === undefined || submitted.messageId !== undefined) return false;
  if (canonical.messageId === undefined) return false;
  return canonical.messageId === submitted.clientMessageId || canonical.text === submitted.text;
}

function matchesUserMessage(existing: UserMessageItem, incoming: UserMessageItem): boolean {
  if (existing.clientMessageId && incoming.clientMessageId) return existing.clientMessageId === incoming.clientMessageId;
  if (existing.messageId && incoming.messageId) return existing.messageId === incoming.messageId;
  return matchesLegacyCanonicalUserMessage(existing, incoming);
}

interface UserMessageProduction {
  items: StreamItem[];
  index: number;
  message: UserMessageItem;
  matched: boolean;
}

function produceUserMessage(items: StreamItem[], incoming: UserMessageItem, insertAt: number | null, presentationPolicy: "existing" | "incoming"): UserMessageProduction {
  const index = items.findIndex((item) => item.kind === "user_message" && matchesUserMessage(item, incoming));
  if (index < 0) {
    if (insertAt === null) return { items, index: -1, message: incoming, matched: false };
    return { items: [...items.slice(0, insertAt), incoming, ...items.slice(insertAt)], index: insertAt, message: incoming, matched: false };
  }
  const existing = items[index] as UserMessageItem;
  const presentation = presentationPolicy === "incoming" ? incoming : existing;
  const merged = createUserMessage({
    ...presentation,
    clientMessageId: incoming.clientMessageId ?? existing.clientMessageId,
    messageId: incoming.messageId ?? existing.messageId,
    timelineCursor: incoming.timelineCursor ?? existing.timelineCursor,
  });
  if (
    existing.id === merged.id &&
    existing.clientMessageId === merged.clientMessageId &&
    existing.messageId === merged.messageId &&
    existing.timelineCursor === merged.timelineCursor &&
    existing.text === merged.text &&
    existing.timestamp === merged.timestamp &&
    existing.images === merged.images &&
    existing.attachments === merged.attachments
  ) {
    return { items, index, message: existing, matched: true };
  }
  const next = [...items];
  next[index] = merged;
  return { items: next, index, message: merged, matched: true };
}

function upsertUserMessage(items: StreamItem[], incoming: UserMessageItem): StreamItem[] {
  return produceUserMessage(items, incoming, items.length, "existing").items;
}

export interface ApplyStreamEventResult {
  tail: StreamItem[];
  head: StreamItem[];
  changedTail: boolean;
  changedHead: boolean;
  acknowledgedClientMessageIds?: string[];
}

export interface UserMessageStreamUpsertResult extends ApplyStreamEventResult {
  location: { lane: "tail" | "head"; index: number; message: UserMessageItem; matched: boolean } | null;
}

export function upsertUserMessageAcrossStream(input: { tail: StreamItem[]; head: StreamItem[]; message: UserMessageItem; insert: "tail" | "head" | "prepend-tail" | "none"; presentation: "existing" | "incoming" }): UserMessageStreamUpsertResult {
  const tailResult = produceUserMessage(input.tail, input.message, null, input.presentation);
  if (tailResult.matched) {
    return { tail: tailResult.items, head: input.head, changedTail: tailResult.items !== input.tail, changedHead: false, location: { lane: "tail", index: tailResult.index, message: tailResult.message, matched: true } };
  }
  const headResult = produceUserMessage(input.head, input.message, null, input.presentation);
  if (headResult.matched) {
    return { tail: input.tail, head: headResult.items, changedTail: false, changedHead: headResult.items !== input.head, location: { lane: "head", index: headResult.index, message: headResult.message, matched: true } };
  }
  if (input.insert === "none") return { tail: input.tail, head: input.head, changedTail: false, changedHead: false, location: null };
  if (input.insert === "head") {
    const inserted = produceUserMessage(input.head, input.message, input.head.length, input.presentation);
    return { tail: input.tail, head: inserted.items, changedTail: false, changedHead: true, location: { lane: "head", index: inserted.index, message: inserted.message, matched: false } };
  }
  const inserted = produceUserMessage(input.tail, input.message, input.insert === "prepend-tail" ? 0 : input.tail.length, input.presentation);
  return { tail: inserted.items, head: input.head, changedTail: true, changedHead: false, location: { lane: "tail", index: inserted.index, message: inserted.message, matched: false } };
}

function placeCanonicalUserMessageAtTail(tail: StreamItem[], message: UserMessageItem, insertWhenUnmatched: boolean): Pick<UserMessageProduction, "items" | "message" | "matched"> {
  const produced = produceUserMessage(tail, message, null, "existing");
  if (!produced.matched && !insertWhenUnmatched) return produced;
  const preceding = produced.matched ? [...produced.items.slice(0, produced.index), ...produced.items.slice(produced.index + 1)] : produced.items;
  return { items: [...preceding, produced.message], message: produced.message, matched: produced.matched };
}

export interface CanonicalStreamReplacementInput {
  canonical: StreamItem[];
  previousTail: StreamItem[];
  previousHead: StreamItem[];
  sendingClientMessageIds: readonly string[];
  preserveContinuity: boolean;
  canonicalCoverage: { epoch: string; endSeq: number | null };
}

export interface CanonicalStreamReplacementResult {
  tail: StreamItem[];
  head: StreamItem[];
  acknowledgedClientMessageIds: string[];
}

function isAfterCanonicalCoverage(position: TimelinePosition, coverage: CanonicalStreamReplacementInput["canonicalCoverage"]): boolean {
  return position.epoch === coverage.epoch && (coverage.endSeq === null || position.seq > coverage.endSeq);
}

function replaceTimelineIdentityItem(items: StreamItem[], retained: PluginTimelineStreamItem): StreamItem[] | null {
  const identity = streamTimelineItemIdentity(retained);
  if (identity === null) return null;
  const index = findExistingTimelineIdentityIndex(items, identity);
  const existing = items[index];
  if (index < 0 || !existing || existing.kind !== "plugin") return null;
  const next = [...items];
  next[index] = retained;
  return next;
}

function mergeRetainedLifecycleItem(tail: StreamItem[], retained: StreamItem): StreamItem[] | null {
  if (!retained.timelineCursor) return null;
  if (retained.kind === "plugin") return replaceTimelineIdentityItem(tail, retained);
  if (retained.kind === "tool_call") {
    const tailIndex = findExistingTimelineIdentityIndex(tail, agentToolCallIdentity(retained.payload.data.callId, retained.turnId));
    const existing = tail[tailIndex];
    if (tailIndex < 0 || !existing || existing.kind !== "tool_call") return null;
    const next = [...tail];
    next[tailIndex] = mergeAgentToolCallItem(existing, retained.payload.data, retained.timestamp, retained.timelineCursor);
    return next;
  }
  if (retained.kind === "todo_list") {
    const tailIndex = tail.length - 1;
    const existing = tail[tailIndex];
    if (!existing || existing.kind !== "todo_list" || existing.provider !== retained.provider) return null;
    const next = [...tail];
    next[tailIndex] = { ...existing, timelineCursor: retained.timelineCursor, timestamp: retained.timestamp, items: retained.items };
    return next;
  }
  if (retained.kind === "compaction" && retained.status === "completed") {
    const tailIndex = tail.findIndex((item) => item.kind === "compaction" && item.status === "loading");
    const existing = tail[tailIndex];
    if (tailIndex < 0 || !existing || existing.kind !== "compaction") return null;
    const next = [...tail];
    next[tailIndex] = { ...existing, timelineCursor: retained.timelineCursor, status: "completed", trigger: retained.trigger ?? existing.trigger, preTokens: retained.preTokens ?? existing.preTokens };
    return next;
  }
  return null;
}

function reconcileReplacementHeadAgainstTail(tail: StreamItem[], retainedHead: StreamItem[]): { tail: StreamItem[]; head: StreamItem[] } {
  let reconciledTail = tail;
  const reconciledHeadIndexes = new Set<number>();
  retainedHead.forEach((item, headIndex) => {
    const nextTail = mergeRetainedLifecycleItem(reconciledTail, item);
    if (!nextTail) return;
    reconciledTail = nextTail;
    reconciledHeadIndexes.add(headIndex);
  });
  const tailIds = new Set(reconciledTail.map((item) => item.id));
  return { tail: reconciledTail, head: retainedHead.filter((item, index) => !reconciledHeadIndexes.has(index) && (item.kind === "assistant_message" || !tailIds.has(item.id))) };
}

function preserveReplacementHead(tail: StreamItem[], currentHead: StreamItem[], preserveContinuity: boolean, sendingClientMessageIds: ReadonlySet<string>, canonicalCoverage: CanonicalStreamReplacementInput["canonicalCoverage"]): CanonicalStreamReplacementResult {
  const canonicalTailAssistant = tail.at(-1);
  const retainedHead = preserveContinuity
    ? currentHead.filter(
        (item) =>
          !item.timelineCursor ||
          isAfterCanonicalCoverage(item.timelineCursor, canonicalCoverage) ||
          (item.kind === "assistant_message" && canonicalTailAssistant?.kind === "assistant_message" && item.text.startsWith(canonicalTailAssistant.text)),
      )
    : currentHead.filter((item) => item.kind === "user_message" && item.clientMessageId !== undefined && sendingClientMessageIds.has(item.clientMessageId));
  const { tail: reconciledTail, head: unreconciledHead } = reconcileReplacementHeadAgainstTail(tail, retainedHead);
  const liveAssistant = unreconciledHead[0];
  const tailAssistant = reconciledTail.at(-1);
  if (liveAssistant?.kind !== "assistant_message" || tailAssistant?.kind !== "assistant_message") return { tail: reconciledTail, head: unreconciledHead, acknowledgedClientMessageIds: [] };
  const hasNewerCursor = liveAssistant.timelineCursor !== undefined && tailAssistant.timelineCursor !== undefined && liveAssistant.timelineCursor.epoch === tailAssistant.timelineCursor.epoch && liveAssistant.timelineCursor.seq > tailAssistant.timelineCursor.seq;
  const hasMatchingProviderMessageId = liveAssistant.messageId !== undefined && liveAssistant.messageId === tailAssistant.messageId;
  const hasIdlessTextContinuation = liveAssistant.messageId === undefined && tailAssistant.messageId === undefined && liveAssistant.text.startsWith(tailAssistant.text);
  if (hasNewerCursor && (hasMatchingProviderMessageId || hasIdlessTextContinuation)) {
    const text = liveAssistant.text.startsWith(tailAssistant.text) ? liveAssistant.text : `${tailAssistant.text}${liveAssistant.text}`;
    return { tail: reconciledTail.slice(0, -1), head: [{ ...liveAssistant, text }, ...unreconciledHead.slice(1)], acknowledgedClientMessageIds: [] };
  }
  if (!liveAssistant.text.startsWith(tailAssistant.text)) return { tail: reconciledTail, head: unreconciledHead, acknowledgedClientMessageIds: [] };
  return { tail: reconciledTail.slice(0, -1), head: [{ ...liveAssistant, text: tailAssistant.text }, ...unreconciledHead.slice(1)], acknowledgedClientMessageIds: [] };
}

export function replaceWithCanonicalStream(input: CanonicalStreamReplacementInput): CanonicalStreamReplacementResult {
  const sendingClientMessageIds = new Set(input.sendingClientMessageIds);
  let unmatchedTailMessages = input.previousTail.filter((item): item is UserMessageItem => item.kind === "user_message" && item.clientMessageId !== undefined);
  let nextHead = input.previousHead;
  const nextTail: StreamItem[] = [];
  const acknowledged = new Set<string>();
  for (const item of input.canonical) {
    if (item.kind !== "user_message") {
      nextTail.push(item);
      continue;
    }
    const tailResult = produceUserMessage(unmatchedTailMessages, item, null, "existing");
    if (tailResult.matched) {
      unmatchedTailMessages = [...unmatchedTailMessages.slice(0, tailResult.index), ...unmatchedTailMessages.slice(tailResult.index + 1)];
      nextTail.push(tailResult.message);
      if (tailResult.message.clientMessageId) acknowledged.add(tailResult.message.clientMessageId);
      continue;
    }
    const headResult = produceUserMessage(nextHead, item, null, "existing");
    if (headResult.matched) {
      nextHead = [...headResult.items.slice(0, headResult.index), ...headResult.items.slice(headResult.index + 1)];
      nextTail.push(headResult.message);
      if (headResult.message.clientMessageId) acknowledged.add(headResult.message.clientMessageId);
      continue;
    }
    nextTail.push(item);
  }
  const retainedTailMessages: UserMessageItem[] = [];
  for (const local of unmatchedTailMessages) {
    const preserveLocal = input.preserveContinuity ? isUnreconciledLocalUserMessage(local) : local.clientMessageId !== undefined && sendingClientMessageIds.has(local.clientMessageId);
    if (preserveLocal) nextTail.push(local);
    else if (input.preserveContinuity && local.timelineCursor && isAfterCanonicalCoverage(local.timelineCursor, input.canonicalCoverage)) retainedTailMessages.push(local);
  }
  nextHead = [...retainedTailMessages, ...nextHead];
  const replacement = preserveReplacementHead(nextTail, nextHead, input.preserveContinuity, sendingClientMessageIds, input.canonicalCoverage);
  return { ...replacement, acknowledgedClientMessageIds: [...acknowledged] };
}

function normalizeChunk(text: string): { chunk: string; hasContent: boolean } {
  if (!text) return { chunk: "", hasContent: false };
  const chunk = text.replace(/\r/g, "");
  if (!chunk) return { chunk: "", hasContent: false };
  return { chunk, hasContent: /\S/.test(chunk) };
}

function markThoughtReady(item: ThoughtItem): ThoughtItem {
  return item.status === "ready" ? item : { ...item, status: "ready" };
}

function appendUserMessage(state: StreamItem[], text: string, timestamp: Date, messageId?: string, clientMessageId?: string, timelineCursor?: TimelinePosition, turnId?: string): StreamItem[] {
  const { chunk, hasContent } = normalizeChunk(text);
  if (!hasContent) return state;
  const seed = chunk.trim() || chunk;
  return upsertUserMessage(state, createUserMessage({ id: messageId ?? createUniqueTimelineId(state, "user", seed, timestamp), clientMessageId, messageId, timelineCursor, turnId, text: chunk, timestamp }));
}

function appendAssistantMessage(state: StreamItem[], text: string, timestamp: Date, source: StreamUpdateSource, messageId?: string, reservedItemIds?: ReadonlySet<string>, timelineCursor?: TimelinePosition): StreamItem[] {
  const { chunk, hasContent } = normalizeChunk(text);
  if (!chunk) return state;
  const last = state[state.length - 1];
  if (last && last.kind === "assistant_message" && (messageId === undefined || last.messageId === messageId)) {
    return [...state.slice(0, -1), { ...last, text: `${last.text}${chunk}`, timestamp, ...(timelineCursor ? { timelineCursor } : {}) }];
  }
  const secondLast = state[state.length - 2];
  if (source === "live" && last?.kind === "user_message" && secondLast?.kind === "assistant_message" && (messageId === undefined || secondLast.messageId === messageId)) {
    return [...state.slice(0, -2), { ...secondLast, text: `${secondLast.text}${chunk}`, timestamp, ...(timelineCursor ? { timelineCursor } : {}) }, last];
  }
  if (!hasContent) return state;
  const id = createAssistantItemId(state, messageId, chunk.trim() || chunk, timestamp, reservedItemIds);
  return [...state, { kind: "assistant_message", id, ...(messageId ? { messageId } : {}), ...(timelineCursor ? { timelineCursor } : {}), text: chunk, timestamp }];
}

function appendThought(state: StreamItem[], text: string, timestamp: Date, timelineCursor?: TimelinePosition): StreamItem[] {
  const { chunk, hasContent } = normalizeChunk(text);
  if (!chunk) return state;
  const last = state[state.length - 1];
  if (last && last.kind === "thought") {
    return [...state.slice(0, -1), { ...last, ...(timelineCursor ? { timelineCursor } : {}), text: `${last.text}${chunk}`, timestamp, status: "loading" }];
  }
  if (!hasContent) return state;
  return [...state, { kind: "thought", id: createUniqueTimelineId(state, "thought", chunk.trim() || chunk, timestamp), ...(timelineCursor ? { timelineCursor } : {}), text: chunk, timestamp, status: "loading" }];
}

function finalizeActiveThoughts(state: StreamItem[]): StreamItem[] {
  let mutated = false;
  const next = state.map((entry) => {
    if (entry.kind === "thought" && entry.status !== "ready") {
      mutated = true;
      return markThoughtReady(entry);
    }
    return entry;
  });
  return mutated ? next : state;
}

export function streamTimelineItemIdentity(item: StreamItem): string | null {
  if (item.kind === "tool_call") return agentToolCallIdentity(item.payload.data.callId, item.turnId);
  if (item.kind === "plugin") return `${item.pluginId}/${item.pluginItemId}`;
  return null;
}

function agentToolCallIdentity(callId: string, turnId: string | undefined): string {
  if (!turnId) return callId;
  return `turn:${encodeURIComponent(turnId)}/${encodeURIComponent(callId)}`;
}

function findExistingTimelineIdentityIndex(state: StreamItem[], identity: string): number {
  return state.findIndex((entry) => streamTimelineItemIdentity(entry) === identity);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNonEmptyObject(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length > 0;
}

function mergeUnknownValue(existing: unknown, incoming: unknown): unknown {
  if (incoming === null) return existing;
  if (!hasNonEmptyObject(incoming) && hasNonEmptyObject(existing)) return existing;
  return incoming;
}

function hasSameIncomingFields<T extends object>(existing: T, incoming: T): boolean {
  return Object.entries(incoming).every(([key, value]) => (existing as Record<string, unknown>)[key] === value);
}

function mergeToolCallMetadata(existing: Record<string, unknown> | undefined, incoming: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (hasSameIncomingFields(existing, incoming)) return existing;
  return { ...existing, ...incoming };
}

export function mergeToolCallDetail(existing: ToolCallDetail, incoming: ToolCallDetail): ToolCallDetail {
  if (existing.type === "unknown" && incoming.type !== "unknown") return incoming;
  if (incoming.type === "unknown" && existing.type !== "unknown") return existing;
  if (existing.type === "unknown" && incoming.type === "unknown") {
    const input = mergeUnknownValue(existing.input, incoming.input);
    const output = mergeUnknownValue(existing.output, incoming.output);
    if (input === existing.input && output === existing.output) return existing;
    return { type: "unknown", input, output };
  }
  if (existing.type === incoming.type) {
    if (hasSameIncomingFields(existing, incoming)) return existing;
    return { ...existing, ...incoming } as ToolCallDetail;
  }
  return incoming;
}

function mergeAgentToolCallStatus(existing: AgentToolCallStatus, incoming: AgentToolCallStatus): AgentToolCallStatus {
  if (existing === "failed" || incoming === "failed") return "failed";
  if (existing === "canceled") return "canceled";
  if (incoming === "canceled") return existing === "completed" ? "completed" : "canceled";
  if (existing === "completed" || incoming === "completed") return "completed";
  return "running";
}

export function mergeAgentToolCallItem(existing: ToolCallItem, data: AgentToolCallData, timestamp: Date, timelineCursor?: TimelinePosition): ToolCallItem {
  const status = mergeAgentToolCallStatus(existing.payload.data.status, data.status);
  const error = status === "failed" ? (data.error ?? existing.payload.data.error ?? { message: "Tool call failed" }) : null;
  return {
    ...existing,
    ...(timelineCursor ? { timelineCursor } : {}),
    timestamp,
    payload: {
      source: "agent",
      data: { ...existing.payload.data, ...data, status, error, detail: mergeToolCallDetail(existing.payload.data.detail, data.detail), metadata: mergeToolCallMetadata(existing.payload.data.metadata, data.metadata) },
    },
  };
}

function appendAgentToolCall(state: StreamItem[], data: AgentToolCallData, timestamp: Date, turnId: string | undefined, timelineCursor?: TimelinePosition): StreamItem[] {
  const identity = agentToolCallIdentity(data.callId, turnId);
  const existingIndex = findExistingTimelineIdentityIndex(state, identity);
  if (existingIndex >= 0) {
    const existing = state[existingIndex] as ToolCallItem;
    const merged = mergeAgentToolCallItem(existing, data, timestamp, timelineCursor);
    const a = merged.payload.data;
    const b = existing.payload.data;
    if (a.provider === b.provider && a.callId === b.callId && a.name === b.name && a.status === b.status && a.error === b.error && a.detail === b.detail && a.metadata === b.metadata && merged.timelineCursor === existing.timelineCursor) return state;
    const next = [...state];
    next[existingIndex] = merged;
    return next;
  }
  return [...state, { kind: "tool_call", id: `agent_tool_${identity}`, ...(timelineCursor ? { timelineCursor } : {}), ...(turnId ? { turnId } : {}), timestamp, payload: { source: "agent", data: { ...data, error: data.status === "failed" ? data.error : null } } }];
}

function appendNotification(state: StreamItem[], entry: NotificationItem): StreamItem[] {
  const index = state.findIndex((existing) => existing.id === entry.id);
  if (index < 0) return [...state, entry];
  const next = [...state];
  next[index] = entry;
  return next;
}

function appendPluginTimelineItem(state: StreamItem[], item: Extract<TimelineItem, { type: "plugin" }>, timestamp: Date, timelineCursor?: TimelinePosition): StreamItem[] {
  const identity = `${item.pluginId}/${item.id}`;
  const nextItem: PluginTimelineStreamItem = { kind: "plugin", id: identity, pluginId: item.pluginId, pluginItemId: item.id, itemKind: item.kind, version: item.version, data: item.data, timestamp, ...(timelineCursor ? { timelineCursor } : {}) };
  const existingIndex = findExistingTimelineIdentityIndex(state, identity);
  if (existingIndex < 0) return [...state, nextItem];
  const existing = state[existingIndex];
  if (!existing || existing.kind !== "plugin") return state;
  const next = [...state];
  next[existingIndex] = { ...nextItem, id: existing.id };
  return next;
}

function taskStatus(task: TodoEntry): NonNullable<TodoEntry["status"]> {
  if (task.completed || task.status === "completed") return "completed";
  return task.status === "in_progress" ? "in_progress" : "pending";
}

function taskKey(task: TodoEntry, index: number): string {
  return task.id ?? `${index}:${task.text}`;
}

function deriveTaskActivities(previous: readonly TodoEntry[], current: readonly TodoEntry[]): TaskActivity[] {
  if (previous.length === 0) return current.length > 0 ? [{ type: "created", count: current.length }] : [];
  const previousByKey = new Map(previous.map((task, index) => [taskKey(task, index), task]));
  const activities: TaskActivity[] = [];
  current.forEach((task, index) => {
    const prior = previousByKey.get(taskKey(task, index));
    if (!prior) {
      activities.push({ type: "added", task: task.text });
      return;
    }
    const before = taskStatus(prior);
    const after = taskStatus(task);
    if (before === after) return;
    if (after === "completed") activities.push({ type: "completed", task: task.text });
    else if (after === "in_progress") activities.push({ type: "started", task: task.text });
  });
  return activities;
}

function appendTodoList(state: StreamItem[], provider: string, items: TodoEntry[], timestamp: Date, timelineCursor?: TimelinePosition): StreamItem[] {
  const normalizedItems = items.map((item) => ({ text: item.text, completed: item.completed, ...(item.id ? { id: item.id } : {}), ...(item.status ? { status: item.status } : {}), ...(item.activeForm ? { activeForm: item.activeForm } : {}) }));
  const previousIndex = state.findLastIndex((item) => item.kind === "todo_list" && item.provider === provider);
  const previous = state[previousIndex];
  const previousItems = previous?.kind === "todo_list" ? previous.items : [];
  const activities = deriveTaskActivities(previousItems, normalizedItems);
  if (activities.length === 0) {
    if (!previous || previous.kind !== "todo_list") return state;
    const next = [...state];
    next[previousIndex] = { ...previous, ...(timelineCursor ? { timelineCursor } : {}), items: normalizedItems, timestamp };
    return next;
  }
  const lastItem = state[state.length - 1];
  if (activities.length === 1 && activities[0]?.type === "added" && lastItem?.kind === "todo_list" && lastItem.provider === provider && lastItem.activity.type === "created" && normalizedItems.every((item) => taskStatus(item) === "pending")) {
    const next = [...state];
    next[next.length - 1] = { ...lastItem, ...(timelineCursor ? { timelineCursor } : {}), items: normalizedItems, activity: { type: "created", count: normalizedItems.length }, timestamp };
    return next;
  }
  const next = [...state];
  for (const activity of activities) {
    const seed = `${provider}:${JSON.stringify(activity)}:${JSON.stringify(normalizedItems)}`;
    next.push({ kind: "todo_list", id: createUniqueTimelineId(next, "todo", seed, timestamp), ...(timelineCursor ? { timelineCursor } : {}), timestamp, provider, items: normalizedItems, activity });
  }
  return next;
}

function reduceTimelineToolCall(state: StreamItem[], provider: string, turnId: string | undefined, item: Extract<TimelineItem, { type: "tool_call" }>, timestamp: Date, timelineCursor?: TimelinePosition): StreamItem[] {
  const normalized = normalizeTaskToolName(item.name);
  const input = item.detail.type === "unknown" ? item.detail.input : null;
  if (provider === "claude" && (normalized === "todowrite" || normalized === "todo_write")) {
    const tasks = extractTaskEntriesFromToolCall(item.name, input);
    if (!tasks) return state;
    return appendTodoList(state, provider, tasks.map((entry) => ({ text: entry.text, completed: entry.completed })), timestamp, timelineCursor);
  }
  if (provider === "claude" && (normalized === "taskcreate" || normalized === "taskupdate" || normalized === "tasklist")) return state;
  const tasks = extractTaskEntriesFromToolCall(item.name, input);
  if (tasks) return appendTodoList(state, provider, tasks.map((entry) => ({ text: entry.text, completed: entry.completed })), timestamp, timelineCursor);
  return appendAgentToolCall(state, { provider, callId: item.callId, name: item.name, status: item.status, error: item.error, detail: item.detail, metadata: item.metadata }, timestamp, turnId, timelineCursor);
}

function reduceTimelineCompaction(state: StreamItem[], item: Extract<TimelineItem, { type: "compaction" }>, timestamp: Date, timelineCursor?: TimelinePosition): StreamItem[] {
  if (item.status === "completed") {
    const loadingIndex = state.findIndex((s) => s.kind === "compaction" && s.status === "loading");
    const existing = state[loadingIndex];
    if (loadingIndex >= 0 && existing?.kind === "compaction") {
      return [...state.slice(0, loadingIndex), { ...existing, ...(timelineCursor ? { timelineCursor } : {}), status: "completed", trigger: item.trigger ?? existing.trigger, preTokens: item.preTokens ?? existing.preTokens }, ...state.slice(loadingIndex + 1)];
    }
    if (loadingIndex >= 0) return state;
  }
  return [...state, { kind: "compaction", id: createUniqueTimelineId(state, "compaction", item.status, timestamp), ...(timelineCursor ? { timelineCursor } : {}), timestamp, status: item.status, trigger: item.trigger, preTokens: item.preTokens }];
}

function reduceTimelineEvent(state: StreamItem[], event: Extract<AgentStreamEvent, { type: "timeline" }>, timestamp: Date, source: StreamUpdateSource, reservedItemIds?: ReadonlySet<string>, timelineCursor?: TimelinePosition): StreamItem[] {
  const item = event.item;
  switch (item.type) {
    case "user_message":
      return finalizeActiveThoughts(appendUserMessage(state, item.text, timestamp, item.messageId, item.clientMessageId, timelineCursor, event.turnId));
    case "assistant_message":
      return finalizeActiveThoughts(appendAssistantMessage(state, item.text, timestamp, source, item.messageId, reservedItemIds, timelineCursor));
    case "reasoning":
      return appendThought(state, item.text, timestamp, timelineCursor);
    case "tool_call":
      return finalizeActiveThoughts(reduceTimelineToolCall(state, event.provider, event.turnId, item, timestamp, timelineCursor));
    case "todo":
      return finalizeActiveThoughts(appendTodoList(state, event.provider, (item.items ?? []).map((todo) => ({ text: todo.text, completed: todo.completed, id: todo.id, status: todo.status, activeForm: todo.activeForm })), timestamp, timelineCursor));
    case "error":
      return finalizeActiveThoughts(appendNotification(state, { kind: "notification", sourceType: "error", id: createUniqueTimelineId(state, "error", item.message ?? "", timestamp), ...(timelineCursor ? { timelineCursor } : {}), timestamp, level: "error", message: item.message ?? "Unknown error" }));
    case "notification":
      return finalizeActiveThoughts(appendNotification(state, { kind: "notification", sourceType: "notification", id: createUniqueTimelineId(state, "notification", item.message, timestamp), ...(timelineCursor ? { timelineCursor } : {}), timestamp, level: item.level, message: item.message }));
    case "plugin":
      return finalizeActiveThoughts(appendPluginTimelineItem(state, item, timestamp, timelineCursor));
    case "compaction":
      return finalizeActiveThoughts(reduceTimelineCompaction(state, item, timestamp, timelineCursor));
    default:
      return state;
  }
}

function reconcileCanonicalUserTurnMembership(items: StreamItem[], clientMessageId: string, turnId: string | undefined): StreamItem[] {
  const index = items.findIndex((item) => item.kind === "user_message" && item.clientMessageId === clientMessageId);
  const matched = items[index];
  if (!matched || matched.kind !== "user_message" || matched.turnId === turnId) return items;
  const { turnId: _, ...withoutTurnId } = matched;
  const next: UserMessageItem = turnId ? { ...matched, turnId } : withoutTurnId;
  return [...items.slice(0, index), next, ...items.slice(index + 1)];
}

function applyTimelineTurnId(items: StreamItem[], event: Extract<AgentStreamEvent, { type: "timeline" }>): StreamItem[] {
  const clientMessageId = event.item.type === "user_message" ? event.item.clientMessageId : undefined;
  if (clientMessageId) return reconcileCanonicalUserTurnMembership(items, clientMessageId, event.turnId);
  if (!event.turnId || items.length === 0) return items;
  const last = items[items.length - 1];
  if (!last || last.turnId === event.turnId) return items;
  return [...items.slice(0, -1), { ...last, turnId: event.turnId } as StreamItem];
}

export function reduceStreamUpdate(state: StreamItem[], event: AgentStreamEvent, timestamp: Date, options?: { source?: StreamUpdateSource; reservedItemIds?: ReadonlySet<string>; timelineCursor?: TimelinePosition }): StreamItem[] {
  switch (event.type) {
    case "timeline":
      return applyTimelineTurnId(reduceTimelineEvent(state, event, timestamp, options?.source ?? "live", options?.reservedItemIds, options?.timelineCursor), event);
    case "thread_started":
    case "turn_started":
    case "turn_completed":
    case "turn_failed":
    case "turn_canceled":
    case "permission_requested":
    case "permission_resolved":
    case "attention_required":
      return finalizeActiveThoughts(state);
    default:
      return state;
  }
}

export function hydrateStreamState(events: Array<{ event: AgentStreamEvent; timestamp: Date; timelineCursor?: TimelinePosition }>, options?: { source?: StreamUpdateSource; reservedItemIds?: ReadonlySet<string> }): StreamItem[] {
  return finalizeActiveThoughts(events.reduce<StreamItem[]>((state, { event, timestamp, timelineCursor }) => reduceStreamUpdate(state, event, timestamp, { ...options, timelineCursor }), []));
}

const STREAMABLE_KINDS = new Set<StreamItem["kind"]>(["assistant_message", "thought"]);
const STREAM_COMPLETION_EVENTS = new Set<AgentStreamEvent["type"]>(["turn_completed", "turn_failed", "turn_canceled"]);

function getEventItemKind(event: AgentStreamEvent): StreamItem["kind"] | null {
  if (event.type !== "timeline") return null;
  switch (event.item.type) {
    case "user_message":
      return "user_message";
    case "assistant_message":
      return "assistant_message";
    case "reasoning":
      return "thought";
    case "tool_call":
      return "tool_call";
    case "todo":
      return "todo_list";
    case "error":
    case "notification":
      return "notification";
    case "plugin":
      return "plugin";
    default:
      return null;
  }
}

function getIncomingAssistantMessageId(event: AgentStreamEvent): string | undefined {
  return event.type === "timeline" && event.item.type === "assistant_message" ? event.item.messageId : undefined;
}

function getActiveAssistantHeadIndex(head: StreamItem[]): number {
  return head.findLastIndex((item) => item.kind === "assistant_message");
}

export function flushHeadToTail(tail: StreamItem[], head: StreamItem[]): StreamItem[] {
  if (head.length === 0) return tail;
  const finalized = head.map((item) => (item.kind === "thought" ? markThoughtReady(item) : item));
  const tailIds = new Set(tail.map((item) => item.id));
  const newItems = finalized.filter((item) => !tailIds.has(item.id));
  return newItems.length === 0 ? tail : [...tail, ...newItems];
}

function shouldFlushHead(head: StreamItem[], incomingKind: StreamItem["kind"] | null, event: AgentStreamEvent): boolean {
  if (head.length === 0 || incomingKind === null) return false;
  if (!STREAMABLE_KINDS.has(incomingKind)) return true;
  const lastStreamable = head.findLast((item) => STREAMABLE_KINDS.has(item.kind));
  if (!lastStreamable || lastStreamable.kind !== incomingKind) return true;
  if (lastStreamable.kind === "assistant_message") {
    const incomingMessageId = getIncomingAssistantMessageId(event);
    return incomingMessageId !== undefined && lastStreamable.messageId !== incomingMessageId;
  }
  return false;
}

function applyCanonicalUserMessageEvent(params: { tail: StreamItem[]; head: StreamItem[]; event: AgentStreamEvent; timestamp: Date; timelineCursor?: TimelinePosition; unmatchedInsert?: "tail" | "head" }): ApplyStreamEventResult | null {
  const { tail, head, event, timestamp, timelineCursor, unmatchedInsert = "tail" } = params;
  if (event.type !== "timeline" || event.item.type !== "user_message") return null;
  const normalized = normalizeChunk(event.item.text);
  const flushedTail = head.length > 0 ? flushHeadToTail(tail, head) : tail;
  const flushedHead = head.length > 0 ? [] : head;
  const canonical = createUserMessage({
    id: event.item.messageId ?? createUniqueTimelineId([...tail, ...head], "user", normalized.chunk.trim(), timestamp),
    messageId: event.item.messageId,
    clientMessageId: event.item.clientMessageId,
    turnId: event.turnId,
    timelineCursor,
    text: normalized.chunk,
    timestamp,
  });
  const reconcile = (items: StreamItem[]) => (canonical.clientMessageId ? reconcileCanonicalUserTurnMembership(items, canonical.clientMessageId, event.turnId) : items);
  if (unmatchedInsert === "head") {
    const reconciled = upsertUserMessageAcrossStream({ tail, head, message: canonical, insert: normalized.hasContent ? "head" : "none", presentation: "existing" });
    const nextTail = reconcile(reconciled.tail);
    const nextHead = reconcile(reconciled.head);
    return {
      tail: nextTail,
      head: nextHead,
      changedTail: reconciled.changedTail || nextTail !== reconciled.tail,
      changedHead: reconciled.changedHead || nextHead !== reconciled.head,
      acknowledgedClientMessageIds: reconciled.location?.matched && reconciled.location.message.clientMessageId ? [reconciled.location.message.clientMessageId] : [],
    };
  }
  const reconciled = placeCanonicalUserMessageAtTail(flushedTail, canonical, normalized.hasContent);
  const nextTail = reconcile(reconciled.items);
  return {
    tail: nextTail,
    head: flushedHead,
    changedTail: flushedTail !== tail || nextTail !== flushedTail,
    changedHead: flushedHead !== head,
    acknowledgedClientMessageIds: reconciled.matched && reconciled.message.clientMessageId ? [reconciled.message.clientMessageId] : [],
  };
}

export function applyStreamEvent(params: { tail: StreamItem[]; head: StreamItem[]; event: AgentStreamEvent; timestamp: Date; source?: StreamUpdateSource; timelineCursor?: TimelinePosition; unmatchedUserMessageInsert?: "tail" | "head" }): ApplyStreamEventResult {
  const { tail, head, event, timestamp } = params;
  const canonicalUser = applyCanonicalUserMessageEvent({ tail, head, event, timestamp, timelineCursor: params.timelineCursor, unmatchedInsert: params.unmatchedUserMessageInsert });
  if (canonicalUser) return canonicalUser;
  const source = params.source ?? "live";
  let nextTail = tail;
  let nextHead = head;
  let changedTail = false;
  let changedHead = false;
  const flushHead = () => {
    if (nextHead.length === 0) return;
    const flushed = flushHeadToTail(nextTail, nextHead);
    if (flushed !== nextTail) {
      nextTail = flushed;
      changedTail = true;
    }
    nextHead = [];
    changedHead = true;
  };
  if (STREAM_COMPLETION_EVENTS.has(event.type)) {
    flushHead();
    const finalized = reduceStreamUpdate(finalizeActiveThoughts(nextTail), event, timestamp, { source });
    if (finalized !== nextTail) {
      nextTail = finalized;
      changedTail = true;
    }
    return { tail: nextTail, head: nextHead, changedTail, changedHead };
  }
  const incomingKind = getEventItemKind(event);
  if (shouldFlushHead(nextHead, incomingKind, event)) flushHead();
  const tailLast = nextTail.at(-1);
  const incomingMessageId = getIncomingAssistantMessageId(event);
  if (incomingKind === "assistant_message" && nextHead.length === 0 && tailLast?.kind === "assistant_message" && (incomingMessageId === undefined || tailLast.messageId === incomingMessageId)) {
    nextTail = nextTail.slice(0, -1);
    nextHead = [tailLast];
    changedTail = true;
    changedHead = true;
  }
  if (incomingKind !== null && STREAMABLE_KINDS.has(incomingKind)) {
    const reservedItemIds = incomingKind === "assistant_message" && getActiveAssistantHeadIndex(nextHead) < 0 ? new Set(nextTail.map((item) => item.id)) : undefined;
    const reduced = reduceStreamUpdate(nextHead, event, timestamp, { source, reservedItemIds, timelineCursor: params.timelineCursor });
    if (reduced !== nextHead) {
      nextHead = reduced;
      changedHead = true;
    }
    return { tail: nextTail, head: nextHead, changedTail, changedHead };
  }
  const reduced = reduceStreamUpdate(nextTail, event, timestamp, { source, timelineCursor: params.timelineCursor });
  if (reduced !== nextTail) {
    nextTail = reduced;
    changedTail = true;
  }
  return { tail: nextTail, head: nextHead, changedTail, changedHead };
}
