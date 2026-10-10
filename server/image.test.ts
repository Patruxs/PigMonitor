import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readImage } from "./image.ts";

test("only an absolute path to a small enough image file is read", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pigmonitor-image-"));
  try {
    writeFileSync(path.join(dir, "shot.png"), "png bytes");
    writeFileSync(path.join(dir, "secret.txt"), "secret");
    writeFileSync(path.join(dir, "big.jpg"), Buffer.alloc(2048));
    symlinkSync(path.join(dir, "secret.txt"), path.join(dir, "secret.png"));
    assert.deepEqual(await readImage(path.join(dir, "shot.png")), { ok: true, data: Buffer.from("png bytes").toString("base64"), mimeType: "image/png" });
    assert.equal((await readImage("shot.png")).ok, false);
    assert.equal((await readImage(path.join(dir, "secret.txt"))).ok, false);
    assert.equal((await readImage(path.join(dir, "secret.png"))).ok, false);
    assert.equal((await readImage(path.join(dir, "big.jpg"), 1024)).ok, false);
    assert.equal((await readImage(path.join(dir, "missing.gif"))).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
