import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_AVATAR_SETTINGS, type AvatarSettings } from "../shared/piggery/avatar.ts";
import { avatarStore, MAX_STORED_AVATAR_BYTES } from "./avatar-images.ts";

const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(32, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 3)]);

function withStore(run: (store: ReturnType<typeof avatarStore>, dir: string, root: string, settings: { now: AvatarSettings | null }) => Promise<void>) {
  return async () => {
    const root = mkdtempSync(path.join(tmpdir(), "pigmonitor-avatars-"));
    const settings: { now: AvatarSettings | null } = { now: DEFAULT_AVATAR_SETTINGS };
    try {
      await run(avatarStore(path.join(root, "avatars"), async () => settings.now), path.join(root, "avatars"), root, settings);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test("the same picture uploaded twice is one file with one id, and reads back as stored", withStore(async (store, dir) => {
  const first = store.upload(WEBP.toString("base64"), "image/webp");
  const second = store.upload(WEBP.toString("base64"), "image/webp");
  assert.ok(first.ok && second.ok);
  assert.equal(first.id, second.id);
  assert.deepEqual(readdirSync(dir), [`${first.id}.webp`]);
  assert.deepEqual(await store.image(first.id), { ok: true, data: WEBP.toString("base64"), mimeType: "image/webp" });
}));

test("a picture of another type, of bytes that are not that type, or too large is refused and not stored", withStore(async (store, dir) => {
  assert.equal(store.upload(Buffer.from("GIF89a....").toString("base64"), "image/gif").ok, false);
  assert.equal(store.upload(Buffer.from("<svg/>").toString("base64"), "image/svg+xml").ok, false);
  assert.equal(store.upload(PNG.toString("base64"), "image/webp").ok, false);
  assert.equal(store.upload(Buffer.from("not an image at all").toString("base64"), "image/jpeg").ok, false);
  assert.equal(store.upload("not base64!", "image/png").ok, false);
  assert.equal(store.upload(Buffer.concat([PNG, Buffer.alloc(MAX_STORED_AVATAR_BYTES)]).toString("base64"), "image/png").ok, false);
  assert.equal(existsSync(dir), false);
}));

test("an id that is not a stored picture's hash cannot reach any other file", withStore(async (store, dir, root) => {
  const saved = store.upload(PNG.toString("base64"), "image/png");
  assert.ok(saved.ok);
  writeFileSync(path.join(root, "secret.png"), PNG);
  for (const id of ["../secret", "../secret.png", `${saved.id}.png`, `../avatars/${saved.id}`, saved.id.toUpperCase(), "", `${saved.id}\0`]) {
    assert.equal((await store.image(id)).ok, false, id);
    assert.equal((await store.delete(id)).ok, false, id);
  }
  assert.ok(existsSync(path.join(root, "secret.png")));
  assert.ok(existsSync(path.join(dir, `${saved.id}.png`)));
}));

test("a picture any role's library still uses, or that settings cannot tell about, is kept; an unused one is deleted and then reads as missing", withStore(async (store, dir, _root, settings) => {
  const saved = store.upload(PNG.toString("base64"), "image/png");
  assert.ok(saved.ok);
  settings.now = { ...DEFAULT_AVATAR_SETTINGS, libraries: { ...DEFAULT_AVATAR_SETTINGS.libraries, executor: { images: [{ id: saved.id }], seed: 0 } } };
  assert.equal((await store.delete(saved.id)).ok, false);
  settings.now = null;
  assert.equal((await store.delete(saved.id)).ok, false);
  assert.deepEqual(readdirSync(dir), [`${saved.id}.png`]);
  settings.now = DEFAULT_AVATAR_SETTINGS;
  assert.deepEqual(await store.delete(saved.id), { ok: true });
  assert.deepEqual(readdirSync(dir), []);
  const gone = await store.image(saved.id);
  assert.equal(!gone.ok && gone.code, "missing");
}));
