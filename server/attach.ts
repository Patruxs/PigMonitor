import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageData } from "../shared/rpc.ts";

export const ATTACH_ROOT = "/tmp/piggery-attach";

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export async function saveImages(root: string, session: string, images: ImageData[]): Promise<string[]> {
  if (images.length === 0) return [];
  const dir = path.join(root, path.basename(session));
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out: string[] = [];
  for (const image of images) {
    const file = path.join(dir, `${stamp}-${randomUUID().slice(0, 8)}.${EXTENSIONS[image.mimeType] ?? "img"}`);
    await writeFile(file, Buffer.from(image.data, "base64"));
    out.push(file);
  }
  return out;
}

export function bodyWithImages(body: string, files: string[]): string {
  if (files.length === 0) return body;
  const lines = files.map((f) => `[image: ${f}]`);
  return [body.trim(), ...lines].filter(Boolean).join("\n");
}
