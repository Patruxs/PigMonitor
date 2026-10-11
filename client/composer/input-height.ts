export const MIN_INPUT_HEIGHT = 46;
const DEFAULT_MAX_INPUT_HEIGHT = 160;
const MAX_INPUT_VIEWPORT_RATIO = 0.5;

export function resolveMaxInputHeight(windowHeight: number): number {
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return DEFAULT_MAX_INPUT_HEIGHT;
  return Math.max(DEFAULT_MAX_INPUT_HEIGHT, Math.floor(windowHeight * MAX_INPUT_VIEWPORT_RATIO));
}
