import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { bodyWithImages, saveImages } from "./attach.ts";

test("an image sent as mail is saved under the session's folder and its path is in the body", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "piggery-attach-"));
  try {
    const files = await saveImages(root, "01PEER", [{ data: Buffer.from("png bytes").toString("base64"), mimeType: "image/png" }]);
    assert.equal(files.length, 1);
    assert.equal(path.dirname(files[0]), path.join(root, "01PEER"));
    assert.ok(files[0].endsWith(".png"));
    assert.equal(readFileSync(files[0], "utf8"), "png bytes");
    assert.equal(bodyWithImages("look", files), `look\n[image: ${files[0]}]`);
    assert.equal(bodyWithImages("  ", files), `[image: ${files[0]}]`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
