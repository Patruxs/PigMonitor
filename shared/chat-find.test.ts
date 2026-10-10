import assert from "node:assert/strict";
import test from "node:test";
import { ChatFindModel } from "./chat-find.ts";
import type { StreamItem } from "./stream.ts";

const at = (seq: number, kind: "user_message" | "assistant_message"): StreamItem => ({ kind, id: `m${seq}`, text: "x", timestamp: new Date(0), timelineCursor: { epoch: "e", seq } }) as StreamItem;

test("find lands on the first matching message, counts every occurrence in the chat, and Next walks into the next message", async () => {
  const revealed: string[] = [];
  const model = new ChatFindModel({
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
