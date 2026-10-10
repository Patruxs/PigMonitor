import type { StreamItem, UserMessageImage } from "./stream.ts";
import type { Item } from "./transcript.ts";

const IMAGE_LINE = /^\[image: (\/[^\]\n]+)\]$/;

function keyOf(item: Item): string {
  return `${item.run ?? ""}:${item.i}`;
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
  let lastAt = 0;
  for (const item of items) {
    lastAt = item.at ?? lastAt;
    const timestamp = new Date(lastAt);
    const key = keyOf(item);
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
        const status = item.status ?? (item.result === undefined ? "running" : item.error ? "failed" : "completed");
        out.push({
          kind: "tool_call",
          id: `tool:${key}`,
          timestamp,
          payload: { source: "agent", data: { provider: "claude", callId: key, name: item.tool ?? item.text, status, error: status === "failed" ? (item.toolError ?? item.result ?? null) : null, detail: item.detail ?? { type: "unknown", input: item.input ?? null, output: item.result ?? null } } },
        });
        break;
      }
      case "turn":
        if (item.error) out.push({ kind: "notification", sourceType: "error", id: `turn:${key}`, timestamp, level: "error", message: item.text || "The run failed" });
        break;
      case "session":
      case "wake":
      case "mail":
        out.push({ kind: "piggery", id: `${item.kind}:${key}`, timestamp, prompt: item.kind !== "session", source: { kind: item.kind, text: item.text, ...(item.from ? { from: item.from } : {}), ...(item.ref ? { ref: item.ref } : {}), ...(item.reply ? { reply: item.reply } : {}) } });
        break;
    }
  }
  return out;
}
