import type { StreamItem } from "../../shared/stream.ts";
import type { TodoEntry } from "../../shared/todos.ts";

export type Bucket = "failed" | "running";

export interface Segment {
  bucket: Bucket | null;
  text: string;
}

export interface SubagentRow {
  id: string;
  title: string | null;
  status: string;
  turnOpen: boolean;
  createdAt: number;
}

export function latestTasksFromStream(items: readonly StreamItem[]): TodoEntry[] {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "todo_list") return item.items;
  }
  return [];
}

export function hasComposerTracks(items: readonly StreamItem[], subagentCount: number, archiving = false): boolean {
  return subagentCount > 0 || latestTasksFromStream(items).length > 0 || archiving;
}

export function resolveRowLabel(title: string | null | undefined): string | null {
  const normalized = typeof title === "string" ? title.trim() : "";
  if (!normalized || normalized.toLowerCase() === "new agent") return null;
  return normalized;
}

export function bucketOf(row: SubagentRow): Bucket | null {
  const status = row.turnOpen ? "running" : row.status === "running" ? "idle" : row.status;
  if (status === "error") return "failed";
  if (status === "running") return "running";
  return null;
}

export function isFinished(row: SubagentRow): boolean {
  return row.status === "idle" || row.status === "error";
}

const ACTIVE_ORDER: Bucket[] = ["failed", "running"];

function statusLabel(bucket: Bucket, count: number): string {
  return bucket === "running" ? `${count} working` : `${count} failed`;
}

export function pillPresentation(rows: SubagentRow[]): { segments: Segment[]; accessibilityLabel: string } {
  const buckets = rows.map(bucketOf);
  const counts = ACTIVE_ORDER.flatMap((bucket) => {
    const count = buckets.filter((candidate) => candidate === bucket).length;
    return count > 0 ? [{ bucket, count }] : [];
  });
  if (counts.length === 0) {
    const label = rows.length === 1 ? "1 subagent" : `${rows.length} subagents`;
    return { segments: [{ bucket: null, text: label }], accessibilityLabel: label };
  }
  const labels = counts.map(({ bucket, count }) => statusLabel(bucket, count));
  return { segments: counts.map(({ bucket }, index) => ({ bucket, text: labels[index] ?? "" })), accessibilityLabel: labels.join(", ") };
}
