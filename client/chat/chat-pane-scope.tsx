import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { View } from "react-native";

interface ChatPaneArea {
  contains: (target: EventTarget | null) => boolean;
}

const ChatPaneContext = createContext<ChatPaneArea | null>(null);

export function ChatPaneScope({ children }: { children: ReactNode }) {
  const ref = useRef<View>(null);
  const area = useMemo<ChatPaneArea>(
    () => ({
      contains: (target) => {
        const node = ref.current as unknown as HTMLElement | null;
        return typeof node?.contains === "function" && target instanceof Node && node.contains(target);
      },
    }),
    [],
  );
  return (
    <ChatPaneContext.Provider value={area}>
      <View ref={ref} style={{ flex: 1, minWidth: 0 }}>
        {children}
      </View>
    </ChatPaneContext.Provider>
  );
}

export function useChatPaneArea(): ChatPaneArea | null {
  return useContext(ChatPaneContext);
}
