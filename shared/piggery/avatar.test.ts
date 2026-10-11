import assert from "node:assert/strict";
import { test } from "node:test";
import { AvatarSettings, DEFAULT_AVATAR_SETTINGS, MAX_AVATAR_IMAGE_BYTES, MAX_AVATAR_IMAGES, addAvatarImage, assignAvatars, avatarUploadError, centreSquare, imageInUse, migrateAvatarSettings, removeAvatarImage, reshuffleAvatars, reshuffleBlock, type AvatarPerson } from "./avatar.ts";
import type { RoleKey } from "./palette.ts";

function crew(role: string, count: number, prefix = role): AvatarPerson[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, role, joinedAt: 1000 + index }));
}

function pictures(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`);
}

function withPictures(libraries: Partial<Record<RoleKey, string[]>>): AvatarSettings {
  let settings: AvatarSettings = { ...DEFAULT_AVATAR_SETTINGS, mode: "on" };
  for (const [role, ids] of Object.entries(libraries) as [RoleKey, string[]][]) {
    for (const id of ids) {
      const change = addAvatarImage(settings, role, { id });
      if (!change.ok) throw new Error(change.error);
      settings = change.settings;
    }
  }
  return settings;
}

function avatarsOf(people: readonly AvatarPerson[], settings: AvatarSettings): ReadonlyMap<string, string> {
  return assignAvatars(people, settings).avatars;
}

function picturesOf(avatars: ReadonlyMap<string, string>, people: readonly AvatarPerson[]): (string | undefined)[] {
  return people.map((person) => avatars.get(person.id));
}

test("avatars stay off until the user opts in, and the human and pseudo ids never get one", () => {
  const people = [...crew("peer", 3), { id: "pat", role: "human" }, { id: "notify", role: "peer" }, { id: "x", role: undefined }];
  assert.deepEqual(AvatarSettings.parse({}), DEFAULT_AVATAR_SETTINGS);
  const settings = withPictures({ peer: pictures("p", 5) });
  assert.equal(avatarsOf(people, { ...settings, mode: "off" }).size, 0);
  assert.deepEqual([...avatarsOf(people, settings).keys()].sort(), ["peer-0", "peer-1", "peer-2"]);
});

test("each role draws only from its own library, people of one role never share a picture, and an empty library shows initials", () => {
  const supervisors = [...crew("supervisor", 2), ...crew("chair", 2)];
  const leads = crew("lead", 3);
  const peers = crew("peer", 2);
  const settings = withPictures({ supervisor: pictures("s", 4), lead: pictures("l", 5) });
  const avatars = avatarsOf([...supervisors, ...leads, ...peers], settings);
  for (const [group, prefix] of [[supervisors, "s"], [leads, "l"]] as const) {
    const shown = picturesOf(avatars, group);
    assert.ok(shown.every((id) => id?.startsWith(prefix)));
    assert.equal(new Set(shown).size, group.length);
  }
  assert.deepEqual(picturesOf(avatars, peers), [undefined, undefined]);
});

test("the same people get the same pictures whatever order they are listed in", () => {
  const people = [...crew("peer", 6), ...crew("lead", 3)];
  const settings = withPictures({ peer: pictures("p", 8), lead: pictures("l", 8) });
  assert.deepEqual([...avatarsOf([...people].reverse(), settings)].sort(), [...avatarsOf(people, settings)].sort());
});

test("when a role has more people than pictures the earliest arrivals keep unique ones and the overflow shows initials", () => {
  const peers = crew("peer", 5);
  const shown = picturesOf(avatarsOf(peers, withPictures({ peer: pictures("p", 3) })), peers);
  assert.equal(new Set(shown.slice(0, 3)).size, 3);
  assert.deepEqual(shown.slice(3), [undefined, undefined]);
});

test("people joining or leaving never move anyone else's picture, and a leaver's picture is free again", () => {
  const team = crew("peer", 4);
  const saved = assignAvatars(team, withPictures({ peer: pictures("p", 4) })).settings;
  const [leaver, ...stayers] = team;
  const after = assignAvatars([{ id: "newcomer", role: "peer", joinedAt: 1 }, ...stayers], saved);
  assert.deepEqual(picturesOf(after.avatars, stayers), stayers.map((person) => saved.assigned[person.id]));
  assert.equal(after.avatars.get("newcomer"), saved.assigned[leaver.id]);
});

test("an upload after assignment moves nobody, and the next person without a picture gets it", () => {
  const peers = crew("peer", 3);
  const saved = assignAvatars(peers, withPictures({ peer: pictures("p", 2) })).settings;
  const added = addAvatarImage(saved, "peer", { id: "fresh" });
  assert.ok(added.ok);
  const afterUpload = assignAvatars(peers, added.settings);
  assert.deepEqual(picturesOf(afterUpload.avatars, peers.slice(0, 2)), peers.slice(0, 2).map((person) => saved.assigned[person.id]));
  assert.equal(afterUpload.avatars.get("peer-2"), "fresh");
  assert.equal(addAvatarImage(added.settings, "peer", { id: "fresh" }).ok, false);
  assert.equal(addAvatarImage(withPictures({ lead: pictures("l", MAX_AVATAR_IMAGES) }), "lead", { id: "one-more" }).ok, false);
});

test("the result settles: run again on its own output, by a second writer after a reload, or by a writer that sees fewer people, it changes nothing", () => {
  const people = [...crew("peer", 5), ...crew("lead", 2)];
  const start = withPictures({ peer: pictures("p", 5), lead: pictures("l", 2) });
  const first = assignAvatars(people, start);
  assert.equal(first.changed, true);
  const again = assignAvatars(people, first.settings);
  assert.equal(again.changed, false);
  assert.equal(again.settings, first.settings);
  assert.deepEqual(assignAvatars(people, start).settings, first.settings);
  assert.equal(assignAvatars(people.slice(2), first.settings).changed, false);
});

test("reshuffling a role always changes that role's pictures and leaves every other role alone, and is refused up front exactly when it could change nothing", () => {
  const peers = crew("peer", 3);
  const leads = crew("lead", 3);
  const people = [...peers, ...leads];
  const first = assignAvatars(people, withPictures({ peer: pictures("p", 6), lead: pictures("l", 3) })).settings;
  const saved = { ...first, libraries: { ...first.libraries, lead: { ...first.libraries.lead, images: pictures("l", 9).map((id) => ({ id })) } } };
  const reshuffled = reshuffleAvatars(people, saved, "peer");
  const after = avatarsOf(people, reshuffled);
  assert.notDeepEqual(picturesOf(after, peers), peers.map((person) => saved.assigned[person.id]));
  assert.deepEqual(picturesOf(after, leads), leads.map((person) => saved.assigned[person.id]));
  assert.equal(assignAvatars(people, reshuffled).changed, false);
  const unchangeable: [string, AvatarPerson[], AvatarSettings][] = [
    ["off", peers, { ...withPictures({ peer: pictures("p", 3) }), mode: "off" }],
    ["no-pictures", peers, withPictures({})],
    ["nobody", leads, withPictures({ peer: pictures("p", 3) })],
    ["one-picture", peers, withPictures({ peer: ["only"] })],
  ];
  for (const [block, crowd, settings] of unchangeable) {
    const settled = assignAvatars(crowd, settings).settings;
    assert.equal(reshuffleBlock(crowd, settled, "peer"), block);
    assert.deepEqual(avatarsOf(crowd, reshuffleAvatars(crowd, settled, "peer")), avatarsOf(crowd, settled), block);
  }
  for (const [crowd, count] of [[crew("peer", 1), 2], [peers, 2]] as const) {
    const settled = assignAvatars(crowd, withPictures({ peer: pictures("p", count) })).settings;
    assert.equal(reshuffleBlock(crowd, settled, "peer"), null);
    assert.notDeepEqual(avatarsOf(crowd, reshuffleAvatars(crowd, settled, "peer")), avatarsOf(crowd, settled));
  }
});

test("removing a picture from a role frees only its holders there, and the file stays in use while another role has it", () => {
  const peers = crew("peer", 3);
  const leads = crew("lead", 1);
  const people = [...peers, ...leads];
  const saved = assignAvatars(people, withPictures({ peer: ["shared", "p1", "p2"], lead: ["shared"] })).settings;
  const holder = peers.find((person) => saved.assigned[person.id] === "shared");
  assert.ok(holder);
  const removed = removeAvatarImage(saved, "peer", "shared");
  assert.equal(imageInUse(removed, "shared"), true);
  const after = avatarsOf(people, removed);
  for (const person of peers) if (person !== holder) assert.equal(after.get(person.id), saved.assigned[person.id]);
  assert.notEqual(after.get(holder.id), "shared");
  assert.equal(after.get("lead-0"), "shared");
  const gone = removeAvatarImage(removed, "lead", "shared");
  assert.equal(imageInUse(gone, "shared"), false);
  assert.ok(!Object.values(gone.assigned).includes("shared"));
});

test("a version 1 document migrates: its mode maps to on or off, its pictures join every role, and icon picks and assignments are dropped", () => {
  const human = AvatarSettings.parse(migrateAvatarSettings({ mode: "manual", seed: 0, picks: {}, assigned: {}, images: [] }, 1));
  assert.deepEqual(human, { ...DEFAULT_AVATAR_SETTINGS, mode: "on" });
  const old = { mode: "auto", seed: 4, picks: { "peer-0": "Cat", "peer-1": "image:a" }, assigned: { "peer-2": "image:a", "lead-0": "Dog", "lead-1": "image:gone" }, images: [{ id: "a", label: "Ada" }] };
  const migrated = AvatarSettings.parse(migrateAvatarSettings(old, 1));
  assert.equal(migrated.mode, "on");
  assert.deepEqual(migrated.libraries.executor, { images: [{ id: "a" }], seed: 4 });
  assert.deepEqual(migrated.assigned, { "peer-2": "a" });
  assert.equal(AvatarSettings.parse(migrateAvatarSettings({ mode: "off" }, 1)).mode, "off");
  assert.deepEqual(AvatarSettings.parse(migrateAvatarSettings("garbage", 1)), DEFAULT_AVATAR_SETTINGS);
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
