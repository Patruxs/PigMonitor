import type { StreamItem, UserMessageImage } from "./stream.ts";
import type { Item } from "./transcript.ts";

const IMAGE_LINE = /^\[image: (\/[^\]\n]+)\]$/;

function keyOf(item: Item): string {
  return item.key ?? `${item.run ?? ""}:${item.i}`;
}

function splitImages(text: string, key: string): { text: string; images: UserMessageImage[] } {
  const images: UserMessageImage[] = [];
  const lines = text.split("\n").filter((line) => {
    const image = IMAGE_LINE.exec(line.trim());
    if (!image) return true;
    images.push({ id: `${key}:image:${images.length}`, path: image[1] });
    return false;
  });
  return { text: lines.join("\n").trim(), images };
}

export function streamOfTranscript(items: Item[]): StreamItem[] {
  const out: StreamItem[] = [];
  const byResult = items.some((item) => item.kind === "turn");
  let lastAt = 0;
  let turn = 0;
  let working = false;
  for (const item of items) {
    lastAt = item.at ?? lastAt;
    const timestamp = new Date(lastAt);
    const key = keyOf(item);
    if (item.kind === "session" && working) turn += 1;
    if (item.kind === "session" || item.kind === "turn") working = false;
    else if (item.kind !== "mail" && item.kind !== "user" && item.kind !== "wake") working = true;
    const start = out.length;
    switch (item.kind) {
      case "user": {
        const { text, images } = splitImages(item.text, key);
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
      case "turn":
        if (item.error) out.push({ kind: "notification", sourceType: "error", id: `error:${key}`, timestamp, level: "error", message: item.text || "The run failed" });
        out.push({ kind: "piggery", id: `turn:${key}`, timestamp, prompt: false, source: { kind: "turn", text: item.text, ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}), ...(item.costUsd !== undefined ? { costUsd: item.costUsd } : {}) } });
        break;
      case "compaction":
        out.push({ kind: "compaction", id: `compaction:${key}`, timestamp, status: "completed", ...(item.trigger ? { trigger: item.trigger } : {}), ...(item.preTokens !== undefined ? { preTokens: item.preTokens } : {}) });
        break;
      case "session":
      case "wake":
      case "mail":
        out.push({ kind: "piggery", id: `${item.kind}:${key}`, timestamp, prompt: item.to === undefined, source: { kind: item.kind, text: item.text, ...(item.from ? { from: item.from } : {}), ...(item.to ? { to: item.to } : {}), ...(item.ref ? { ref: item.ref } : {}), ...(item.reply ? { reply: item.reply } : {}) } });
        break;
    }
    if (byResult) for (const made of out.slice(start)) made.turnId = `turn:${turn}`;
    if (item.kind === "turn") turn += 1;
  }
  return out;
}
