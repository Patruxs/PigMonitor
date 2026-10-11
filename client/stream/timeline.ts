import { usePaseo } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appendSubmittedUserMessage, removeSubmittedUserMessage, type AgentStreamEvent, type StreamItem, type UserMessageItem } from "../../shared/stream.ts";
import {
  EMPTY_TIMELINE,
  planTimelineCatchUpAfter,
  planTimelineOlderFetch,
  planTimelinePromptJump,
  planTimelineTailFetch,
  processAgentStreamEvents,
  processTimelineResponse,
  type StreamEventInput,
  type TimelineFetchPlan,
  type TimelinePage,
  type TimelineState,
} from "./timeline-state.ts";
import { useLiveAgent, type AgentHandle, type PaseoAgent } from "../chat/agent-live.ts";
import { reduceTurnLiveness, resolveTurnPresentation, turnLivenessOfEvents, TURN_LIVENESS_IDLE, type TurnLiveness, type TurnPresentation } from "./turns.ts";
import type { ToolCallDetail } from "../../shared/tool-call.ts";
import { messageOf } from "../../shared/errors.ts";


export interface PermissionAction {
  id: string;
  label: string;
  behavior: "allow" | "deny";
  variant?: "primary" | "secondary" | "danger";
  intent?: "implement" | "implement_resume" | "dismiss";
}

export interface PermissionRequest {
  id: string;
  provider: string;
  name: string;
  kind: "tool" | "plan" | "question" | "mode" | "other";
  title?: string;
  description?: string;
  input?: Record<string, unknown>;
  detail?: ToolCallDetail;
  actions?: PermissionAction[];
  metadata?: Record<string, unknown>;
}

export type PermissionResponse =
  | { behavior: "allow"; selectedActionId?: string; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; selectedActionId?: string; message?: string; interrupt?: boolean };

export interface AgentTimeline {
  agentId: string;
  tail: StreamItem[];
  head: StreamItem[];
  initialized: boolean;
  error: string | null;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  progressKey: string | null;
  epoch: string | null;
  agent: PaseoAgent | null;
  turn: TurnPresentation;
  permissions: PermissionRequest[];
  pendingClientMessageIds: ReadonlySet<string>;
  loadOlder: () => Promise<boolean>;
  retry: () => void;
  refetchTail: () => Promise<void>;
  jumpToPrompt: (seq: number) => Promise<void>;
  submit: (message: UserMessageItem, send: () => Promise<void>) => Promise<void>;
  respond: (requestId: string, response: PermissionResponse) => Promise<void>;
  cancelling: (requestId: number | null) => void;
}

const FLUSH_MS = 48;


function permissionsOf(agent: PaseoAgent | null): PermissionRequest[] {
  return ((agent?.pendingPermissions ?? []) as unknown as PermissionRequest[]).filter((permission) => typeof permission?.id === "string");
}

