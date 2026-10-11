import { AVATAR_IMAGE_SIDE, AVATAR_IMAGE_TYPES, MAX_AVATAR_IMAGE_BYTES, avatarUploadError, centreSquare } from "../../shared/piggery/avatar.ts";
import type { ImageMetadata } from "../composer/attachment.ts";
import { readBase64 } from "../composer/attachments.tsx";
import { rasterImageMimeType } from "../composer/mime-types.ts";
import { fallbackFormat, hasTransparency, LOSSLESS_FORMAT, PREFERRED_FORMAT, type StoredFormat } from "./avatar-format.ts";

export type AvatarSource = { blob: Blob; mimeType: string; bytes: number; name?: string };

export type EncodedAvatar = { data: string; mimeType: string; bytes: number; uri: string; name?: string };

export type Encoding = { ok: true; image: EncodedAvatar } | { ok: false; error: string };

const dom = globalThis as { document?: Document; createImageBitmap?: typeof createImageBitmap };

export const canEncodeAvatars = dom.document !== undefined && typeof dom.createImageBitmap === "function";

export function sourceOfFile(file: File): AvatarSource {
  return { blob: file, mimeType: rasterImageMimeType({ mimeType: file.type, fileName: file.name }) ?? file.type, bytes: file.size, name: file.name };
}

export async function sourceOfDropped(image: ImageMetadata): Promise<AvatarSource> {
  const blob = await (await fetch(image.dataUrl)).blob();
  return { blob, mimeType: image.mimeType, bytes: image.byteSize ?? blob.size, name: image.fileName ?? undefined };
}

async function decode(source: AvatarSource): Promise<ImageBitmap | null> {
  const decodable = (AVATAR_IMAGE_TYPES as readonly string[]).includes(source.mimeType) && source.bytes <= MAX_AVATAR_IMAGE_BYTES;
  if (!decodable || !dom.createImageBitmap) return null;
  try {
    return await dom.createImageBitmap(source.blob);
  } catch {
    return null;
  }
}

function canvasBlob(canvas: HTMLCanvasElement, format: StoredFormat): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, format.type, format.quality));
}

async function encodeCanvas(canvas: HTMLCanvasElement, transparent: boolean): Promise<Blob | null> {
  for (const format of [PREFERRED_FORMAT, fallbackFormat(transparent), LOSSLESS_FORMAT]) {
    const blob = await canvasBlob(canvas, format);
    if (blob?.type === format.type) return blob;
  }
  return null;
}

export async function encodeAvatar(source: AvatarSource, librarySize: number): Promise<Encoding> {
  const bitmap = await decode(source);
  const error = avatarUploadError({ mimeType: source.mimeType, bytes: source.bytes, size: bitmap ? { width: bitmap.width, height: bitmap.height } : null }, librarySize);
  if (error || !bitmap || !dom.document) {
    bitmap?.close();
    return { ok: false, error: error ?? "Pictures can't be prepared here." };
  }
  const canvas = dom.document.createElement("canvas");
  canvas.width = AVATAR_IMAGE_SIDE;
  canvas.height = AVATAR_IMAGE_SIDE;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return { ok: false, error: "Pictures can't be prepared here." };
  }
  const crop = centreSquare(bitmap.width, bitmap.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, crop.x, crop.y, crop.side, crop.side, 0, 0, AVATAR_IMAGE_SIDE, AVATAR_IMAGE_SIDE);
  bitmap.close();
  const transparent = hasTransparency(context.getImageData(0, 0, AVATAR_IMAGE_SIDE, AVATAR_IMAGE_SIDE).data);
  const blob = await encodeCanvas(canvas, transparent);
  if (!blob) return { ok: false, error: "That picture could not be encoded." };
  const data = await readBase64(blob);
  return { ok: true, image: { data, mimeType: blob.type, bytes: blob.size, uri: `data:${blob.type};base64,${data}`, name: source.name } };
}
