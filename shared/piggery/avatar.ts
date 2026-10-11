import { z } from "zod";
import { roleColour } from "./mail.ts";
import type { RoleKey } from "./palette.ts";
import type { View } from "./view.ts";

export const AVATAR_POOL = ["Cat", "Dog", "Rabbit", "Squirrel", "Rat", "Panda", "Bird", "Origami", "Fish", "Shrimp", "Turtle", "Snail", "Bug", "Worm", "PiggyBank", "Ghost", "Smile", "Baby"] as const;

export type AvatarIcon = (typeof AVATAR_POOL)[number];

export const AVATAR_MODES = ["off", "manual", "auto"] as const;

export type AvatarMode = (typeof AVATAR_MODES)[number];

export const AvatarSettings = z.object({
  mode: z.enum(AVATAR_MODES).default("off"),
  seed: z.number().int().default(0),
  picks: z.record(z.string(), z.string()).default({}),
});

export type AvatarSettings = z.output<typeof AvatarSettings>;

export const DEFAULT_AVATAR_SETTINGS: AvatarSettings = { mode: "off", seed: 0, picks: {} };

export type AvatarPerson = { id: string; role: string | undefined; joinedAt?: number; name?: string; team?: string };

export type AvatarGroup = { role: RoleKey; people: AvatarPerson[] };

const ROLE_RANK: Record<RoleKey, number> = { supervisor: 0, lead: 1, peer: 2, executor: 3, advisor: 4 };

const RESHUFFLE_TRIES = 64;

export function avatarPeopleOf(view: View): AvatarPerson[] {
  const people: AvatarPerson[] = [];
  for (const list of [view.all, view.closed]) for (const dir of list.dirs) for (const block of dir.blocks) for (const row of block.rows) if (row.kind === "member") people.push({ id: row.id, role: row.role, joinedAt: row.created_at, name: row.name, team: block.head?.name });
  return people;
}

function isPoolIcon(name: string | undefined): name is AvatarIcon {
  return name !== undefined && (AVATAR_POOL as readonly string[]).includes(name);
}

function spread(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function byArrival(a: AvatarPerson, b: AvatarPerson): number {
  const aJoined = a.joinedAt ?? Number.POSITIVE_INFINITY;
  const bJoined = b.joinedAt ?? Number.POSITIVE_INFINITY;
  if (aJoined !== bJoined) return aJoined < bJoined ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function firstFreeIcon(id: string, seed: number, taken: ReadonlySet<AvatarIcon>): AvatarIcon | undefined {
  const start = spread(`${seed}:${id}`) % AVATAR_POOL.length;
  for (let step = 0; step < AVATAR_POOL.length; step++) {
    const icon = AVATAR_POOL[(start + step) % AVATAR_POOL.length];
    if (!taken.has(icon)) return icon;
  }
  return undefined;
}

export function groupByRole(people: readonly AvatarPerson[]): AvatarGroup[] {
  const groups = new Map<RoleKey, AvatarPerson[]>();
  const seen = new Set<string>();
  for (const person of people) {
    const paint = roleColour(person.role, person.id);
    if (paint.kind !== "role" || seen.has(person.id)) continue;
    seen.add(person.id);
    const group = groups.get(paint.value);
    if (group) group.push(person);
    else groups.set(paint.value, [person]);
  }
  return [...groups].sort(([a], [b]) => ROLE_RANK[a] - ROLE_RANK[b]).map(([role, group]) => ({ role, people: group.sort(byArrival) }));
}

export function assignAvatars(people: readonly AvatarPerson[], settings: AvatarSettings): ReadonlyMap<string, AvatarIcon> {
  const assigned = new Map<string, AvatarIcon>();
  if (settings.mode === "off") return assigned;
  for (const { people: group } of groupByRole(people)) {
    const taken = new Set<AvatarIcon>();
    const unpicked: AvatarPerson[] = [];
    for (const person of group) {
      const pick = settings.picks[person.id];
      if (isPoolIcon(pick)) {
        assigned.set(person.id, pick);
        taken.add(pick);
      } else unpicked.push(person);
    }
    if (settings.mode !== "auto") continue;
    for (const person of unpicked) {
      const icon = firstFreeIcon(person.id, settings.seed, taken);
      if (icon === undefined) break;
      assigned.set(person.id, icon);
      taken.add(icon);
    }
  }
  return assigned;
}

function sameAssignment(a: ReadonlyMap<string, AvatarIcon>, b: ReadonlyMap<string, AvatarIcon>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, icon] of a) if (b.get(id) !== icon) return false;
  return true;
}

export function reshuffleAvatars(people: readonly AvatarPerson[], settings: AvatarSettings): AvatarSettings {
  const current = assignAvatars(people, settings);
  for (let step = 1; step <= RESHUFFLE_TRIES; step++) {
    const next = { ...settings, seed: settings.seed + step };
    if (!sameAssignment(assignAvatars(people, next), current)) return next;
  }
  return { ...settings, seed: settings.seed + 1 };
}
