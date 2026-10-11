import type { StreamItem, UserMessageItem } from "../stream/stream.ts";

export interface PromptImage {
  path: string;
  mimeType: string;
}

export interface Prompt {
  uuid: string;
  keys: string[];
  images: PromptImage[];
}

export function textKey(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

export function promptKeys(texts: string[]): string[] {
  return [...new Set([textKey(texts.join("\n\n")), textKey(texts[0] ?? "")])];
}

function isPromptOf(item: UserMessageItem, key: string, prompt: Prompt): boolean {
  return item.messageId === prompt.uuid || prompt.keys.includes(key);
}

export function withPromptImages(items: StreamItem[], prompts: Prompt[]): StreamItem[] {
  if (!prompts.some((prompt) => prompt.images.length > 0)) return items;
  let next = items;
  let ceiling = prompts.length;
  for (let index = items.length - 1; index >= 0 && ceiling > 0; index--) {
    const item = items[index];
    if (item?.kind !== "user_message") continue;
    const key = textKey(item.text.trim());
    let found = ceiling - 1;
    while (found >= 0 && !isPromptOf(item, key, prompts[found] as Prompt)) found--;
    if (found < 0) continue;
    ceiling = found;
    const prompt = prompts[found] as Prompt;
    if (prompt.images.length === 0 || (item.images?.length ?? 0) > 0) continue;
    if (next === items) next = [...items];
    next[index] = { ...item, images: prompt.images.map((image, n) => ({ id: `${prompt.uuid}:${n}`, path: image.path, mimeType: image.mimeType })) };
  }
  return next;
}
