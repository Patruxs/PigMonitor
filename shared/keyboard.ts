export const IOS_KEYBOARD_MIN_HEIGHT = 120;

export function resolveKeyboardShift(input: { keyboardHeight: number; visible: boolean; bottomInset: number; isIos: boolean }): number {
  if (!input.visible || !(input.keyboardHeight > 0)) return 0;
  if (input.isIos && input.keyboardHeight < IOS_KEYBOARD_MIN_HEIGHT) return 0;
  return Math.max(0, input.keyboardHeight - input.bottomInset);
}

export function bottomInsetOf(input: { windowHeight: number; viewTop: number; viewHeight: number }): number {
  return Math.max(0, input.windowHeight - (input.viewTop + input.viewHeight));
}
