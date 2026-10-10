import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("installed.ts is the single line `piggery setup paseo` rewrites with its own path, empty in the source tree", () => {
  const text = readFileSync(path.join(import.meta.dirname, "installed.ts"), "utf8");
  assert.equal(text, 'export const piggeryPath = "";\n');
});
