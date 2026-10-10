import assert from "node:assert/strict";
import test from "node:test";
import { createDraftStore, FINALIZED_DRAFT_TTL_MS, type DraftClock, type DraftStorage } from "./drafts.ts";

function memoryStorage(accept: (value: string) => boolean = () => true): DraftStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      if (!accept(value)) throw new Error("QuotaExceededError");
      items.set(key, value);
    },
    removeItem: (key) => void items.delete(key),
  };
}

function clockAt(start: number): DraftClock & { at: number } {
  const clock = { at: start, now: () => clock.at, setTimeout: () => 0, clearTimeout: () => undefined };
  return clock;
}

test("a sent draft is forgotten five minutes after sending, and an active one is kept", () => {
  const storage = memoryStorage();
  const clock = clockAt(1_000_000);
  const writer = createDraftStore({ storage: () => storage, clock });
  writer.saveDraft("sent", { text: "done", attachments: [] });
  writer.clearDraft("sent", "sent");
  writer.saveDraft("typing", { text: "half a thought", attachments: [] });
  writer.flushDrafts();
  clock.at += FINALIZED_DRAFT_TTL_MS;
  const reader = createDraftStore({ storage: () => storage, clock });
  assert.equal(reader.readDraft("typing").text, "half a thought");
  reader.readDraft("sent");
  assert.deepEqual([...storage.items.keys()], ["pigmonitor:draft:typing"]);
});

test("a draft too big for storage keeps its text and drops its images", () => {
  const storage = memoryStorage((value) => !value.includes("data:image"));
  const store = createDraftStore({ storage: () => storage, clock: clockAt(0), warn: () => undefined });
  const image = { kind: "image" as const, metadata: { id: "i", mimeType: "image/png", dataUrl: "data:image/png;base64,AAAA", fileName: null, byteSize: 4, createdAt: 0 } };
  store.saveDraft("k", { text: "keep me", attachments: [image] });
  store.flushDrafts();
  const kept = createDraftStore({ storage: () => storage, clock: clockAt(0) }).readDraft("k");
  assert.deepEqual(kept, { text: "keep me", attachments: [] });
});
