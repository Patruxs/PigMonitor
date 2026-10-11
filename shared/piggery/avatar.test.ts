import assert from "node:assert/strict";
import { test } from "node:test";
import { AVATAR_POOL, AvatarSettings, DEFAULT_AVATAR_SETTINGS, assignAvatars, reshuffleAvatars, type AvatarPerson } from "./avatar.ts";

const AUTO: AvatarSettings = { mode: "auto", seed: 0, picks: {} };

function crew(role: string, count: number, prefix = role): AvatarPerson[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, role, joinedAt: 1000 + index }));
}

function iconsOf(assigned: ReadonlyMap<string, string>, people: readonly AvatarPerson[]): (string | undefined)[] {
  return people.map((person) => assigned.get(person.id));
}

test("avatars stay off until the user opts in, and the human and pseudo ids never get one", () => {
  const people = [...crew("peer", 3), { id: "pat", role: "human" }, { id: "notify", role: "peer" }, { id: "x", role: undefined }];
  assert.deepEqual(AvatarSettings.parse({}), DEFAULT_AVATAR_SETTINGS);
  assert.equal(assignAvatars(people, DEFAULT_AVATAR_SETTINGS).size, 0);
  const assigned = assignAvatars(people, AUTO);
  assert.deepEqual([...assigned.keys()].sort(), ["peer-0", "peer-1", "peer-2"]);
});

test("in auto mode people of one role never share an avatar while the pool lasts", () => {
  const supervisors = [...crew("supervisor", 4), ...crew("chair", 4)];
  const leads = crew("lead", 12);
  const assigned = assignAvatars([...supervisors, ...leads], AUTO);
  for (const group of [supervisors, leads]) {
    const icons = iconsOf(assigned, group);
    assert.ok(icons.every((icon) => icon !== undefined));
    assert.equal(new Set(icons).size, group.length);
  }
});

test("the same people get the same avatars whatever order they are listed in", () => {
  const people = [...crew("peer", 9), ...crew("lead", 5)];
  const first = assignAvatars(people, AUTO);
  const again = assignAvatars([...people].reverse(), AUTO);
  assert.deepEqual([...again].sort(), [...first].sort());
});

test("a newcomer never takes the avatar of someone who was already there", () => {
  for (let seed = 0; seed < 50; seed++) {
    const settings = { ...AUTO, seed };
    const team = crew("peer", 8);
    const before = assignAvatars(team, settings);
    const after = assignAvatars([{ id: `newcomer-${seed}`, role: "peer", joinedAt: 5000 }, ...team], settings);
    assert.deepEqual(iconsOf(after, team), iconsOf(before, team), `seed ${seed}`);
  }
});

test("when a role outgrows the pool the earliest arrivals keep unique avatars and the overflow shows initials", () => {
  const peers = crew("peer", AVATAR_POOL.length + 3);
  const assigned = assignAvatars(peers, AUTO);
  const icons = iconsOf(assigned, peers);
  assert.equal(new Set(icons.slice(0, AVATAR_POOL.length)).size, AVATAR_POOL.length);
  assert.deepEqual(icons.slice(AVATAR_POOL.length), [undefined, undefined, undefined]);
});

test("a manual pick beats auto, auto steers around it, and picks that left the pool fall back", () => {
  const peers = crew("peer", 6);
  const autoIcon = assignAvatars(peers, AUTO).get("peer-1");
  assert.ok(autoIcon);
  const picks = { "peer-0": autoIcon, "peer-2": "NotAnIcon" };
  const mixed = assignAvatars(peers, { ...AUTO, picks });
  assert.equal(mixed.get("peer-0"), autoIcon);
  assert.notEqual(mixed.get("peer-1"), autoIcon);
  assert.ok(mixed.get("peer-2"));
  assert.equal(new Set(iconsOf(mixed, peers)).size, peers.length);
  const manual = assignAvatars(peers, { ...AUTO, mode: "manual", picks });
  assert.deepEqual([...manual], [["peer-0", autoIcon]]);
});

test("reshuffle always changes the assignment and then holds it", () => {
  for (const people of [crew("lead", 1), [...crew("peer", 5), ...crew("lead", 2)]]) {
    const before = assignAvatars(people, AUTO);
    const reshuffled = reshuffleAvatars(people, AUTO);
    const after = assignAvatars(people, reshuffled);
    assert.notDeepEqual([...after].sort(), [...before].sort());
    assert.deepEqual([...assignAvatars(people, reshuffled)], [...after]);
  }
});
