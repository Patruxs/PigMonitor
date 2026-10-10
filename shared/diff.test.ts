import assert from "node:assert/strict";
import test from "node:test";
import { buildLineDiff, parseUnifiedDiff } from "./diff.ts";

test("a line diff keeps both texts in order and marks only the changed words of a replaced line", () => {
  const before = "const a = 1;\nconst b = 2;\nreturn a;";
  const after = "const a = 1;\nconst b = 3;\nconst c = 4;\nreturn a;";
  const diff = buildLineDiff(before, after);
  assert.deepEqual(diff.filter((line) => line.type !== "add").map((line) => line.content.slice(1)), before.split("\n"));
  assert.deepEqual(diff.filter((line) => line.type !== "remove").map((line) => line.content.slice(1)), after.split("\n"));
  const removed = diff.find((line) => line.type === "remove");
  assert.deepEqual(removed?.segments?.filter((segment) => segment.changed).map((segment) => segment.text), ["2"]);
  assert.deepEqual(buildLineDiff("", ""), []);
});

test("a unified diff keeps hunks and changed lines and drops the file headers", () => {
  const diff = parseUnifiedDiff(["diff --git a/x.ts b/x.ts", "index 1..2 100644", "--- a/x.ts", "+++ b/x.ts", "@@ -1,2 +1,2 @@", " keep", "-old", "+new", "\\ No newline at end of file"].join("\n"));
  assert.deepEqual(diff.map((line) => [line.type, line.content]), [["header", "@@ -1,2 +1,2 @@"], ["context", " keep"], ["remove", "-old"], ["add", "+new"], ["header", "\\ No newline at end of file"]]);
});
