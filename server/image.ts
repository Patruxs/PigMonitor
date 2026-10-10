import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { messageOf } from "../shared/errors.ts";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export type ImageResult = { ok: true; data: string; mimeType: string } | { ok: false; code: "denied" | "failed"; error: string };

export function imageTypeOf(file: string): string | undefined {
  if (!path.isAbsolute(file) || file.includes("\0")) return undefined;
  return MIME_TYPES[path.extname(file).slice(1).toLowerCase()];
}

async function within(real: string, roots: string[]): Promise<boolean> {
  for (const root of roots) {
    const resolved = await realpath(root).catch(() => root);
    if (real === resolved || real.startsWith(resolved.endsWith(path.sep) ? resolved : resolved + path.sep)) return true;
  }
  return false;
}

export async function readImage(file: string, roots: string[], maxBytes = MAX_IMAGE_BYTES): Promise<ImageResult> {
  const mimeType = imageTypeOf(file);
  if (!mimeType) return { ok: false, code: "denied", error: "Only an absolute path to a png, jpg, gif or webp file can be shown." };
  try {
    const real = await realpath(file);
    if (imageTypeOf(real) !== mimeType) return { ok: false, code: "denied", error: `${file} links to a file that is not the same kind of image.` };
    if (!(await within(real, roots))) return { ok: false, code: "denied", error: `${file} is outside the temporary folder and the folders piggery's sessions work in.` };
    const info = await stat(real);
    if (!info.isFile()) return { ok: false, code: "denied", error: `${file} is not a file.` };
    if (info.size > maxBytes) return { ok: false, code: "denied", error: `${file} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.` };
    return { ok: true, data: (await readFile(real)).toString("base64"), mimeType };
  } catch (error) {
    return { ok: false, code: "failed", error: `Could not read ${file}: ${messageOf(error)}` };
  }
}

export function pastedImageSaver(dir: string) {
  return (data: string, mimeType: string): string | undefined => {
    const extension = EXTENSIONS[mimeType];
    if (!extension) return undefined;
    const file = path.join(dir, `${createHash("sha256").update(data).digest("hex").slice(0, 24)}.${extension}`);
    try {
      if (!existsSync(file)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeFileSync(file, Buffer.from(data, "base64"), { mode: 0o600 });
      }
      return file;
    } catch {
      return undefined;
    }
  };
}
