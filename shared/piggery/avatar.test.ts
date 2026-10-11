import assert from "node:assert/strict";
import { test } from "node:test";
import { AVATAR_POOL, AvatarSettings, DEFAULT_AVATAR_SETTINGS, MAX_AVATAR_IMAGE_BYTES, assignAvatars, avatarPool, avatarUploadError, centreSquare, imageRef, removeAvatarImage, reshuffleAvatars, type AvatarImage, type AvatarPerson } from "./avatar.ts";

const AUTO: AvatarSettings = { mode: "auto", seed: 0, picks: {}, assigned: {}, images: [] };

function crew(role: string, count: number, prefix = role): AvatarPerson[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, role, joinedAt: 1000 + index }));
}

function library(...ids: string[]): AvatarImage[] {
  return ids.map((id) => ({ id }));
}

function avatarsOf(people: readonly AvatarPerson[], settings: AvatarSettings): ReadonlyMap<string, string> {
  return assignAvatars(people, settings).avatars;
}

function iconsOf(assigned: ReadonlyMap<string, string>, people: readonly AvatarPerson[]): (string | undefined)[] {
  return people.map((person) => assigned.get(person.id));
}

test("avatars stay off until the user opts in, and the human and pseudo ids never get one", () => {
  const people = [...crew("peer", 3), { id: "pat", role: "human" }, { id: "notify", role: "peer" }, { id: "x", role: undefined }];
  assert.deepEqual(AvatarSettings.parse({}), DEFAULT_AVATAR_SETTINGS);
  assert.deepEqual(AvatarSettings.parse({ mode: "auto", seed: 3, picks: { "peer-0": "Cat" } }).assigned, {});
  assert.equal(avatarsOf(people, DEFAULT_AVATAR_SETTINGS).size, 0);
  const assigned = avatarsOf(people, AUTO);
  assert.deepEqual([...assigned.keys()].sort(), ["peer-0", "peer-1", "peer-2"]);
});

test("in auto mode people of one role never share an avatar while the pool lasts", () => {
  const supervisors = [...crew("supervisor", 4), ...crew("chair", 4)];
  const leads = crew("lead", 12);
  const assigned = avatarsOf([...supervisors, ...leads], { ...AUTO, images: library("a", "b") });
  for (const group of [supervisors, leads]) {
    const icons = iconsOf(assigned, group);
    assert.ok(icons.every((icon) => icon !== undefined));
    assert.equal(new Set(icons).size, group.length);
  }
});

test("the same people get the same avatars whatever order they are listed in", () => {
  const people = [...crew("peer", 9), ...crew("lead", 5)];
  const first = avatarsOf(people, AUTO);
  const again = avatarsOf([...people].reverse(), AUTO);
  assert.deepEqual([...again].sort(), [...first].sort());
});

test("people joining or leaving never move anyone else's avatar, and a leaver's avatar is free again", () => {
  const team = crew("peer", AVATAR_POOL.length);
  const saved = assignAvatars(team, AUTO).settings;
  const [leaver, ...stayers] = team;
  const newcomer = { id: "newcomer", role: "peer", joinedAt: 1 };
  const after = assignAvatars([newcomer, ...stayers], saved);
  assert.deepEqual(iconsOf(after.avatars, stayers), stayers.map((person) => saved.assigned[person.id]));
  assert.equal(after.avatars.get("newcomer"), saved.assigned[leaver.id]);
});

test("when a role outgrows the pool the earliest arrivals keep unique avatars and the overflow shows initials", () => {
  const images = library("a", "b");
  const peers = crew("peer", AVATAR_POOL.length + images.length + 3);
  const assigned = avatarsOf(peers, { ...AUTO, images });
  const icons = iconsOf(assigned, peers);
  const poolSize = AVATAR_POOL.length + images.length;
  assert.equal(new Set(icons.slice(0, poolSize)).size, poolSize);
  assert.deepEqual(icons.slice(poolSize), [undefined, undefined, undefined]);
});

test("a manual pick beats auto and takes the avatar away from its holder, and picks that left the pool fall back", () => {
  const peers = crew("peer", 6);
  const saved = assignAvatars(peers, AUTO).settings;
  const autoIcon = saved.assigned["peer-1"];
  assert.ok(autoIcon);
  const picks = { "peer-0": autoIcon, "peer-2": "NotAnIcon" };
  const mixed = assignAvatars(peers, { ...saved, picks });
  assert.equal(mixed.avatars.get("peer-0"), autoIcon);
  assert.notEqual(mixed.avatars.get("peer-1"), autoIcon);
  assert.ok(mixed.avatars.get("peer-2"));
  assert.equal(new Set(iconsOf(mixed.avatars, peers)).size, peers.length);
  const manual = avatarsOf(peers, { ...AUTO, mode: "manual", picks });
  assert.deepEqual([...manual], [["peer-0", autoIcon]]);
});

