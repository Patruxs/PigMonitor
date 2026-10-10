import type { ComposerAttachment } from "../shared/composer.ts";

export interface DraftInput {
  text: string;
  attachments: ComposerAttachment[];
}

export type DraftLifecycleState = "active" | "abandoned" | "sent";

export interface DraftRecord {
  input: DraftInput;
  lifecycle: DraftLifecycleState;
  updatedAt: number;
  version: number;
}

const STORAGE_PREFIX = "pigmonitor:draft:";
const DRAFT_PERSIST_INTERVAL_MS = 200;
const FINALIZED_DRAFT_TTL_MS = 5 * 60 * 1000;

const records = new Map<string, DraftRecord>();
const pending = new Map<string, DraftRecord>();
let timer: ReturnType<typeof setTimeout> | null = null;
let lastWriteAt = -Infinity;

function storage(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function isDraftRecord(value: unknown): value is DraftRecord {
  const record = value as DraftRecord | null;
  return typeof record?.input?.text === "string" && Array.isArray(record.input.attachments) && ["active", "abandoned", "sent"].includes(record.lifecycle) && typeof record.updatedAt === "number" && typeof record.version === "number";
}

function load(draftKey: string): DraftRecord | undefined {
  if (records.has(draftKey)) return records.get(draftKey);
  const store = storage();
  let record: DraftRecord | undefined;
  try {
    const parsed = JSON.parse(store?.getItem(STORAGE_PREFIX + draftKey) ?? "null") as unknown;
    if (isDraftRecord(parsed)) record = parsed;
  } catch {}
  if (record && record.lifecycle !== "active" && Date.now() - record.updatedAt >= FINALIZED_DRAFT_TTL_MS) {
    store?.removeItem(STORAGE_PREFIX + draftKey);
    record = undefined;
  }
  if (record) records.set(draftKey, record);
  return record;
}

function write(store: Storage, draftKey: string, record: DraftRecord): void {
  try {
    store.setItem(STORAGE_PREFIX + draftKey, JSON.stringify(record));
  } catch (error) {
    const withoutImages = { ...record, input: { ...record.input, attachments: record.input.attachments.filter((a) => a.kind !== "image") } };
    try {
      store.setItem(STORAGE_PREFIX + draftKey, JSON.stringify(withoutImages));
    } catch {}
    console.warn("[PigMonitor] Failed to persist draft checkpoint", error);
  }
}

export function flushDrafts(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const store = storage();
  lastWriteAt = Date.now();
  if (store) for (const [draftKey, record] of pending) write(store, draftKey, record);
  pending.clear();
}

function persist(draftKey: string, record: DraftRecord): void {
  records.set(draftKey, record);
  pending.set(draftKey, record);
  const delay = DRAFT_PERSIST_INTERVAL_MS - (Date.now() - lastWriteAt);
  if (delay <= 0) return flushDrafts();
  timer ??= setTimeout(flushDrafts, delay);
}

export function readDraft(draftKey: string): DraftInput {
  const record = load(draftKey);
  return record?.lifecycle === "active" ? record.input : { text: "", attachments: [] };
}

export function saveDraft(draftKey: string, input: DraftInput): void {
  const previous = load(draftKey);
  const hasContent = input.text.length > 0 || input.attachments.length > 0;
  if (!hasContent && previous?.lifecycle !== "active") return;
  if (previous?.lifecycle === "active" && previous.input.text === input.text && previous.input.attachments === input.attachments) return;
  persist(draftKey, { input, lifecycle: hasContent ? "active" : "abandoned", updatedAt: Date.now(), version: (previous?.version ?? 0) + 1 });
}

export function clearDraft(draftKey: string, lifecycle: Exclude<DraftLifecycleState, "active">): void {
  const previous = load(draftKey);
  if (!previous) return;
  persist(draftKey, { input: { text: "", attachments: [] }, lifecycle, updatedAt: Date.now(), version: previous.version + 1 });
}

const dom = globalThis as { document?: Document; window?: Window };
if (typeof dom.document?.addEventListener === "function") {
  dom.document.addEventListener("visibilitychange", () => {
    if (dom.document?.visibilityState === "hidden") flushDrafts();
  });
}
if (typeof dom.window?.addEventListener === "function") dom.window.addEventListener("pagehide", flushDrafts);
