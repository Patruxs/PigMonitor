import assert from "node:assert/strict";
import test from "node:test";
import { createChatFindModel, searchLoadedItems } from "./chat-find.ts";
import type { StreamItem } from "../stream/stream.ts";

const at = (seq: number, kind: "user_message" | "assistant_message"): StreamItem => ({ kind, id: `m${seq}`, text: "x", timestamp: new Date(0), timelineCursor: { epoch: "e", seq } }) as StreamItem;

test("find lands on the first matching message, counts every occurrence in the chat, and Next walks into the next message", async () => {
  const revealed: string[] = [];
  const model = createChatFindModel({
    search: async () => ({ epoch: "e", locations: [{ seq: 2, role: "assistant", count: 2 }, { seq: 4, role: "user", count: 1 }], nextCursor: null }),
    load: async () => undefined,
    reveal: async (messageId, _query, occurrence) => {
      revealed.push(`${messageId}:${occurrence}`);
      return { occurrence: occurrence < 0 ? 0 : occurrence, count: messageId === "m2" ? 2 : 1 };
    },
    clear: () => undefined,
  });
  model.updateHistory("e", [at(1, "user_message"), at(2, "assistant_message"), at(3, "user_message"), at(4, "user_message")]);
  model.open();
  model.setQuery("needle");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual({ selected: model.getSnapshot().selectedItemId, occurrence: model.getSnapshot().occurrence, count: model.getSnapshot().count }, { selected: "m2", occurrence: 0, count: 3 });
  model.next();
  await new Promise((resolve) => setTimeout(resolve, 20));
  model.next();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(model.getSnapshot().selectedItemId, "m4");
  assert.equal(model.getSnapshot().occurrence, 2);
  assert.deepEqual(revealed, ["m2:0", "m2:1", "m4:0"]);
});

test("find in the log view searches the loaded items, mail included, and reaches every match without loading history", async () => {
  const items = [
    { kind: "user_message", id: "user:1", text: "fix the Needle", timestamp: new Date(0) },
    { kind: "tool_call", id: "tool:2", timestamp: new Date(0), payload: { source: "agent", data: { provider: "claude", callId: "2", name: "needle", status: "completed", error: null, detail: { type: "unknown", input: null, output: null } } } },
    { kind: "assistant_message", id: "assistant:3", text: "no match here", timestamp: new Date(0) },
    { kind: "piggery", id: "mail:4", timestamp: new Date(0), prompt: true, source: { kind: "mail", text: "needle and\nneedle", from: "lead" } },
  ] as StreamItem[];
  const loads: number[] = [];
  const revealed: string[] = [];
  const model = createChatFindModel({
    search: async (query) => searchLoadedItems(items, query),
    load: async (_epoch, seq) => {
      loads.push(seq);
    },
    reveal: async (messageId, _query, occurrence) => {
      revealed.push(messageId);
      return { occurrence: occurrence < 0 ? 0 : occurrence, count: messageId === "mail:4" ? 2 : 1 };
    },
    clear: () => undefined,
  });
  model.updateHistory(null, items);
  model.open();
  model.setQuery("needle");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual({ selected: model.getSnapshot().selectedItemId, count: model.getSnapshot().count }, { selected: "user:1", count: 3 });
  model.next();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(model.getSnapshot().selectedItemId, "mail:4");
  assert.deepEqual(loads, []);
  assert.deepEqual(revealed, ["user:1", "mail:4"]);
});