test("the pool is the library's images first, then the icons, and picks may name either", () => {
  const images = library("a", "b");
  assert.deepEqual(avatarPool({ ...AUTO, images }), [imageRef("a"), imageRef("b"), ...AVATAR_POOL]);
  const peers = crew("peer", 3);
  const manual = { ...AUTO, images, mode: "manual" as const, picks: { "peer-0": imageRef("b"), "peer-1": "Cat", "peer-2": imageRef("gone") } };
  assert.deepEqual([...avatarsOf(peers, manual)], [["peer-0", imageRef("b")], ["peer-1", "Cat"]]);
});

test("an upload after assignment changes no existing entry, and the next person to need one gets an image first", () => {
  const peers = crew("peer", 4);
  const saved = assignAvatars(peers, AUTO).settings;
  const images = library("a");
  const uploaded = { ...saved, images };
  const afterUpload = assignAvatars(peers, uploaded);
  assert.equal(afterUpload.changed, false);
  assert.equal(afterUpload.settings, uploaded);
  const withNewcomer = assignAvatars([...peers, { id: "newcomer", role: "peer", joinedAt: 9000 }], uploaded);
  assert.equal(withNewcomer.avatars.get("newcomer"), imageRef("a"));
});

test("the result settles: run again on its own output, by a second writer after a reload, or by a writer that sees fewer people, it changes nothing", () => {
  const people = [...crew("peer", 5), ...crew("lead", 2)];
  const start = { ...AUTO, images: library("a", "b") };
  const first = assignAvatars(people, start);
  assert.equal(first.changed, true);
  const again = assignAvatars(people, first.settings);
  assert.equal(again.changed, false);
  assert.equal(again.settings, first.settings);
  const rival = assignAvatars(people, start);
  assert.deepEqual(rival.settings, first.settings);
  assert.equal(assignAvatars(people.slice(2), first.settings).changed, false);
});

test("reshuffle always changes the assignment, rebuilds it images first, and then holds it", () => {
  for (const people of [crew("lead", 1), [...crew("peer", 5), ...crew("lead", 2)]]) {
    const saved = assignAvatars(people, AUTO).settings;
    const before = avatarsOf(people, saved);
    const reshuffled = reshuffleAvatars(people, saved);
    const after = avatarsOf(people, reshuffled);
    assert.notDeepEqual([...after].sort(), [...before].sort());
    assert.equal(assignAvatars(people, reshuffled).changed, false);
  }
  const peers = crew("peer", 4);
  const onIcons = { ...assignAvatars(peers, AUTO).settings, images: library("a", "b") };
  const reshuffled = reshuffleAvatars(peers, onIcons);
  assert.deepEqual(new Set(iconsOf(avatarsOf(peers, reshuffled), peers.slice(0, 2))), new Set([imageRef("a"), imageRef("b")]));
});

test("deleting an image clears every pick and assignment of it, and only its holders get a new avatar", () => {
  const people = [...crew("peer", 4), ...crew("lead", 2)];
  const saved = assignAvatars(people, { ...AUTO, images: library("a", "b", "c"), picks: { "peer-3": imageRef("b") }, assigned: { "lead-0": imageRef("b") } }).settings;
  const settings = removeAvatarImage(saved, "b");
  assert.deepEqual(settings.images.map((image) => image.id), ["a", "c"]);
  assert.ok(!JSON.stringify(settings).includes(imageRef("b")));
  const after = assignAvatars(people, settings).avatars;
  const holders = ["peer-3", "lead-0"];
  for (const person of people) {
    if (holders.includes(person.id)) assert.ok(after.get(person.id) && after.get(person.id) !== imageRef("b"));
    else assert.equal(after.get(person.id), saved.assigned[person.id]);
  }
});

test("an upload is a PNG, JPEG or WebP of at most 5 MB, decodable, and at least 128 px on its short side, into a library of at most 64", () => {
  const good = { mimeType: "image/png", bytes: MAX_AVATAR_IMAGE_BYTES, size: { width: 128, height: 900 } };
  for (const mimeType of ["image/png", "image/jpeg", "image/webp"]) assert.equal(avatarUploadError({ ...good, mimeType }, 63), null);
  assert.notEqual(avatarUploadError({ ...good, mimeType: "image/gif" }, 0), null);
  assert.notEqual(avatarUploadError({ ...good, bytes: MAX_AVATAR_IMAGE_BYTES + 1 }, 0), null);
  assert.notEqual(avatarUploadError({ ...good, size: null }, 0), null);
  assert.notEqual(avatarUploadError({ ...good, size: { width: 127, height: 900 } }, 0), null);
  assert.notEqual(avatarUploadError(good, 64), null);
});

test("the crop is the largest centred square of the picture", () => {
  assert.deepEqual(centreSquare(400, 300), { x: 50, y: 0, side: 300 });
  assert.deepEqual(centreSquare(300, 501), { x: 0, y: 100, side: 300 });
  assert.deepEqual(centreSquare(256, 256), { x: 0, y: 0, side: 256 });
});
