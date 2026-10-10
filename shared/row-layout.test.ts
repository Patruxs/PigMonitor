import assert from "node:assert/strict";
import test from "node:test";
import { columnsFor, CTX_COLUMN_MIN, ROLE_COLUMN_MIN, tailWidth } from "./row-layout.ts";

test("a narrowing line drops its role column first, then ctx, and its tail shrinks with them", () => {
  assert.deepEqual([ROLE_COLUMN_MIN, ROLE_COLUMN_MIN - 1, CTX_COLUMN_MIN, CTX_COLUMN_MIN - 1].map(columnsFor), ["both", "ctx", "ctx", "none"]);
  const share = (w: string) => Number.parseFloat(w);
  assert.ok(share(tailWidth("both")) > share(tailWidth("ctx")));
  assert.ok(share(tailWidth("ctx")) > share(tailWidth("none")));
  assert.ok(share(tailWidth("both")) < 100);
});
