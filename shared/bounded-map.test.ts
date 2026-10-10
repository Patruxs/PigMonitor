import assert from "node:assert/strict";
import test from "node:test";
import { BoundedMap } from "./bounded-map.ts";

test("a bounded cache drops its least recently used entry past its limit, and a read keeps an entry", () => {
  const cache = new BoundedMap<string, number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a");
  cache.set("c", 3);
  assert.deepEqual([...cache.keys()].sort(), ["a", "c"]);
});
