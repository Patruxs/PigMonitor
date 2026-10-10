import { useEffect, useRef, type RefObject } from "react";
import { Animated, Dimensions, Easing, Keyboard, Platform, type KeyboardEvent, type View } from "react-native";
import { bottomInsetOf, resolveKeyboardShift } from "../shared/keyboard.ts";

const isIos = Platform.OS === "ios";
const isNative = Platform.OS !== "web";

function easingOf(name: KeyboardEvent["easing"] | undefined) {
  if (name === "linear") return Easing.linear;
  if (name === "easeIn") return Easing.in(Easing.ease);
  if (name === "easeOut") return Easing.out(Easing.ease);
  return Easing.inOut(Easing.ease);
}

export function useKeyboardShift(root: RefObject<View | null>): Animated.Value {
  const shift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isNative) return;
    let latest = 0;
    const apply = (event: KeyboardEvent, visible: boolean) => {
      const windowHeight = Dimensions.get("window").height;
      const keyboardHeight = isIos ? Math.max(0, windowHeight - event.endCoordinates.screenY) : event.endCoordinates.height;
      const settle = (bottomInset: number) => {
        const next = resolveKeyboardShift({ keyboardHeight, visible, bottomInset, isIos });
        if (next === latest) return;
        latest = next;
        Animated.timing(shift, { toValue: next, duration: event.duration || 250, easing: easingOf(event.easing), useNativeDriver: false }).start();
      };
      const node = root.current;
      if (!node) return settle(0);
      node.measureInWindow((_x, y, _width, height) => settle(bottomInsetOf({ windowHeight, viewTop: y, viewHeight: height })));
    };
    const subscriptions = isIos
      ? [Keyboard.addListener("keyboardWillChangeFrame", (event) => apply(event, event.endCoordinates.screenY < Dimensions.get("window").height))]
      : [Keyboard.addListener("keyboardDidShow", (event) => apply(event, true)), Keyboard.addListener("keyboardDidHide", (event) => apply(event, false))];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [root, shift]);
  return shift;
}
