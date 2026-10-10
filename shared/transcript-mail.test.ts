import assert from "node:assert/strict";
import { test } from "node:test";
import type { MailMessage } from "./mail.ts";
import type { Item } from "./transcript.ts";
import { mergeMail } from "./transcript-mail.ts";

const msg = (p: Partial<MailMessage> & { seq: number; from: string; to: string }): MailMessage => ({ id: `m${p.seq}`, from_name: p.from === "ME" ? "lgtm" : p.from === "W" ? "worker" : "lead", to_name: "x", body: `body ${p.seq}`, created_at: p.seq * 1000, ...p });

test("the person's mail becomes their bubbles with the send state, the session's mail in", () => {
  const items = mergeMail([], [msg({ seq: 1, from: "ME", to: "W" }), msg({ seq: 2, from: "W", to: "ME", reply_seq: 1 }), msg({ seq: 3, from: "ME", to: "W", acked_at: 5 }), msg({ seq: 4, from: "ME", to: "W", held: "limit" })], "W", "ME");
  assert.deepEqual(items.map((i) => [i.kind, i.ref, i.note ?? i.reply]), [["user", "#1", "Sent"], ["mail", "#2", "#1"], ["user", "#3", "Read"], ["user", "#4", "Held"]]);
  assert.equal(items[1].from, "worker");
});

test("each mail shows once, where the worker first saw it or sent it, else where it was sent", () => {
  const log: Item[] = [
    { i: 0, kind: "run-start", at: 2000, text: "run" },
    { i: 1, kind: "tool", at: 3000, text: "mcp__piggery__inbox", tool: "mcp__piggery__inbox" },
    { i: 2, kind: "mail", at: 3000, text: "body 1", from: "lead", ref: "#1", redelivered: true },
    { i: 3, kind: "mail", at: 3000, text: "body 3", from: "lead", ref: "#3" },
    { i: 4, kind: "tool", at: 7000, text: "mcp__piggery__send", tool: "mcp__piggery__send", ref: "#4" },
    { i: 5, kind: "mail", at: 8000, text: "body 3", from: "lead", ref: "#3", redelivered: true },
    { i: 6, kind: "turn-end", at: 9000, text: "" },
  ];
  const db = [msg({ seq: 1, from: "L", to: "W" }), msg({ seq: 3, from: "L", to: "W", created_at: 2500 }), msg({ seq: 4, from: "W", to: "L", created_at: 7100 }), msg({ seq: 5, from: "ME", to: "W", created_at: 8500 })];
  const items = mergeMail(log, db, "W", "ME");
  assert.deepEqual(items.map((i) => [i.kind, i.ref]), [["mail", "#1"], ["run-start", undefined], ["tool", undefined], ["mail", "#3"], ["mail", "#4"], ["user", "#5"], ["turn-end", undefined]]);
  assert.equal(items[3].at, 3000);
  assert.deepEqual([items[3].outgoing, items[4].outgoing, items[4].from, items[4].to], [undefined, true, "worker", "x"]);
});

test("mail queued while the worker was busy shows where piggery handed it over, not inside the turn it was sent during", () => {
  const log: Item[] = [
    { i: 0, kind: "delivery", at: 1000, text: "" },
    { i: 1, kind: "run-start", at: 1000, text: "run" },
    { i: 2, kind: "assistant", at: 5000, text: "working" },
    { i: 3, kind: "turn-end", at: 9000, text: "" },
    { i: 4, kind: "delivery", at: 9500, text: "" },
    { i: 5, kind: "run-start", at: 9500, text: "run" },
    { i: 6, kind: "assistant", at: 9600, text: "thanks" },
  ];
  const db = [msg({ seq: 1, from: "L", to: "W", created_at: 500 }), msg({ seq: 2, from: "L", to: "W", created_at: 6000 }), msg({ seq: 3, from: "L", to: "W", created_at: 7000, held: "limit" })];
  const items = mergeMail(log, db, "W", "ME");
  assert.deepEqual(items.map((i) => i.ref ?? i.kind), ["#1", "run-start", "assistant", "#3", "turn-end", "#2", "run-start", "assistant"]);
  assert.equal(items[5].at, 9500);
});
