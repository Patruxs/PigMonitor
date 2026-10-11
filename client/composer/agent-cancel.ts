import type { ToastApi } from "@getpaseo/plugin/client/react-native";
import { useCallback, useState, type RefObject } from "react";
import type { TextInput } from "react-native";
import type { AgentTimeline } from "../stream/timeline.ts";

export function useAgentCancel({ stop, timeline, isAgentRunning, toast, input }: { stop: { running: boolean; onStop: () => Promise<string | null> } | undefined; timeline: AgentTimeline | undefined; isAgentRunning: boolean; toast: ToastApi; input: RefObject<TextInput | null> }) {
  const [localCancelling, setLocalCancelling] = useState(false);
  const isCancellingAgent = timeline ? timeline.turn.isCancelling || localCancelling : localCancelling;

  const handleCancelAgent = useCallback(() => {
    if (!stop || !isAgentRunning || isCancellingAgent) return;
    const requestId = Date.now();
    timeline?.cancelling(requestId);
    setLocalCancelling(true);
    void stop
      .onStop()
      .then((failed) => {
        if (failed && failed.trim().length > 0) toast.error(failed);
      })
      .finally(() => {
        timeline?.cancelling(null);
        setLocalCancelling(false);
      });
    input.current?.focus();
  }, [stop, isAgentRunning, isCancellingAgent, timeline, toast]);

  return { isCancellingAgent, handleCancelAgent };
}
