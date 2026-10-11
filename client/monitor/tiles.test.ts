import assert from "node:assert/strict";
import { test } from "node:test";
import { tileColumns, tileWidth } from "./tiles.ts";

test("tiles that all fit stay on one row", () => {
  assert.equal(tileColumns(4, 4), 4);
  assert.equal(tileColumns(2, 6), 2);
});

test("tiles that overflow split into even rows instead of leaving a lone tile", () => {
  assert.equal(tileColumns(4, 3), 2);
  assert.equal(tileColumns(5, 4), 3);
  assert.equal(tileColumns(6, 4), 3);
  assert.equal(tileColumns(7, 3), 3);
});

test("width at a 393px phone puts four tiles in two rows of two", () => {
  const w = tileWidth(361, 4, 88, 220, 8);
  assert.equal(w, 176);
});

test("width at 430px keeps four tiles on one row", () => {
  const w = tileWidth(398, 4, 88, 220, 8);
  assert.equal(w, 93);
});

test("width on desktop is capped", () => {
  assert.equal(tileWidth(1368, 2, 88, 220, 8), 220);
});

test("a full row of tiles fits its row in 32-bit float layout", () => {
  const rowWidth = 248 + 2 / 3;
  const w = Math.fround(tileWidth(rowWidth, 2, 88, 220, 8));
  assert.ok(Math.fround(w + Math.fround(8 + w)) <= Math.fround(rowWidth));
});
