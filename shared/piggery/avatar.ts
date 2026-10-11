import { z } from "zod";
import { roleColour } from "./mail.ts";
import type { RoleKey } from "./palette.ts";
import type { View } from "./view.ts";

export const AVATAR_POOL = ["Cat", "Dog", "Rabbit", "Squirrel", "Rat", "Panda", "Bird", "Origami", "Fish", "Shrimp", "Turtle", "Snail", "Bug", "Worm", "PiggyBank", "Ghost", "Smile", "Baby"] as const;

export type AvatarIcon = (typeof AVATAR_POOL)[number];

export type AvatarRef = AvatarIcon | `image:${string}`;

export const MAX_AVATAR_IMAGES = 64;

export const AVATAR_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const MAX_AVATAR_IMAGE_BYTES = 5 * 1024 * 1024;

export const MIN_AVATAR_IMAGE_SIDE = 128;

export const AVATAR_IMAGE_SIDE = 256;

export const AVATAR_MODES = ["off", "manual", "auto"] as const;

export type AvatarMode = (typeof AVATAR_MODES)[number];

export const AvatarImage = z.object({ id: z.string(), label: z.string().optional() });

export type AvatarImage = z.output<typeof AvatarImage>;

export const AvatarSettings = z.object({
  mode: z.enum(AVATAR_MODES).default("off"),
  seed: z.number().int().default(0),
  picks: z.record(z.string(), z.string()).default({}),
  assigned: z.record(z.string(), z.string()).default({}),
  images: z.array(AvatarImage).default([]),
});

export type AvatarSettings = z.output<typeof AvatarSettings>;

export const DEFAULT_AVATAR_SETTINGS: AvatarSettings = { mode: "off", seed: 0, picks: {}, assigned: {}, images: [] };

export type AvatarPerson = { id: string; role: string | undefined; joinedAt?: number; name?: string; team?: string };

export type AvatarGroup = { role: RoleKey; people: AvatarPerson[] };

export type AvatarSettlement = { settings: AvatarSettings; avatars: ReadonlyMap<string, AvatarRef>; changed: boolean };

export type AvatarUpload = { mimeType: string; bytes: number; size: { width: number; height: number } | null };

export type CropRect = { x: number; y: number; side: number };

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

export function imageRef(imageId: string): AvatarRef {
  return `image:${imageId}`;
}

export function imageIdOf(ref: string): string | null {
  return ref.startsWith("image:") ? ref.slice("image:".length) : null;
}

function imageRefsOf(settings: AvatarSettings): AvatarRef[] {
  return [...new Set(settings.images.map((image) => imageRef(image.id)))];
}

export function avatarPool(settings: AvatarSettings): AvatarRef[] {
  return [...imageRefsOf(settings), ...AVATAR_POOL];
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

function firstFree(id: string, seed: number, refs: readonly AvatarRef[], taken: ReadonlySet<string>): AvatarRef | undefined {
  const start = refs.length === 0 ? 0 : spread(`${seed}:${id}`) % refs.length;
  for (let step = 0; step < refs.length; step++) {
    const ref = refs[(start + step) % refs.length];
    if (!taken.has(ref)) return ref;
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

export function assignAvatars(people: readonly AvatarPerson[], settings: AvatarSettings): AvatarSettlement {
  const avatars = new Map<string, AvatarRef>();
  if (settings.mode === "off") return { settings, avatars, changed: false };
  const images = imageRefsOf(settings);
  const pool = new Set<string>(avatarPool(settings));
  const usable = (ref: string | undefined): ref is AvatarRef => ref !== undefined && pool.has(ref);
  const assigned: Record<string, string> = {};
  const groups = groupByRole(people);
  const present = new Set(groups.flatMap((group) => group.people.map((person) => person.id)));
  for (const [id, ref] of Object.entries(settings.assigned)) if (!present.has(id) && usable(ref)) assigned[id] = ref;
  for (const { people: group } of groups) {
    const taken = new Set<string>();
    const unpicked: AvatarPerson[] = [];
    for (const person of group) {
      const pick = settings.picks[person.id];
      if (usable(pick)) {
        avatars.set(person.id, pick);
        taken.add(pick);
      } else unpicked.push(person);
    }
    if (settings.mode !== "auto") continue;
    const unassigned: AvatarPerson[] = [];
    for (const person of unpicked) {
      const kept = settings.assigned[person.id];
      if (usable(kept) && !taken.has(kept)) {
        avatars.set(person.id, kept);
        taken.add(kept);
        assigned[person.id] = kept;
      } else unassigned.push(person);
    }
    for (const person of unassigned) {
      const ref = firstFree(person.id, settings.seed, images, taken) ?? firstFree(person.id, settings.seed, AVATAR_POOL, taken);
      if (ref === undefined) break;
      avatars.set(person.id, ref);
      taken.add(ref);
      assigned[person.id] = ref;
    }
  }
  if (settings.mode !== "auto" || sameEntries(assigned, settings.assigned)) return { settings, avatars, changed: false };
  return { settings: { ...settings, assigned }, avatars, changed: true };
}

function sameEntries(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function sameAvatars(a: ReadonlyMap<string, AvatarRef>, b: ReadonlyMap<string, AvatarRef>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, ref] of a) if (b.get(id) !== ref) return false;
  return true;
}

export function reshuffleAvatars(people: readonly AvatarPerson[], settings: AvatarSettings): AvatarSettings {
  const current = assignAvatars(people, settings).avatars;
  const rebuilt = (seed: number) => assignAvatars(people, { ...settings, seed, assigned: {} });
  for (let step = 1; step <= RESHUFFLE_TRIES; step++) {
    const next = rebuilt(settings.seed + step);
    if (!sameAvatars(next.avatars, current)) return next.settings;
  }
  return rebuilt(settings.seed + 1).settings;
}

export function removeAvatarImage(settings: AvatarSettings, imageId: string): AvatarSettings {
  const ref = imageRef(imageId);
  const without = (entries: Record<string, string>) => Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== ref));
  return { ...settings, picks: without(settings.picks), assigned: without(settings.assigned), images: settings.images.filter((image) => image.id !== imageId) };
}

export function avatarUploadError(upload: AvatarUpload, librarySize: number): string | null {
  if (librarySize >= MAX_AVATAR_IMAGES) return `The library holds at most ${MAX_AVATAR_IMAGES} pictures. Delete one to add another.`;
  if (!(AVATAR_IMAGE_TYPES as readonly string[]).includes(upload.mimeType)) return `That file is ${upload.mimeType || "of an unknown type"}. Use a PNG, JPEG or WebP picture.`;
  if (upload.bytes > MAX_AVATAR_IMAGE_BYTES) return `That picture is ${(upload.bytes / (1024 * 1024)).toFixed(1)} MB. The limit is 5 MB.`;
  if (upload.size === null) return "That picture could not be read. It may be damaged or not really a PNG, JPEG or WebP file.";
  const { width, height } = upload.size;
  if (Math.min(width, height) < MIN_AVATAR_IMAGE_SIDE) return `That picture is ${width} x ${height} px. Both sides need at least ${MIN_AVATAR_IMAGE_SIDE} px.`;
  return null;
}

export function centreSquare(width: number, height: number): CropRect {
  const side = Math.min(width, height);
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), side };
}
