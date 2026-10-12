import { splitImageMarks } from "../../shared/chat/attach.ts";
import type { StreamItem, UserMessageImage } from "../../shared/stream/stream.ts";
import type { Item } from "../../shared/stream/transcript.ts";

function keyOf(item: Item): string {
  return item.key ?? `${item.run ?? ""}:${item.i}`;
}

function imagesOf(item: Item, key: string): { text: string; images: UserMessageImage[] } {
  const { text, paths } = splitImageMarks(item.text);
  return { text, images: [...(item.images ?? []), ...paths].map((path, n) => ({ id: `${key}:image:${n}`, path })) };
}

export function streamOfLog(items: Item[]): StreamItem[] {
  const out: StreamItem[] = [];
  const byResult = items.some((item) => item.kind === "turn-end");
  let lastAt = 0;
  let turn = 0;
  let working = false;
  for (const item of items) {
    lastAt = item.at ?? lastAt;
    const timestamp = new Date(lastAt);
    const key = keyOf(item);
    if (item.kind === "run-start" && working) turn += 1;
    if (item.kind === "run-start" || item.kind === "turn-end") working = false;
    else if (item.kind !== "mail" && item.kind !== "user" && item.kind !== "wake") working = true;
    const start = out.length;
    switch (item.kind) {
      case "user": {
        const { text, images } = imagesOf(item, key);
        out.push({ kind: "user_message", id: `user:${key}`, text, timestamp, ...(images.length > 0 ? { images } : {}), ...(item.note ? { note: item.note } : {}) });
        break;
      }
      case "assistant":
        out.push({ kind: "assistant_message", id: `assistant:${key}`, text: item.text, timestamp });
        break;
      case "thinking":
        out.push({ kind: "thought", id: `thought:${key}`, text: item.text, timestamp, status: "ready" });
        break;
      case "tool": {
        const status = item.status ?? "running";
        out.push({
          kind: "tool_call",
          id: `tool:${key}`,
          timestamp,
          payload: { source: "agent", data: { provider: "claude", callId: key, name: item.tool ?? item.text, status, error: status === "failed" ? (item.toolError ?? null) : null, detail: item.detail ?? { type: "unknown", input: null, output: null } } },
        });
        break;
      }
      case "turn-end":
        if (item.error) out.push({ kind: "notification", sourceType: "error", id: `error:${key}`, timestamp, level: "error", message: item.text || "The run failed" });
        out.push({ kind: "piggery", id: `turn-end:${key}`, timestamp, prompt: false, source: { kind: "turn-end", text: item.text, ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}), ...(item.costUsd !== undefined ? { costUsd: item.costUsd } : {}) } });
        break;
      case "compaction":
        out.push({ kind: "compaction", id: `compaction:${key}`, timestamp, status: "completed", ...(item.trigger ? { trigger: item.trigger } : {}), ...(item.preTokens !== undefined ? { preTokens: item.preTokens } : {}) });
        break;
      case "run-start":
      case "wake":
      case "mail":
        out.push({ kind: "piggery", id: `${item.kind}:${key}`, timestamp, prompt: item.outgoing !== true, source: { kind: item.kind, text: item.text, ...(item.from ? { from: item.from } : {}), ...(item.fromId ? { fromId: item.fromId } : {}), ...(item.to ? { to: item.to } : {}), ...(item.ref ? { ref: item.ref } : {}), ...(item.reply ? { reply: item.reply } : {}) } });
        break;
    }
    if (byResult) for (const made of out.slice(start)) made.turnId = `turn:${turn}`;
    if (item.kind === "turn-end") turn += 1;
  }
  return out;
}
