import { useEffect, useRef, type RefObject } from "react";
import { Animated, Dimensions, Easing, Keyboard, Platform, TextInput, type KeyboardEvent, type View } from "react-native";
import { bottomInsetOf, resolveKeyboardShift } from "../shared/keyboard.ts";

const isIos = Platform.OS === "ios";
const isNative = Platform.OS !== "web";
const MAX_SHIFT_FRACTION = 0.7;

function easingOf(name: KeyboardEvent["easing"] | undefined) {
  if (name === "linear") return Easing.linear;
  if (name === "easeIn") return Easing.in(Easing.ease);
  if (name === "easeOut") return Easing.out(Easing.ease);
  return Easing.inOut(Easing.ease);
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function useKeyboardShift(root: RefObject<View | null>): Animated.Value {
  const shift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isNative) return;
    let latest = 0;
    const animateTo = (next: number, event: KeyboardEvent) => {
      if (next === latest) return;
      latest = next;
      Animated.timing(shift, { toValue: next, duration: event.duration || 250, easing: easingOf(event.easing), useNativeDriver: false }).start();
    };
    const apply = (event: KeyboardEvent, visible: boolean) => {
      const windowHeight = Dimensions.get("window").height;
      const focused = TextInput.State.currentlyFocusedInput() !== null;
      if (!visible || !focused) return animateTo(0, event);
      const keyboardHeight = finite(isIos ? Math.max(0, windowHeight - event.endCoordinates.screenY) : event.endCoordinates.height);
      const settle = (bottomInset: number) => {
        const raw = resolveKeyboardShift({ keyboardHeight, visible, bottomInset: finite(bottomInset), isIos });
        animateTo(Math.min(finite(raw), windowHeight * MAX_SHIFT_FRACTION), event);
      };
      const node = root.current;
      if (!node || typeof node.measureInWindow !== "function") return settle(0);
      node.measureInWindow((_x, y, _width, height) => settle(bottomInsetOf({ windowHeight, viewTop: finite(y), viewHeight: finite(height) })));
    };
    const subscriptions = isIos
      ? [Keyboard.addListener("keyboardWillChangeFrame", (event) => apply(event, event.endCoordinates.screenY < Dimensions.get("window").height)), Keyboard.addListener("keyboardWillHide", (event) => apply(event, false))]
      : [Keyboard.addListener("keyboardDidShow", (event) => apply(event, true)), Keyboard.addListener("keyboardDidHide", (event) => apply(event, false))];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [root, shift]);
  return shift;
}
