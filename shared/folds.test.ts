import assert from "node:assert/strict";
import test from "node:test";
import { foldsOf, isHidden, NO_FOLDS, prune, setHidden, showAll } from "./folds.ts";

test("a removed project is remembered by path and comes back", () => {
  const hidden = setHidden(NO_FOLDS, "/a/b", true);
  assert.equal(isHidden(hidden, "/a/b"), true);
  assert.equal(isHidden(hidden, "/a/c"), false);
  assert.equal(isHidden(setHidden(hidden, "/a/b", false), "/a/b"), false);
  assert.deepEqual(showAll(hidden).hidden, {});
});

test("hidden projects survive a prune and an odd stored document", () => {
  const f = setHidden(NO_FOLDS, "/a/b", true);
  assert.deepEqual(prune(f, []).hidden, { "/a/b": true });
  assert.deepEqual(foldsOf(null).hidden, {});
  assert.deepEqual(foldsOf({ hidden: { "/x": true } }).hidden, { "/x": true });
});

test("a tab saved by an older version opens where it went: the Board became the Graph, the Mail tab is gone", () => {
  assert.equal(foldsOf({ tab: "board" }).tab, "graph");
  assert.equal(foldsOf({ tab: "mail" }).tab, "overview");
  assert.equal(foldsOf({ tab: "sessions" }).tab, "sessions");
  assert.equal(foldsOf({ tab: "nonsense" }).tab, "overview");
});
