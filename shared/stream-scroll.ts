import type { StreamItem } from "./stream.ts";
import { isPrompt } from "./turns.ts";

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