export function useAgentTimeline(agentId: string): AgentTimeline {
  const paseo = usePaseo();
  const handle = useMemo(() => paseo.agents.ref(agentId), [paseo, agentId]);
  const stateRef = useRef<TimelineState>(EMPTY_TIMELINE);
  const [state, setState] = useState<TimelineState>(EMPTY_TIMELINE);
  const [error, setError] = useState<string | null>(null);
  const live = useLiveAgent(agentId);
  const { agent, accept: acceptAgent, refresh: refreshAgent } = live;
  const [liveness, setLiveness] = useState<TurnLiveness>(TURN_LIVENESS_IDLE);
  const [isLoadingOlder, setLoadingOlder] = useState(false);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [permissionEvents, setPermissionEvents] = useState<{ added: PermissionRequest[]; resolved: Set<string> }>({ added: [], resolved: new Set() });
  const [retryKey, setRetryKey] = useState(0);
  const pendingRef = useRef<ReadonlySet<string>>(pending);
  pendingRef.current = pending;
  const queueRef = useRef<StreamEventInput[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchingRef = useRef(false);

  const commit = useCallback((next: TimelineState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const acknowledge = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setPending((had) => {
      const next = new Set(had);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const fetchPage = useCallback(
    async (plan: TimelineFetchPlan): Promise<void> => {
      const page = (await handle.timeline.refetch(plan as Parameters<AgentHandle["timeline"]["refetch"]>[0])) as unknown as TimelinePage & { agent?: PaseoAgent | null };
      if (page.agent) acceptAgent(page.agent);
      const result = processTimelineResponse(page, stateRef.current, [...pendingRef.current]);
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      commit(result.state);
      acknowledge(result.acknowledgedClientMessageIds);
      for (const effect of result.sideEffects) void fetchPage(planTimelineCatchUpAfter({ epoch: effect.cursor.epoch, seq: effect.cursor.endSeq })).catch((failure) => setError(messageOf(failure)));
    },
    [handle, commit, acknowledge],
  );

  const flush = useCallback(() => {
    timerRef.current = null;
    const events = queueRef.current;
    if (events.length === 0) return;
    queueRef.current = [];
    const result = processAgentStreamEvents(events, stateRef.current);
    commit(result.state);
    acknowledge(result.acknowledgedClientMessageIds);
    const transitions = turnLivenessOfEvents(events);
    if (transitions.length > 0) setLiveness((had) => transitions.reduce(reduceTurnLiveness, had));
    for (const effect of result.sideEffects) void fetchPage(planTimelineCatchUpAfter({ epoch: effect.cursor.epoch, seq: effect.cursor.endSeq })).catch((failure) => setError(messageOf(failure)));
  }, [commit, acknowledge, fetchPage]);

  useEffect(() => {
    stateRef.current = EMPTY_TIMELINE;
    setState(EMPTY_TIMELINE);
    setError(null);
    setLiveness(TURN_LIVENESS_IDLE);
    setPermissionEvents({ added: [], resolved: new Set() });
    let disposed = false;
    const resume = () => {
      const cursor = stateRef.current.cursor;
      const plan = stateRef.current.initialized && cursor ? planTimelineCatchUpAfter({ epoch: cursor.epoch, seq: cursor.endSeq }) : planTimelineTailFetch();
      void fetchPage(plan).catch((failure) => !disposed && setError(messageOf(failure)));
    };
    const subscription = handle.timeline.subscribe((message) => {
      if (disposed) return;
      const event = message.event as { type: string; error?: string };
      if (event.type === "replacement") return void fetchPage(planTimelineTailFetch()).catch((failure) => setError(messageOf(failure)));
      if (event.type === "subscription_restored") return resume();
      if (event.type === "error") return setError(event.error ?? "The timeline subscription failed.");
      const payload = message as { event: AgentStreamEvent; timestamp: string; seq?: number; epoch?: string };
      if (payload.event.type === "permission_requested") {
        const request = payload.event.request as PermissionRequest;
        setPermissionEvents((had) => ({ added: [...had.added.filter((p) => p.id !== request.id), request], resolved: had.resolved }));
      }
      if (payload.event.type === "permission_resolved") {
        const requestId = payload.event.requestId;
        setPermissionEvents((had) => ({ added: had.added.filter((p) => p.id !== requestId), resolved: new Set([...had.resolved, requestId]) }));
      }
      queueRef.current.push({ event: payload.event, seq: payload.seq, epoch: payload.epoch, timestamp: new Date(payload.timestamp) });
      if (timerRef.current === null) timerRef.current = setTimeout(flush, FLUSH_MS);
    });
    void subscription.ready.catch(() => undefined).then(() => !disposed && resume());
    void refreshAgent();
    return () => {
      disposed = true;
      subscription();
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      queueRef.current = [];
    };
  }, [handle, fetchPage, flush, retryKey]);

  useEffect(() => {
    const active = agent?.activeTurn;
    setLiveness((had) => reduceTurnLiveness(had, { type: "snapshot", activeTurn: active ? { turnId: active.turnId, startedAt: active.startedAt ? new Date(active.startedAt) : null } : agent?.status === "running" ? { turnId: null, startedAt: null } : null }));
  }, [agent]);

  const loadOlder = useCallback(async (): Promise<boolean> => {
    const cursor = stateRef.current.cursor;
    if (!cursor || !stateRef.current.hasOlder || fetchingRef.current) return false;
    fetchingRef.current = true;
    setLoadingOlder(true);
    try {
      await fetchPage(planTimelineOlderFetch({ epoch: cursor.epoch, seq: cursor.startSeq }));
      return true;
    } catch (failure) {
      setError(messageOf(failure));
      return false;
    } finally {
      fetchingRef.current = false;
      setLoadingOlder(false);
    }
  }, [fetchPage]);

  const jumpToPrompt = useCallback(
    async (seq: number) => {
      const cursor = stateRef.current.cursor;
      if (!cursor) return;
      await fetchPage(planTimelinePromptJump({ epoch: cursor.epoch, seq }));
    },
    [fetchPage],
  );

  const submit = useCallback(
    async (message: UserMessageItem, send: () => Promise<void>) => {
      const clientMessageId = message.clientMessageId as string;
      setPending((had) => new Set([...had, clientMessageId]));
      const appended = appendSubmittedUserMessage({ tail: stateRef.current.tail, head: stateRef.current.head, message });
      commit({ ...stateRef.current, ...appended });
      try {
        await send();
      } catch (failure) {
        commit({ ...stateRef.current, ...removeSubmittedUserMessage({ tail: stateRef.current.tail, head: stateRef.current.head, clientMessageId }) });
        acknowledge([clientMessageId]);
        throw failure;
      }
    },
    [commit, acknowledge],
  );

  const respond = useCallback(
    async (requestId: string, response: PermissionResponse) => {
      await handle.respondToPermission({ requestId, response: response as Parameters<AgentHandle["respondToPermission"]>[0]["response"] });
      setPermissionEvents((had) => ({ added: had.added.filter((p) => p.id !== requestId), resolved: new Set([...had.resolved, requestId]) }));
    },
    [handle],
  );

  const cancelling = useCallback((requestId: number | null) => {
    setLiveness((had) => (requestId === null ? { ...had, cancellationRequestId: null } : reduceTurnLiveness(had, { type: "cancellation_started", requestId })));
  }, []);

  const permissions = useMemo(() => {
    const byId = new Map<string, PermissionRequest>();
    for (const permission of permissionsOf(agent)) if (!permissionEvents.resolved.has(permission.id)) byId.set(permission.id, permission);
    for (const permission of permissionEvents.added) byId.set(permission.id, permission);
    return [...byId.values()];
  }, [agent, permissionEvents]);

  return {
    agentId,
    tail: state.tail,
    head: state.head,
    initialized: state.initialized,
    error,
    hasOlder: state.hasOlder,
    isLoadingOlder,
    progressKey: state.cursor ? `${state.cursor.epoch}:${state.cursor.startSeq}` : null,
    epoch: state.cursor?.epoch ?? null,
    agent,
    turn: resolveTurnPresentation(liveness, pending.size > 0),
    permissions,
    pendingClientMessageIds: pending,
    loadOlder,
    retry: () => setRetryKey((n) => n + 1),
    refetchTail: () => fetchPage(planTimelineTailFetch()),
    jumpToPrompt,
    submit,
    respond,
    cancelling,
  };
}
