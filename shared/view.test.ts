import assert from "node:assert/strict";
import test from "node:test";
import { readView, VIEW_VERSION } from "./view.ts";

test("the view is read only at this plugin's version: none or older says update piggery, newer says update the plugin", () => {
  assert.deepEqual([readView(null), readView({}), readView({ version: VIEW_VERSION - 1 }), readView({ version: VIEW_VERSION + 1 })].map((r) => (r.ok ? "ok" : r.code)), ["older", "older", "older", "newer"]);
  const doc = { version: VIEW_VERSION, summary: {} };
  const read = readView(doc);
  assert.equal(read.ok && read.view, doc);
});
