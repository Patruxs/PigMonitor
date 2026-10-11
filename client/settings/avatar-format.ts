export type StoredFormat = { type: string; quality?: number };

export const PREFERRED_FORMAT: StoredFormat = { type: "image/webp", quality: 0.85 };

export const LOSSLESS_FORMAT: StoredFormat = { type: "image/png" };

export function fallbackFormat(transparent: boolean): StoredFormat {
  return transparent ? LOSSLESS_FORMAT : { type: "image/jpeg", quality: 0.85 };
}

export function hasTransparency(rgba: ArrayLike<number>): boolean {
  for (let alpha = 3; alpha < rgba.length; alpha += 4) if (rgba[alpha] < 255) return true;
  return false;
}
