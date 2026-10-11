const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64;
const BOTTOM_OVERSCROLL_TOLERANCE_PX = 2;
export const SCROLLBAR_SIZE = 8;

export function isNearBottom(element: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">, threshold = AUTO_SCROLL_BOTTOM_THRESHOLD_PX): boolean {
  const { scrollTop, clientHeight, scrollHeight } = element;
  if (![scrollTop, clientHeight, scrollHeight].every(Number.isFinite)) return true;
  return scrollHeight - clientHeight - scrollTop <= Math.max(0, threshold);
}

export function isMeasurable(element: Pick<HTMLElement, "clientHeight" | "scrollHeight">): boolean {
  return element.clientHeight > 0 && element.scrollHeight > 0;
}

export function isOverscrolledPastBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.clientHeight - element.scrollTop < -BOTTOM_OVERSCROLL_TOLERANCE_PX;
}
