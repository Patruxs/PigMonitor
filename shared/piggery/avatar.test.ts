import assert from "node:assert/strict";
import { test } from "node:test";
import { AvatarSettings, DEFAULT_AVATAR_SETTINGS, MAX_AVATAR_IMAGE_BYTES, MAX_AVATAR_IMAGES, addAvatarImage, assignAvatars, avatarUploadError, centreSquare, imageInUse, migrateAvatarSettings, pickAvatar, removeAvatarImage, type AvatarPerson } from "./avatar.ts";
import type { RoleKey } from "./palette.ts";

function crew(role: string, count: number, prefix = role): AvatarPerson[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, role, joinedAt: 1000 + index }));
}

function pictures(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`);
}

function withPictures(libraries: Partial<Record<RoleKey, string[]>>): AvatarSettings {
  let settings: AvatarSettings = { ...DEFAULT_AVATAR_SETTINGS, mode: "auto" };
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

test("the human and pseudo ids never get a picture in either mode, and a new document or one without a mode starts in Auto", () => {
  const people = [...crew("peer", 3), { id: "pat", role: "human" }, { id: "notify", role: "peer" }, { id: "x", role: undefined }];
  assert.deepEqual(AvatarSettings.parse({}), DEFAULT_AVATAR_SETTINGS);
  assert.equal(DEFAULT_AVATAR_SETTINGS.mode, "auto");
  for (const fromVersion of [1, 2, 3]) assert.equal(AvatarSettings.parse(migrateAvatarSettings({ assigned: {} }, fromVersion)).mode, "auto");
  const settings = withPictures({ peer: pictures("p", 1) });
  for (const mode of ["auto", "manual"] as const) assert.ok([...avatarsOf(people, { ...settings, mode }).keys()].every((id) => id.startsWith("peer-")));
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
  assert.equal(after.settings.assigned.newcomer, saved.assigned[leaver.id]);
  assert.equal(new Set(after.avatars.values()).size, after.avatars.size);
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

test("Manual shows a role's only picture on everyone, and with two or more shows only picks, initials until then", () => {
  const supervisors = crew("supervisor", 2);
  const peers = crew("peer", 3);
  const people = [...supervisors, ...peers];
  const manual = { ...withPictures({ supervisor: ["s0"], peer: pictures("p", 3) }), mode: "manual" as const };
  const before = assignAvatars(people, manual);
  assert.deepEqual(picturesOf(before.avatars, supervisors), ["s0", "s0"]);
  assert.deepEqual(picturesOf(before.avatars, peers), [undefined, undefined, undefined]);
  assert.deepEqual([...before.needsPick].sort(), ["peer-0", "peer-1", "peer-2"]);
  assert.equal(before.changed, false);
  const picked = pickAvatar(pickAvatar(manual, "peer-0", "p2"), "peer-1", "p2");
  const after = assignAvatars(people, picked);
  assert.deepEqual(picturesOf(after.avatars, peers), ["p2", "p2", undefined]);
  assert.deepEqual([...after.needsPick], ["peer-2"]);
  assert.equal(assignAvatars(people, pickAvatar(picked, "peer-0", null)).avatars.get("peer-0"), undefined);
});

test("switching Auto to Manual keeps what everyone shows, and back to Auto keeps the picks and fills the gaps", () => {
  const peers = crew("peer", 3);
  const auto = assignAvatars(peers, withPictures({ peer: pictures("p", 5) }));
  const manual = assignAvatars(peers, { ...auto.settings, mode: "manual" });
  assert.deepEqual([...manual.avatars].sort(), [...auto.avatars].sort());
  const edited = pickAvatar(pickAvatar(manual.settings, "peer-1", "p4"), "peer-2", null);
  const backToAuto = assignAvatars(peers, { ...edited, mode: "auto" });
  assert.equal(backToAuto.avatars.get("peer-0"), auto.avatars.get("peer-0"));
  assert.equal(backToAuto.avatars.get("peer-1"), "p4");
  assert.ok(backToAuto.avatars.get("peer-2"));
  assert.equal(new Set(backToAuto.avatars.values()).size, peers.length);
});

test("in Auto a pick that duplicates an earlier arrival's gives way to a free picture, or stays a duplicate when none is free", () => {
  const peers = crew("peer", 2);
  const duplicated = pickAvatar(pickAvatar(withPictures({ peer: ["p0", "p1"] }), "peer-0", "p0"), "peer-1", "p0");
  assert.deepEqual(picturesOf(avatarsOf(peers, duplicated), peers), ["p0", "p1"]);
  const full = pickAvatar(pickAvatar(withPictures({ peer: ["p0"] }), "peer-0", "p0"), "peer-1", "p0");
  assert.deepEqual(picturesOf(avatarsOf(peers, full), peers), ["p0", "p0"]);
});

test("old documents migrate to the newest version: the Human's version 2 document comes out as Auto with every picture where it was, and a version 1 document still loads", () => {
  const people = [...crew("supervisor", 1), ...crew("lead", 2), ...crew("peer", 5)];
  const shown = { "supervisor-0": "s0", "lead-0": "l0", "peer-0": "p2", "peer-1": "p0", "peer-2": "p3", "peer-3": "p1" };
  const human = {
    mode: "on",
    libraries: { supervisor: { images: [{ id: "s0" }], seed: 2 }, lead: { images: [{ id: "l0" }], seed: 0 }, peer: { images: pictures("p", 4).map((id) => ({ id })), seed: 5 }, executor: { images: [], seed: 0 }, advisor: { images: [], seed: 0 } },
    assigned: shown,
  };
  const migrated = AvatarSettings.parse(migrateAvatarSettings(human, 2));
  assert.equal(migrated.mode, "auto");
  const settled = assignAvatars(people, migrated);
  assert.equal(settled.changed, false);
  assert.deepEqual(Object.fromEntries(settled.avatars), shown);
  assert.equal(AvatarSettings.parse(migrateAvatarSettings({ ...human, mode: "off" }, 2)).mode, "manual");
  const old = { mode: "auto", seed: 4, picks: { "peer-0": "Cat" }, assigned: { "peer-2": "image:a", "lead-0": "Dog" }, images: [{ id: "a", label: "Ada" }] };
  const fromOne = AvatarSettings.parse(migrateAvatarSettings(old, 1));
  assert.equal(fromOne.mode, "auto");
  assert.deepEqual(fromOne.libraries.executor, { images: [{ id: "a" }] });
  assert.deepEqual(fromOne.assigned, { "peer-2": "a" });
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
