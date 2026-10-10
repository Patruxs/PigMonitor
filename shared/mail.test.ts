import assert from "node:assert/strict";
import { test } from "node:test";
import { replyTarget, type MailMessage } from "./mail.ts";

const msg = (p: Partial<MailMessage> & { seq: number; from: string; to: string }): MailMessage => ({ id: `m${p.seq}`, from_name: p.from === "ME" ? "lgtm" : p.from === "W" ? "worker" : "lead", to_name: "x", body: `body ${p.seq}`, created_at: p.seq * 1000, ...p });

test("a reply answers the newest mail the session sent", () => {
  const thread = [msg({ seq: 9, from: "A", to: "ME" }), msg({ seq: 3, from: "A", to: "ME" }), msg({ seq: 12, from: "ME", to: "A" })];
  assert.equal(replyTarget(thread, "A")?.seq, 9);
  assert.equal(replyTarget(thread, "B"), undefined);
});
