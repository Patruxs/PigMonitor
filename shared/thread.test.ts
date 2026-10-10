import assert from "node:assert/strict";
import { test } from "node:test";
import type { MailMessage } from "./mail.ts";
import type { Item } from "./transcript.ts";
import { itemsOfThread, latestFrom, mergeItems } from "./thread.ts";

const me = { id: "ME", name: "lgtm" };
const msg = (p: Partial<MailMessage> & { seq: number; from: string; to: string }): MailMessage => ({ id: `m${p.seq}`, from_name: p.from === "ME" ? "lgtm" : "pigeon", to_name: "x", body: `body ${p.seq}`, created_at: p.seq * 1000, ...p });

test("the person's mail becomes their bubbles with the send state, the session's mail in", () => {
  const items = itemsOfThread([msg({ seq: 1, from: "ME", to: "A" }), msg({ seq: 2, from: "A", to: "ME", reply_seq: 1 }), msg({ seq: 3, from: "ME", to: "A", acked_at: 5 }), msg({ seq: 4, from: "ME", to: "A", held: "limit" })], me);
  assert.deepEqual(items.map((i) => [i.kind, i.ref, i.note ?? i.reply]), [["user", "#1", "Sent"], ["mail", "#2", "#1"], ["user", "#3", "Read"], ["user", "#4", "Held"]]);
  assert.equal(items[1].from, "pigeon");
});

test("latestFrom picks the newest mail the session sent", () => {
  const thread = [msg({ seq: 9, from: "A", to: "ME" }), msg({ seq: 3, from: "A", to: "ME" }), msg({ seq: 12, from: "ME", to: "A" })];
  assert.equal(latestFrom(thread, "A")?.seq, 9);
  assert.equal(latestFrom(thread, "B"), undefined);
});

test("mergeItems orders by time and drops the session's copy of the person's mail", () => {
  const own: Item[] = [{ i: 0, kind: "assistant", at: 1000, text: "a" }, { i: 1, kind: "mail", at: 2500, text: "copy", from: "lgtm" }, { i: 2, kind: "assistant", at: 3000, text: "b" }];
  const extra: Item[] = [{ i: 5, kind: "user", at: 2000, text: "mine", note: "Sent" }];
  assert.deepEqual(mergeItems(own, extra, "lgtm").map((i) => i.text), ["a", "mine", "b"]);
  assert.deepEqual(mergeItems(own, [], undefined).map((i) => i.text), ["a", "copy", "b"]);
});
