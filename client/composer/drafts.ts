import { createDraftStore, type DraftStorage } from "./draft-store.ts";

const drafts = createDraftStore({
  storage: () => {
    try {
      return (globalThis as { localStorage?: DraftStorage }).localStorage ?? null;
    } catch {
      return null;
    }
  },
});

export const { readDraft, saveDraft, clearDraft, flushDrafts } = drafts;

const dom = globalThis as { document?: Document; window?: Window };
if (typeof dom.document?.addEventListener === "function") {
  dom.document.addEventListener("visibilitychange", () => {
    if (dom.document?.visibilityState === "hidden") flushDrafts();
  });
}
if (typeof dom.window?.addEventListener === "function") dom.window.addEventListener("pagehide", flushDrafts);
