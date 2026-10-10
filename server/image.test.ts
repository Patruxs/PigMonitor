import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pastedImageSaver, readImage } from "./image.ts";

test("only an absolute path to a small enough image file is read", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pigmonitor-image-"));
  try {
    writeFileSync(path.join(dir, "shot.png"), "png bytes");
    writeFileSync(path.join(dir, "secret.txt"), "secret");
    writeFileSync(path.join(dir, "big.jpg"), Buffer.alloc(2048));
    symlinkSync(path.join(dir, "secret.txt"), path.join(dir, "secret.png"));
    assert.deepEqual(await readImage(path.join(dir, "shot.png"), [dir]), { ok: true, data: Buffer.from("png bytes").toString("base64"), mimeType: "image/png" });
    assert.equal((await readImage("shot.png", [dir])).ok, false);
    assert.equal((await readImage(path.join(dir, "secret.txt"), [dir])).ok, false);
    assert.equal((await readImage(path.join(dir, "secret.png"), [dir])).ok, false);
    assert.equal((await readImage(path.join(dir, "big.jpg"), [dir], 1024)).ok, false);
    assert.equal((await readImage(path.join(dir, "missing.gif"), [dir])).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an image is read only inside the places allowed, even through a symlink", async () => {
  const allowed = mkdtempSync(path.join(tmpdir(), "pigmonitor-allowed-"));
  const elsewhere = mkdtempSync(path.join(tmpdir(), "pigmonitor-elsewhere-"));
  try {
    writeFileSync(path.join(allowed, "shot.png"), "png bytes");
    writeFileSync(path.join(elsewhere, "private.png"), "private bytes");
    symlinkSync(path.join(elsewhere, "private.png"), path.join(allowed, "link.png"));
    assert.equal((await readImage(path.join(allowed, "shot.png"), [allowed])).ok, true);
    assert.deepEqual([(await readImage(path.join(elsewhere, "private.png"), [allowed])).ok, (await readImage(path.join(allowed, "link.png"), [allowed])).ok], [false, false]);
  } finally {
    rmSync(allowed, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("pasted images are kept in a folder only this user can open", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pigmonitor-pasted-"));
  try {
    const file = pastedImageSaver(path.join(root, "pasted"))(Buffer.from("png").toString("base64"), "image/png");
    assert.ok(file);
    assert.equal(statSync(path.join(root, "pasted")).mode & 0o777, 0o700);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
