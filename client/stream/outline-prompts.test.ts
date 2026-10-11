import assert from "node:assert/strict";
import test from "node:test";
import { promptsOfLoadedItems, resolveActivePromptSeq } from "./outline-prompts.ts";
import type { StreamItem } from "../../shared/stream/stream.ts";

const at = new Date(0);

test("the log view's prompts are the person's messages and incoming mail or wakes, and the active one is the last at or before the reading position", () => {
  const items: StreamItem[] = [
    { kind: "piggery", id: "run", timestamp: at, prompt: true, source: { kind: "run-start", text: "claude" } },
    { kind: "user_message", id: "u", text: "do it", timestamp: at },
    { kind: "assistant_message", id: "a", text: "done", timestamp: at },
    { kind: "piggery", id: "in", timestamp: at, prompt: true, source: { kind: "mail", text: "next", from: "lead" } },
    { kind: "piggery", id: "out", timestamp: at, prompt: false, source: { kind: "mail", text: "report", from: "me", to: "lead" } },
    { kind: "piggery", id: "wake", timestamp: at, prompt: true, source: { kind: "wake", text: "woken" } },
  ];
  const prompts = promptsOfLoadedItems(items);
  assert.deepEqual(prompts.map((prompt) => prompt.seq), [1, 3, 5]);
  assert.deepEqual([resolveActivePromptSeq(prompts, 0), resolveActivePromptSeq(prompts, 2), resolveActivePromptSeq(prompts, 9)], [null, 1, 5]);
});
