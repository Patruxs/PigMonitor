const RASTER_IMAGE_MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};
const RASTER_IMAGE_MIME_TYPES = new Set(Object.values(RASTER_IMAGE_MIME_TYPE_BY_EXTENSION));

function fileExtension(path: string): string {
  const normalizedPath = path.split("#", 1)[0]?.split("?", 1)[0] ?? path;
  const extensionIndex = normalizedPath.lastIndexOf(".");
  return extensionIndex < 0 ? "" : normalizedPath.slice(extensionIndex).toLowerCase();
}

export function rasterImageMimeType(input: { mimeType?: string | null; fileName?: string | null }): string | null {
  const normalizedMimeType = input.mimeType?.trim().toLowerCase();
  if (normalizedMimeType) return RASTER_IMAGE_MIME_TYPES.has(normalizedMimeType) ? normalizedMimeType : null;
  return input.fileName ? (RASTER_IMAGE_MIME_TYPE_BY_EXTENSION[fileExtension(input.fileName)] ?? null) : null;
}

export function fileTypeLabel(fileName: string): string | null {
  const extension = fileExtension(fileName);
  return extension.length > 1 ? extension.slice(1).toUpperCase() : null;
}
