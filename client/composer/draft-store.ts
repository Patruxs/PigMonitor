import type { ComposerAttachment } from "./composer-logic.ts";

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

export interface DraftStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface DraftClock {
  now: () => number;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const STORAGE_PREFIX = "pigmonitor:draft:";
const DRAFT_PERSIST_INTERVAL_MS = 200;
export const FINALIZED_DRAFT_TTL_MS = 5 * 60 * 1000;

const SYSTEM_CLOCK: DraftClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function isDraftRecord(value: unknown): value is DraftRecord {
  const record = value as DraftRecord | null;
  return typeof record?.input?.text === "string" && Array.isArray(record.input.attachments) && ["active", "abandoned", "sent"].includes(record.lifecycle) && typeof record.updatedAt === "number" && typeof record.version === "number";
}

export function createDraftStore({ storage, clock = SYSTEM_CLOCK, warn = (...args: unknown[]) => console.warn(...args) }: { storage: () => DraftStorage | null; clock?: DraftClock; warn?: (...args: unknown[]) => void }) {
  const records = new Map<string, DraftRecord>();
  const pending = new Map<string, DraftRecord>();
  let timer: unknown = null;
  let lastWriteAt = -Infinity;

  const load = (draftKey: string): DraftRecord | undefined => {
    if (records.has(draftKey)) return records.get(draftKey);
    const store = storage();
    let record: DraftRecord | undefined;
    try {
      const parsed = JSON.parse(store?.getItem(STORAGE_PREFIX + draftKey) ?? "null") as unknown;
      if (isDraftRecord(parsed)) record = parsed;
    } catch {}
    if (record && record.lifecycle !== "active" && clock.now() - record.updatedAt >= FINALIZED_DRAFT_TTL_MS) {
      store?.removeItem(STORAGE_PREFIX + draftKey);
      record = undefined;
    }
    if (record) records.set(draftKey, record);
    return record;
  };

  const write = (store: DraftStorage, draftKey: string, record: DraftRecord): void => {
    try {
      store.setItem(STORAGE_PREFIX + draftKey, JSON.stringify(record));
    } catch (error) {
      const withoutImages = { ...record, input: { ...record.input, attachments: record.input.attachments.filter((a) => a.kind !== "image") } };
      try {
        store.setItem(STORAGE_PREFIX + draftKey, JSON.stringify(withoutImages));
      } catch {}
      warn("[PigMonitor] Failed to persist draft checkpoint", error);
    }
  };

  const flushDrafts = (): void => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    const store = storage();
    lastWriteAt = clock.now();
    if (store) for (const [draftKey, record] of pending) write(store, draftKey, record);
    pending.clear();
  };

  const persist = (draftKey: string, record: DraftRecord): void => {
    records.set(draftKey, record);
    pending.set(draftKey, record);
    const delay = DRAFT_PERSIST_INTERVAL_MS - (clock.now() - lastWriteAt);
    if (delay <= 0) return flushDrafts();
    timer ??= clock.setTimeout(flushDrafts, delay);
  };

  return {
    flushDrafts,
    readDraft(draftKey: string): DraftInput {
      const record = load(draftKey);
      return record?.lifecycle === "active" ? record.input : { text: "", attachments: [] };
    },
    saveDraft(draftKey: string, input: DraftInput): void {
      const previous = load(draftKey);
      const hasContent = input.text.length > 0 || input.attachments.length > 0;
      if (!hasContent && previous?.lifecycle !== "active") return;
      if (previous?.lifecycle === "active" && previous.input.text === input.text && previous.input.attachments === input.attachments) return;
      persist(draftKey, { input, lifecycle: hasContent ? "active" : "abandoned", updatedAt: clock.now(), version: (previous?.version ?? 0) + 1 });
    },
    clearDraft(draftKey: string, lifecycle: Exclude<DraftLifecycleState, "active">): void {
      const previous = load(draftKey);
      if (!previous) return;
      persist(draftKey, { input: { text: "", attachments: [] }, lifecycle, updatedAt: clock.now(), version: previous.version + 1 });
    },
  };
}
