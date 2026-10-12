import assert from "node:assert/strict";
import { test } from "node:test";
import { AvatarSettings, DEFAULT_AVATAR_SETTINGS, MAX_AVATAR_IMAGE_BYTES, MAX_AVATAR_IMAGES, addAvatarImage, assignAvatars, avatarUploadError, centreSquare, imageInUse, avatarPeopleOf, migrateAvatarSettings, pickAvatar, removeAvatarImage, type AvatarPerson } from "./avatar.ts";
import type { AvatarGroupKey } from "./avatar.ts";
import type { Row, View } from "./view.ts";

function crew(role: string, count: number, prefix = role): AvatarPerson[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, role, joinedAt: 1000 + index }));
}

function inTeam(teamId: string, people: readonly AvatarPerson[], live = true): AvatarPerson[] {
  return people.map((person) => ({ ...person, id: `${teamId}/${person.id}`, teamId, live }));
}

function pictures(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`);
}

function withPictures(libraries: Partial<Record<AvatarGroupKey, string[]>>): AvatarSettings {
  let settings: AvatarSettings = { ...DEFAULT_AVATAR_SETTINGS, mode: "auto" };
  for (const [role, ids] of Object.entries(libraries) as [AvatarGroupKey, string[]][]) {
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

test("each role draws only from its own library, people of one role in a team never share a picture while one is free, and an empty library shows initials", () => {
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

test("with more people than pictures everyone still gets one: distinct while any is free, then repeats on the least-used pictures", () => {
  const peers = crew("peer", 6);
  const shown = picturesOf(avatarsOf(peers, withPictures({ peer: pictures("p", 4) })), peers);
  assert.equal(new Set(shown.slice(0, 4)).size, 4);
  assert.ok(shown.every((id) => id !== undefined));
  assert.notEqual(shown[4], shown[5]);
  const leads = crew("lead", 2);
  assert.deepEqual(picturesOf(avatarsOf(leads, withPictures({ lead: ["l0"] })), leads), ["l0", "l0"]);
});

test("the PigMonitor-5 shape: a second live Lead in a team whose Lead library has one picture shows it too", () => {
  const leads = inTeam("pm5", [{ id: "lead", role: "lead", joinedAt: 1 }, { id: "piggery-audit-challenger", role: "lead", joinedAt: 2 }]);
  const settings = { ...withPictures({ lead: ["l0"] }), assigned: { [leads[0].id]: "l0" } };
  const settled = assignAvatars(leads, settings);
  assert.deepEqual(picturesOf(settled.avatars, leads), ["l0", "l0"]);
  assert.deepEqual(settled.settings.assigned, { [leads[0].id]: "l0", [leads[1].id]: "l0" });
});

test("people joining or leaving a live team never move anyone else's picture, and a newcomer takes a free one at once", () => {
  const team = inTeam("t", crew("peer", 4));
  const saved = assignAvatars(team, withPictures({ peer: pictures("p", 4) })).settings;
  const [leaver, ...stayers] = team;
  const after = assignAvatars([{ id: "newcomer", role: "peer", joinedAt: 1, teamId: "t", live: true }, ...stayers], saved);
  assert.deepEqual(picturesOf(after.avatars, stayers), stayers.map((person) => saved.assigned[person.id]));
  assert.equal(after.avatars.get("newcomer"), saved.assigned[leaver.id]);
  assert.equal(after.settings.assigned.newcomer, saved.assigned[leaver.id]);
  assert.equal(new Set(after.avatars.values()).size, after.avatars.size);
  const six = inTeam("t", crew("peer", 6));
  const full = assignAvatars(six, withPictures({ peer: pictures("p", 4) })).settings;
  const seventh = { id: "seventh", role: "peer", joinedAt: 9000, teamId: "t", live: true };
  const joined = assignAvatars([...six, seventh], full);
  assert.deepEqual(picturesOf(joined.avatars, six), six.map((person) => full.assigned[person.id]));
  const before = new Map<string, number>();
  for (const person of six) before.set(full.assigned[person.id], (before.get(full.assigned[person.id]) ?? 0) + 1);
  assert.equal(before.get(joined.avatars.get("seventh") ?? ""), Math.min(...before.values()));
});

test("an upload never moves anyone with a unique picture; each new picture goes to one repeat holder, earliest sharer first", () => {
  const peers = crew("peer", 6);
  const saved = assignAvatars(peers, withPictures({ peer: pictures("p", 4) })).settings;
  const added = addAvatarImage(saved, "peer", { id: "fresh" });
  assert.ok(added.ok);
  const afterUpload = assignAvatars(peers, added.settings);
  assert.equal(afterUpload.avatars.get("peer-4"), "fresh");
  for (const person of peers) if (person.id !== "peer-4") assert.equal(afterUpload.avatars.get(person.id), saved.assigned[person.id]);
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
  assert.deepEqual(migrated.libraries.solo, { images: [] });
  assert.deepEqual(AvatarSettings.parse({ mode: "auto", libraries: { peer: { images: [{ id: "p0" }] } }, assigned: {} }).libraries.solo, { images: [] });
  const settled = assignAvatars(people, migrated);
  for (const [id, imageId] of Object.entries(shown)) assert.equal(settled.avatars.get(id), imageId);
  assert.equal(settled.avatars.get("lead-1"), "l0");
  assert.ok(settled.avatars.get("peer-4"));
  assert.equal(AvatarSettings.parse(migrateAvatarSettings({ ...human, mode: "off" }, 2)).mode, "manual");
  const old = { mode: "auto", seed: 4, picks: { "peer-0": "Cat" }, assigned: { "peer-2": "image:a", "lead-0": "Dog" }, images: [{ id: "a", label: "Ada" }] };
  const fromOne = AvatarSettings.parse(migrateAvatarSettings(old, 1));
  assert.equal(fromOne.mode, "auto");
  assert.deepEqual(fromOne.libraries.executor, { images: [{ id: "a" }] });
  assert.deepEqual(fromOne.assigned, { "peer-2": "a" });
  assert.deepEqual(AvatarSettings.parse(migrateAvatarSettings("garbage", 1)), DEFAULT_AVATAR_SETTINGS);
});

test("two live teams may show the same picture, but never twice among one team's people of a role while one is free", () => {
  const red = inTeam("red", crew("peer", 3));
  const blue = inTeam("blue", crew("peer", 3));
  const avatars = avatarsOf([...red, ...blue], withPictures({ peer: pictures("p", 3) }));
  for (const team of [red, blue]) assert.equal(new Set(picturesOf(avatars, team)).size, 3);
  assert.deepEqual(new Set(picturesOf(avatars, red)), new Set(picturesOf(avatars, blue)));
});

test("ended members never block a live one: the live peer claims a gone teammate's picture first, and a closed team's members change nothing elsewhere", () => {
  const ended = inTeam("t", crew("peer", 1, "old"), false);
  const live = inTeam("t", [{ id: "new", role: "peer", joinedAt: 5000 }]);
  const closed = inTeam("c", crew("peer", 2, "closed"), false);
  const settings = { ...withPictures({ peer: ["p0"] }), assigned: { [ended[0].id]: "p0", [closed[0].id]: "p0" } };
  const settled = assignAvatars([...ended, ...live, ...closed], settings);
  assert.equal(settled.avatars.get(live[0].id), "p0");
  assert.equal(settled.avatars.get(ended[0].id), "p0");
  assert.equal(settled.avatars.get(closed[0].id), "p0");
  assert.deepEqual(settled.settings.assigned, { ...settings.assigned, [live[0].id]: "p0" });
});

test("ended members' leftover pictures are shown but never stored, so a settle that only finds leftovers changes nothing", () => {
  const ended = inTeam("old", crew("peer", 3), false);
  const settings = withPictures({ peer: pictures("p", 3) });
  const settled = assignAvatars(ended, settings);
  assert.equal(new Set(picturesOf(settled.avatars, ended)).size, 3);
  assert.equal(settled.changed, false);
  assert.equal(settled.settings, settings);
});

test("closing a team frees its pictures for live people at once and leaves its members theirs", () => {
  const first = inTeam("first", crew("peer", 2));
  const open = assignAvatars(first, withPictures({ peer: pictures("p", 2) })).settings;
  const closed = first.map((person) => ({ ...person, live: false }));
  const next = inTeam("next", crew("peer", 2, "next"));
  const after = assignAvatars([...closed, ...next], open);
  assert.deepEqual(new Set(picturesOf(after.avatars, next)), new Set(["p0", "p1"]));
  assert.deepEqual(picturesOf(after.avatars, closed), first.map((person) => open.assigned[person.id]));
});

function row(kind: Row["kind"], id: string, fields: Partial<Row> = {}): Row {
  return { kind, id, depth: 0, name: id, state: "", state_text: "", status: "idle", unacked: 0, ...fields };
}

test("the Human's real view gives PigMonitor-9 pictures on the first settle while the old teams keep theirs", () => {
  const old = (team: string, id: string, role: string, created_at: number) => row("member", id, { team, role, created_at, status: "gone" });
  const view = {
    all: { dirs: [{ path: "/p", label: "p", blocks: [
      { rows: [row("team", "team:ember", { team: "ember", status: "gone" }), old("ember", "ember-sup", "supervisor", 1), old("ember", "ember-lead", "lead", 2), old("ember", "ember-peer", "peer", 3)] },
      { head: { id: "pm9", name: "PigMonitor-9", detail: "", line: true, open: true }, rows: [row("member", "nebula", { team: "pm9", role: "supervisor", created_at: 100 }), row("member", "avatar-lead", { team: "pm9", role: "lead", created_at: 101 }), ...["avatar-logic", "avatar-ui", "avatar-store"].map((id, index) => row("member", id, { team: "pm9", role: "peer", created_at: 102 + index, status: "working" }))] },
    ] }] },
    closed: { dirs: [{ path: "/q", label: "q", blocks: [{ rows: [row("team", "team:mango", { team: "mango", status: "gone", closed: "yesterday" }), ...["mango-a", "mango-b", "mango-c"].map((id, index) => old("mango", id, "peer", 10 + index))] }] }] },
  } as unknown as View;
  const people = avatarPeopleOf(view);
  assert.deepEqual(people.filter((person) => person.live).map((person) => person.id), ["nebula", "avatar-lead", "avatar-logic", "avatar-ui", "avatar-store"]);
  assert.equal(people.find((person) => person.id === "nebula")?.team, "PigMonitor-9");
  const stored = { "ember-sup": "s0", "ember-lead": "l0", "ember-peer": "p0", "mango-a": "p1", "mango-b": "p2", "mango-c": "p3" };
  const settings = { ...withPictures({ supervisor: ["s0"], lead: ["l0"], peer: pictures("p", 4) }), assigned: stored };
  const first = assignAvatars(people, settings);
  assert.equal(first.avatars.get("nebula"), "s0");
  assert.equal(first.avatars.get("avatar-lead"), "l0");
  const peers = ["avatar-logic", "avatar-ui", "avatar-store"].map((id) => first.avatars.get(id));
  assert.ok(peers.every((id) => id !== undefined));
  assert.equal(new Set(peers).size, 3);
  for (const [id, imageId] of Object.entries(stored)) assert.equal(first.avatars.get(id), imageId);
  assert.deepEqual(Object.keys(first.settings.assigned).sort(), [...Object.keys(stored), "nebula", "avatar-lead", "avatar-logic", "avatar-ui", "avatar-store"].sort());
  assert.equal(assignAvatars(people, first.settings).changed, false);
});

function soloView(): View {
  const solo = (id: string, created_at: number, status = "idle", harness = "claude") => ({ ...row("solo", id, { created_at, status: status as Row["status"], harness }), role: null, team: null });
  return {
    all: { dirs: [{ path: "/p", label: "p", blocks: [{ rows: [solo("basil", 300), solo("lgtm", 100, "idle", "paseo"), solo("thyme", 200)] }, { head: { id: "t", name: "Team", detail: "", line: true, open: true }, rows: [row("member", "lead", { team: "t", role: "lead", created_at: 50 })] }] }] },
    closed: { dirs: [{ path: "/q", label: "q", blocks: [{ rows: [solo("sage", 10, "gone"), solo("lgtm-before", 5, "gone", "paseo")] }] }] },
  } as unknown as View;
}

test("solo sessions form their own group, distinct while free, shared when one picture, initials when empty, and every one of the Human's own sessions stays out", () => {
  const people = avatarPeopleOf(soloView());
  assert.deepEqual(people.filter((person) => person.solo).map((person) => [person.id, person.live]), [["basil", true], ["thyme", true], ["sage", false]]);
  const two = assignAvatars(people, withPictures({ solo: ["o0", "o1"] }));
  assert.deepEqual(new Set([two.avatars.get("basil"), two.avatars.get("thyme")]), new Set(["o0", "o1"]));
  assert.equal(two.avatars.get("lead"), undefined);
  assert.deepEqual(Object.keys(two.settings.assigned).sort(), ["basil", "thyme"]);
  const one = avatarsOf(people, withPictures({ solo: ["o0"] }));
  assert.deepEqual(["basil", "thyme", "sage"].map((id) => one.get(id)), ["o0", "o0", "o0"]);
  assert.equal(avatarsOf(people, withPictures({ peer: ["p0"] })).get("basil"), undefined);
  const manual = assignAvatars(people, { ...withPictures({ solo: ["o0", "o1"] }), mode: "manual" });
  assert.ok(manual.needsPick.has("basil"));
});

test("basil's shape from the real view gets the Solo picture", () => {
  const settled = assignAvatars(avatarPeopleOf(soloView()), withPictures({ solo: ["o0"] }));
  assert.equal(settled.avatars.get("basil"), "o0");
  assert.equal(settled.settings.assigned.basil, "o0");
  for (const human of ["lgtm", "lgtm-before"]) assert.equal(settled.avatars.get(human), undefined);
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
