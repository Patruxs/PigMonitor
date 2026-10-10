import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { promptKeys, type Prompt, type PromptImage } from "../shared/prompt-images.ts";
import type { SaveImage } from "../shared/claude-log.ts";
import type { MailReader } from "./mail.ts";

export type PromptImagesResult = { ok: true; prompts: Prompt[] } | { ok: false; code: "failed"; error: string };

interface Block {
  type?: string;
  text?: string;
  source?: { type?: string; media_type?: string; data?: string };
}

interface Read {
  offset: number;
  prompts: Prompt[];
}

const NEWLINE = 10;

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
    const size = statSync(file).size;
    let read = this.reads.get(file);
    if (!read || size < read.offset) read = { offset: 0, prompts: [] };
    if (size > read.offset) {
      const chunk = Buffer.alloc(size - read.offset);
      const fd = openSync(file, "r");
      try {
        readSync(fd, chunk, 0, chunk.length, read.offset);
      } finally {
        closeSync(fd);
      }
      const end = chunk.lastIndexOf(NEWLINE);
      if (end >= 0) {
        const added = chunk.subarray(0, end).toString("utf8").split("\n").flatMap((line) => promptOf(line, this.saveImage) ?? []);
        read = { offset: read.offset + end + 1, prompts: [...read.prompts, ...added] };
      }
    }
    this.reads.set(file, read);
    return read.prompts.some((prompt) => prompt.images.length > 0) ? read.prompts : [];
  }

  read(mail: MailReader, dbFile: string, id: string): PromptImagesResult {
    try {
      const file = mail.participant(dbFile, id)?.transcript;
      return { ok: true, prompts: file && existsSync(file) ? this.prompts(file) : [] };
    } catch (error) {
      return { ok: false, code: "failed", error: `Could not read the session's images: ${String((error as Error).message ?? error)}` };
    }
  }
}
