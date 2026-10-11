import { useRpc } from "@getpaseo/plugin/client";
import { useMemo, useRef } from "react";
import { withPromptImages, type Prompt } from "../../shared/chat/prompt-images.ts";
import { promptImages } from "../../shared/rpc.ts";
import type { StreamItem } from "../../shared/stream/stream.ts";
import { QUIET_MS, usePoll } from "../kit/poll.ts";

export function useWithPromptImages(id: string, tail: StreamItem[], head: StreamItem[]): { tail: StreamItem[]; head: StreamItem[] } {
  const call = useRpc(promptImages);
  const userMessages = useMemo(() => [...tail, ...head].filter((item) => item.kind === "user_message").length, [tail, head]);
  const { value } = usePoll(
    async () => {
      const r = await call({ id });
      return r.ok ? { ok: true as const, value: r.prompts } : r;
    },
    `prompt-images:${id}:${userMessages}`,
    () => QUIET_MS,
  );
  const lastKnown = useRef<{ id: string; prompts: Prompt[] } | null>(null);
  if (value) lastKnown.current = { id, prompts: value };
  const prompts = lastKnown.current?.id === id ? lastKnown.current.prompts : [];
  return useMemo(() => {
    const items = [...tail, ...head];
    const shown = withPromptImages(items, prompts);
    if (shown === items) return { tail, head };
    return { tail: shown.slice(0, tail.length), head: shown.slice(tail.length) };
  }, [tail, head, prompts]);
}
