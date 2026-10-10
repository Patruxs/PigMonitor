import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dimensions, Keyboard, KeyboardAvoidingView, Platform, View } from "react-native";

const IOS_HOME_INDICATOR_INSET = 34;
const homeIndicatorInset = Platform.OS === "ios" ? IOS_HOME_INDICATOR_INSET : 0;

function useIosKeyboardShown(): boolean {
  const [shown, setShown] = useState(() => Platform.OS === "ios" && Keyboard.isVisible());
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const subscriptions = [Keyboard.addListener("keyboardWillShow", () => setShown(true)), Keyboard.addListener("keyboardWillHide", () => setShown(false))];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);
  return shown;
}

export function KeyboardAvoidingPane({ children }: { children: ReactNode }) {
  const paneRef = useRef<View>(null);
  const [paneTop, setPaneTop] = useState(0);
  const keyboardShown = useIosKeyboardShown();
  if (Platform.OS === "web") return <View style={{ flex: 1, minWidth: 0 }}>{children}</View>;
  const measurePaneTop = () => {
    paneRef.current?.measureInWindow((_x, y) => {
      const windowHeight = Dimensions.get("window").height;
      setPaneTop(Number.isFinite(y) ? Math.min(Math.max(0, y), windowHeight / 2) : 0);
    });
  };
  return (
    <View ref={paneRef} style={{ flex: 1, minWidth: 0 }} onLayout={measurePaneTop}>
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={paneTop} style={{ flex: 1, minWidth: 0 }}>
        {children}
        {homeIndicatorInset > 0 && !keyboardShown ? <View style={{ height: homeIndicatorInset }} /> : null}
      </KeyboardAvoidingView>
    </View>
  );
}
