import type { StreamItem } from "./stream.ts";

export interface AgentTimelineSearchPayload {
  epoch: string;
  locations: { seq: number; role: "user" | "assistant"; count?: number }[];
  nextCursor: number | null;
}

type Location = Omit<AgentTimelineSearchPayload["locations"][number], "count"> & {
  count: number;
};
interface Target {
  id: string;
  seq: number;
  before: number;
}
export type ChatFindFailure = "connection" | "historyChanged" | "reveal";

interface ChatFindFailureError extends Error {
  failure: ChatFindFailure;
}

function chatFindFailure(failure: ChatFindFailure, cause?: unknown): ChatFindFailureError {
  const error = new Error(`Chat find failed: ${failure}`, cause === undefined ? undefined : { cause }) as ChatFindFailureError;
  error.failure = failure;
  return error;
}

function isChatFindFailure(error: unknown): error is ChatFindFailureError {
  return error instanceof Error && typeof (error as ChatFindFailureError).failure === "string";
}

function tagged<T>(failure: ChatFindFailure, operation: Promise<T>): Promise<T> {
  return operation.catch((cause: unknown) => {
    throw isChatFindFailure(cause) ? cause : chatFindFailure(failure, cause);
  });
}

interface Snapshot {
  open: boolean;
  query: string;
  phase: "idle" | "searching" | "loading" | "ready" | "error";
  selectedItemId: string | null;
    occurrence: number;
  count: number;
  failure: ChatFindFailure | null;
}
export interface ChatFindOperations {
  search(query: string, cursor?: number): Promise<AgentTimelineSearchPayload>;
  load(epoch: string, seq: number): Promise<unknown>;
  reveal(
    messageId: string,
    query: string,
    occurrence: number,
    signal: AbortSignal,
  ): Promise<{ occurrence: number; count: number }>;
  clear(): void;
}

export interface ChatFindModel {
  getSnapshot: () => Snapshot;
  subscribe: (listener: () => void) => () => void;
  open: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  retry: () => void;
  updateHistory: (epoch: string | null, items: StreamItem[]) => void;
  next: () => void;
  previous: () => void;
}

