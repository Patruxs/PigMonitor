import type { StreamItem } from "../../shared/stream.ts";

export interface OutlinePrompt {
  seq: number;
  timestamp: string;
  preview: string;
}

export function resolveActivePromptSeq(prompts: readonly OutlinePrompt[], anchorSeq: number | null): number | null {
  if (anchorSeq === null) return null;
  let active: number | null = null;
  for (const prompt of prompts) {
    if (prompt.seq > anchorSeq) break;
    active = prompt.seq;
  }
  return active;
}

function loadedPromptPreview(item: StreamItem): string | null {
  if (item.kind === "user_message") return item.text;
  if (item.kind === "piggery" && item.prompt && (item.source.kind === "mail" || item.source.kind === "wake")) return item.source.from ? `${item.source.from}: ${item.source.text}` : item.source.text;
  return null;
}

export function promptsOfLoadedItems(items: readonly StreamItem[]): OutlinePrompt[] {
  return items.flatMap((item, seq) => {
    const preview = loadedPromptPreview(item);
    return preview === null ? [] : [{ seq, timestamp: item.timestamp.toISOString(), preview }];
  });
}
