import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_AVATAR_SETTINGS, MAX_AVATAR_IMAGES, type AvatarSettings } from "../../shared/piggery/avatar.ts";
import { applyBatch } from "./avatar-batch.ts";

function withPeerImages(count: number): AvatarSettings {
  const images = Array.from({ length: count }, (_, index) => ({ id: `old${index}` }));
  return { ...DEFAULT_AVATAR_SETTINGS, libraries: { ...DEFAULT_AVATAR_SETTINGS.libraries, peer: { images } } };
}

test("a batch carries on past bad files, skips what the role already has, and reports in the order given", () => {
  const result = applyBatch(withPeerImages(1), "peer", [
    { name: "a.jpg", id: "a" },
    { name: "tiny.png", error: "too small" },
    { name: "again.jpg", id: "old0" },
    { name: "b.jpg", id: "b" },
    { name: "a-copy.jpg", id: "a" },
    { name: "x.gif", error: "wrong type" },
  ]);
  assert.deepEqual(result.added, ["a.jpg", "b.jpg"]);
  assert.deepEqual(result.duplicates, ["again.jpg", "a-copy.jpg"]);
  assert.deepEqual(result.refused, [{ name: "tiny.png", reason: "too small" }, { name: "x.gif", reason: "wrong type" }]);
  assert.deepEqual(result.full, []);
  assert.deepEqual(result.settings.libraries.peer.images.map((image) => image.id), ["old0", "a", "b"]);
  assert.deepEqual(result.settings.libraries.lead.images, []);
});

test("a batch stops at the role's cap and reports what did not fit", () => {
  const result = applyBatch(withPeerImages(MAX_AVATAR_IMAGES - 2), "peer", [
    { name: "1.jpg", id: "n1" },
    { name: "2.jpg", id: "n2" },
    { name: "3.jpg", id: "n3" },
    { name: "4.jpg", full: true },
  ]);
  assert.deepEqual(result.added, ["1.jpg", "2.jpg"]);
  assert.deepEqual(result.full, ["3.jpg", "4.jpg"]);
  assert.equal(result.settings.libraries.peer.images.length, MAX_AVATAR_IMAGES);
});