export function createChatFindModel(operations: ChatFindOperations): ChatFindModel {
  let state: Snapshot = {
    open: false,
    query: "",
    phase: "idle",
    selectedItemId: null,
    occurrence: 0,
    count: 0,
    failure: null,
  };
  const listeners = new Set<() => void>();
  const historyListeners = new Set<() => void>();
  let items: StreamItem[] = [];
  let epoch: string | null = null;
  let resultEpoch: string | null = null;
  let locations: Location[] = [];
  const resolved = new Map<Location, Target>();
  let current = -1;
  let inMessage = { occurrence: 0, count: 0 };
  let abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const publish = (change: Partial<Snapshot>) => {
    state = { ...state, ...change };
    listeners.forEach((listener) => listener());
  };
  const cancel = () => {
    abort.abort();
    abort = new AbortController();
    clearTimeout(timer);
    operations.clear();
  };
  const fail = (error: unknown, signal: AbortSignal) => {
    if (signal.aborted) return;
    cancel();
    publish({
      phase: "error",
      selectedItemId: null,
      failure: isChatFindFailure(error) ? error.failure : "connection",
    });
  };
  const target = (location: Location, exact: boolean): Target | null => {
    let before = 0;
    for (const item of items) {
      if (item.timelineCursor?.epoch !== resultEpoch) continue;
      const seq = item.timelineCursor.seq;
      if (seq < location.seq) {
        before = Math.max(before, seq);
        continue;
      }
      const sameRole = item.kind === `${location.role}_message`;
      if (sameRole && (!exact || seq === location.seq)) return { id: item.id, seq, before };
      if (item.kind === "user_message") return null;
    }
    return null;
  };
  const waitForTarget = (location: Location, signal: AbortSignal): Promise<Target> =>
    new Promise((resolve, reject) => {
      const finish = (found?: Target) => {
        clearTimeout(timeout);
        historyListeners.delete(check);
        signal.removeEventListener("abort", cancelled);
        if (found) resolve(found);
        else reject(chatFindFailure("reveal"));
      };
      const check = () => {
        const found = target(location, false);
        if (found) finish(found);
      };
      const cancelled = () => finish();
      const timeout = setTimeout(() => finish(), 5000);
      historyListeners.add(check);
      signal.addEventListener("abort", cancelled, { once: true });
      if (signal.aborted) cancelled();
      else check();
    });
  const position = (location: Location, revealed: { occurrence: number; count: number }) => {
    inMessage = revealed;
    location.count = revealed.count;
    let before = 0;
    let total = 0;
    for (const candidate of locations) {
      if (candidate === location) before = total;
      total += candidate.count;
    }
    return { occurrence: before + revealed.occurrence, count: total };
  };
  const navigate = async (index: number, direction: 1 | -1, signal: AbortSignal) => {
    const searched = resultEpoch;
    if (searched === null) return;
    publish({ phase: "loading", failure: null });
    let remaining = locations.length;
    while (remaining-- > 0 && locations.length) {
      index = (index + locations.length) % locations.length;
      const location = locations[index]!;
      const cached = resolved.get(location);
      const stillLoaded =
        cached &&
        items.some((item) => item.id === cached.id && item.timelineCursor?.seq === cached.seq);
      let found = stillLoaded ? cached : target(location, true);
      if (!found) {
        await tagged("connection", operations.load(searched, location.seq));
        if (signal.aborted) return;
        found = await waitForTarget(location, signal);
      }
      if (signal.aborted) return;
      resolved.set(location, found);
      const kept = found;
      locations = locations.filter(
        (candidate) =>
          candidate === location ||
          candidate.role !== location.role ||
          candidate.seq <= kept.before ||
          candidate.seq > kept.seq,
      );
      index = locations.indexOf(location);
      publish({ selectedItemId: found.id });
      const result = await tagged(
        "reveal",
        operations.reveal(found.id, state.query, direction === 1 ? 0 : -1, signal),
      );
      if (signal.aborted) return;
      if (result.count) {
        current = index;
        publish({ phase: "ready", ...position(location, result) });
        return;
      }
      locations.splice(index, 1);
      if (direction === -1) index--;
    }
    operations.clear();
    publish({ phase: "ready", selectedItemId: null, count: 0, occurrence: 0 });
  };
  const search = async (signal: AbortSignal) => {
    try {
      let cursor: number | undefined;
      do {
        const result = await tagged("connection", operations.search(state.query, cursor));
        if (signal.aborted) return;
        const historyChanged = epoch !== null && result.epoch !== epoch;
        const searchChanged = resultEpoch !== null && result.epoch !== resultEpoch;
        if (historyChanged || searchChanged) throw chatFindFailure("historyChanged");
        resultEpoch = result.epoch;
        locations.push(
          ...result.locations.map((location) => ({
            seq: location.seq,
            role: location.role,
            count: location.count ?? 1,
          })),
        );
        cursor = result.nextCursor ?? undefined;
      } while (cursor !== undefined);
      await navigate(0, 1, signal);
    } catch (error) {
      fail(error, signal);
    }
  };
  const setQuery = (query: string) => {
    cancel();
    locations = [];
    resultEpoch = null;
    resolved.clear();
    current = -1;
    inMessage = { occurrence: 0, count: 0 };
    publish({
      query,
      phase: query.trim() ? "searching" : "idle",
      selectedItemId: null,
      occurrence: 0,
      count: 0,
      failure: null,
    });
    if (!query.trim()) return;
    const signal = abort.signal;
    timer = setTimeout(() => {
      void search(signal);
    }, 120);
  };
  const move = async (direction: 1 | -1) => {
    if (state.phase !== "ready" || !state.count) return;
    cancel();
    const signal = abort.signal;
    try {
      const occurrence = inMessage.occurrence + direction;
      if (occurrence >= 0 && occurrence < inMessage.count && state.selectedItemId) {
        publish({ phase: "loading" });
        const result = await tagged(
          "reveal",
          operations.reveal(state.selectedItemId, state.query, occurrence, signal),
        );
        if (signal.aborted) return;
        if (result.count) {
          publish({ phase: "ready", ...position(locations[current]!, result) });
          return;
        }
      }
      await navigate(current + direction, direction, signal);
    } catch (error) {
      fail(error, signal);
    }
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open: () => {
      if (state.open) return;
      publish({ open: true });
      if (state.query) setQuery(state.query);
    },
    close: () => {
      cancel();
      publish({ open: false, phase: "idle", selectedItemId: null, count: 0, failure: null });
    },
    setQuery,
    retry: () => setQuery(state.query),
    updateHistory: (nextEpoch, nextItems) => {
      if (resultEpoch !== null && nextEpoch !== null && nextEpoch !== resultEpoch && state.open) {
        fail(chatFindFailure("historyChanged"), abort.signal);
      }
      epoch = nextEpoch;
      items = nextItems;
      historyListeners.forEach((listener) => listener());
    },
    next: () => {
      void move(1);
    },
    previous: () => {
      void move(-1);
    },
  };
}
