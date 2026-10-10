import assert from "node:assert/strict";
import test from "node:test";
import { isWake, mailsIn, stripMails } from "./mail-tags.ts";

test("piggery's message blocks are read, and lifted out of the prompt that carried them", () => {
  const text = '[piggery] 2 new messages:\n\n<message id="#1440" from="gates (supervisor, you report to them)" sender="gates" reply_to="#1433" at="10:22:12">\nTình trạng?\n</message>\n<message id="#1441" from="x" sender="ci">\nDone.\n</message>';
  assert.deepEqual(mailsIn(text), [
    { ref: "#1440", from: "gates", reply: "#1433", body: "Tình trạng?" },
    { ref: "#1441", from: "ci", reply: undefined, body: "Done." },
  ]);
  assert.equal(stripMails(`${text}\nAlso, ship it.`), "Also, ship it.");
  assert.equal(isWake("Another Claude session sent a message:\n[piggery] wake #1: you have new mail"), true);
  assert.equal(isWake("merge code vào main đi"), false);
});
