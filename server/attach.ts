import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { forgeOf, imageMark, MAX_UPLOAD_BYTES } from "../shared/attach.ts";
import type { AttachmentData, ImageData } from "../shared/rpc.ts";

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
  const lines = files.map(imageMark);
  return [body.trim(), ...lines].filter(Boolean).join("\n");
}

export function attachmentText(attachment: AttachmentData): string {
  if (attachment.type === "uploaded_file") return [`Uploaded file: ${attachment.fileName}`, `Path: ${attachment.path}`, `MIME: ${attachment.mimeType}`, `Size: ${attachment.size} bytes`].join("\n");
  const forge = forgeOf(attachment.forge);
  const heading = attachment.type === "forge_change_request" ? `${forge.displayName} ${forge.changeRequestAbbrev} ${forge.changeRequestNumberPrefix}${attachment.number}: ${attachment.title}` : `${forge.displayName} Issue #${attachment.number}: ${attachment.title}`;
  const lines = [heading, attachment.url];
  if (attachment.projectPath) lines.push(`Project: ${attachment.projectPath}`);
  if (attachment.type === "forge_change_request" && attachment.baseRefName) lines.push(`Base: ${attachment.baseRefName}`);
  if (attachment.type === "forge_change_request" && attachment.headRefName) lines.push(`Head: ${attachment.headRefName}`);
  if (attachment.body) lines.push("", attachment.body);
  return lines.join("\n");
}

export function bodyWithAttachments(body: string, attachments: AttachmentData[]): string {
  if (attachments.length === 0) return body;
  return [body.trim(), ...attachments.map(attachmentText)].filter(Boolean).join("\n\n");
}

function decodedSize(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function uploadTooLarge(fileName: string, base64: string): string | null {
  return decodedSize(base64) > MAX_UPLOAD_BYTES ? `${fileName} is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)` : null;
}

export async function mailBody(root: string, to: string, body: string, images: ImageData[], attachments: AttachmentData[]): Promise<{ ok: true; body: string } | { ok: false; code: "failed"; error: string }> {
  let files: string[];
  try {
    files = await saveImages(root, to, images);
  } catch (error) {
    return { ok: false, code: "failed", error: `Could not save the image: ${String((error as Error).message ?? error)}` };
  }
  const composed = bodyWithAttachments(bodyWithImages(body, files), attachments);
  return composed ? { ok: true, body: composed } : { ok: false, code: "failed", error: "Nothing to send." };
}
