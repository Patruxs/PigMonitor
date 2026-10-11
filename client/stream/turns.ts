import type { StreamItem } from "../../shared/stream/stream.ts";
import type { StreamEventInput } from "./timeline-state.ts";

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

export function isResponseBoundary(previous: StreamItem | null, next: StreamItem | null): boolean {
  return previous !== null && next !== null && !continuesResponse(previous, next);
}

export function startsNewTurn(item: StreamItem, previous: StreamItem | null): boolean {
  return previous === null || isTurnBoundary(previous, item);
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
    if (item.kind === "piggery" && item.source.kind === "turn-end") reported = item.source;
    previous = item;
  }
  if (!params.isTurnActive) flush();
  return { byAssistantId, runningStartedAt: params.isTurnActive ? params.activeTurnStartedAt : null };
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
