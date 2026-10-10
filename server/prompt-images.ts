import { existsSync, statSync } from "node:fs";
import { promptKeys, type Prompt, type PromptImage } from "../shared/prompt-images.ts";
import type { SaveImage } from "../shared/claude-log.ts";
import { JsonlTail } from "./jsonl-tail.ts";
import type { PiggeryDb } from "./db.ts";

export type PromptImagesResult = { ok: true; prompts: Prompt[] } | { ok: false; code: "failed"; error: string };

interface Block {
  type?: string;
  text?: string;
  source?: { type?: string; media_type?: string; data?: string };
}

interface Read {
  tail: JsonlTail;
  prompts: Prompt[];
}

function promptOf(line: string, saveImage: SaveImage): Prompt | null {
  let entry: { type?: string; uuid?: string; isMeta?: boolean; message?: { content?: unknown } };
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (entry?.type !== "user" || entry.isMeta || typeof entry.uuid !== "string") return null;
  const content = entry.message?.content;
  const blocks: Block[] = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  const texts = blocks.flatMap((block) => (block?.type === "text" && typeof block.text === "string" && block.text.trim() ? [block.text.trim()] : []));
  const images = blocks.flatMap((block): PromptImage[] => {
    const source = block?.type === "image" ? block.source : undefined;
    if (source?.type !== "base64" || !source.data || !source.media_type) return [];
    const path = saveImage(source.data, source.media_type);
    return path ? [{ path, mimeType: source.media_type }] : [];
  });
  if (texts.length === 0 && images.length === 0) return null;
  return { uuid: entry.uuid, keys: promptKeys(texts), images };
}

export class PromptImageReader {
  private readonly saveImage: SaveImage;
  private readonly reads = new Map<string, Read>();

  constructor(saveImage: SaveImage) {
    this.saveImage = saveImage;
  }

  prompts(file: string): Prompt[] {
    const stat = statSync(file);
    let read = this.reads.get(file);
    if (!read || !read.tail.continues(stat)) read = { tail: new JsonlTail(file, stat), prompts: [] };
    read.prompts.push(...read.tail.lines(stat).flatMap((line) => promptOf(line, this.saveImage) ?? []));
    this.reads.set(file, read);
    return read.prompts.some((prompt) => prompt.images.length > 0) ? read.prompts : [];
  }

  read(db: PiggeryDb, dbFile: string, id: string): PromptImagesResult {
    try {
      const file = db.participant(dbFile, id)?.transcript;
      return { ok: true, prompts: file && existsSync(file) ? this.prompts(file) : [] };
    } catch (error) {
      return { ok: false, code: "failed", error: `Could not read the session's images: ${String((error as Error).message ?? error)}` };
    }
  }
}
