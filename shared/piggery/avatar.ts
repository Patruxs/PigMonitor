import { z } from "zod";
import { roleColour } from "./mail.ts";
import type { RoleKey } from "./palette.ts";
import type { View } from "./view.ts";

export const AVATAR_ROLES = ["supervisor", "lead", "peer", "executor", "advisor"] as const satisfies readonly RoleKey[];

export const MAX_AVATAR_IMAGES = 64;

export const AVATAR_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export const MAX_AVATAR_IMAGE_BYTES = 5 * 1024 * 1024;

export const MIN_AVATAR_IMAGE_SIDE = 128;

export const AVATAR_IMAGE_SIDE = 256;

export const AVATAR_SETTINGS_VERSION = 3;

export const AVATAR_MODES = ["auto", "manual"] as const;

export type AvatarMode = (typeof AVATAR_MODES)[number];

export const AvatarImage = z.object({ id: z.string() });

export type AvatarImage = z.output<typeof AvatarImage>;

const RoleLibrary = z.object({ images: z.array(AvatarImage).default([]) });

export type RoleLibrary = z.output<typeof RoleLibrary>;

const EMPTY_LIBRARY: RoleLibrary = { images: [] };

function emptyLibraries(): Record<RoleKey, RoleLibrary> {
  return { supervisor: EMPTY_LIBRARY, lead: EMPTY_LIBRARY, peer: EMPTY_LIBRARY, executor: EMPTY_LIBRARY, advisor: EMPTY_LIBRARY };
}

export const AvatarSettings = z.object({
  mode: z.enum(AVATAR_MODES).default("auto"),
  libraries: z.object(Object.fromEntries(AVATAR_ROLES.map((role) => [role, RoleLibrary.default(EMPTY_LIBRARY)])) as Record<RoleKey, z.ZodDefault<typeof RoleLibrary>>).default(emptyLibraries),
  assigned: z.record(z.string(), z.string()).default({}),
});

export type AvatarSettings = z.output<typeof AvatarSettings>;

export const DEFAULT_AVATAR_SETTINGS: AvatarSettings = { mode: "auto", libraries: emptyLibraries(), assigned: {} };

export type AvatarPerson = { id: string; role: string | undefined; joinedAt?: number; name?: string; team?: string; teamId?: string; live?: boolean };

export type AvatarGroup = { role: RoleKey; people: AvatarPerson[] };

export type AvatarSettlement = { settings: AvatarSettings; avatars: ReadonlyMap<string, string>; changed: boolean; needsPick: ReadonlySet<string> };

export type AvatarChange = { ok: true; settings: AvatarSettings } | { ok: false; error: string };

export type AvatarUpload = { mimeType: string; bytes: number; size: { width: number; height: number } | null };

export type CropRect = { x: number; y: number; side: number };

const ROLE_RANK: Record<RoleKey, number> = { supervisor: 0, lead: 1, peer: 2, executor: 3, advisor: 4 };

export function avatarPeopleOf(view: View): AvatarPerson[] {
  const teamNames = new Map<string, string>();
  const closedTeams = new Set<string>();
  for (const list of [view.all, view.closed])
    for (const dir of list.dirs)
      for (const block of dir.blocks) {
        if (block.head) teamNames.set(block.head.id, block.head.name);
        for (const row of block.rows) {
          if (row.kind !== "team" || row.team === undefined) continue;
          teamNames.set(row.team, row.name);
          if (list === view.closed || row.closed) closedTeams.add(row.team);
        }
      }
  const people: AvatarPerson[] = [];
  for (const list of [view.all, view.closed])
    for (const dir of list.dirs)
      for (const block of dir.blocks)
        for (const row of block.rows) {
          if (row.kind !== "member") continue;
          const live = list === view.all && row.status !== "gone" && !(row.team !== undefined && closedTeams.has(row.team));
          people.push({ id: row.id, role: row.role, joinedAt: row.created_at, name: row.name, team: row.team === undefined ? block.head?.name : teamNames.get(row.team), teamId: row.team, live });
        }
  return people;
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

function firstFree(id: string, imageIds: readonly string[], taken: ReadonlySet<string>): string | undefined {
  const start = imageIds.length === 0 ? 0 : spread(id) % imageIds.length;
  for (let step = 0; step < imageIds.length; step++) {
    const imageId = imageIds[(start + step) % imageIds.length];
    if (!taken.has(imageId)) return imageId;
  }
  return undefined;
}

function imageIdsOf(library: RoleLibrary): string[] {
  return [...new Set(library.images.map((image) => image.id))];
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

export function imageInUse(settings: AvatarSettings, imageId: string): boolean {
  return AVATAR_ROLES.some((role) => settings.libraries[role].images.some((image) => image.id === imageId));
}

export function assignAvatars(people: readonly AvatarPerson[], settings: AvatarSettings): AvatarSettlement {
  const groups = groupByRole(people);
  return settings.mode === "manual" ? showPicks(groups, settings) : settleAuto(groups, settings);
}

function showPicks(groups: readonly AvatarGroup[], settings: AvatarSettings): AvatarSettlement {
  const avatars = new Map<string, string>();
  const needsPick = new Set<string>();
  for (const { role, people: group } of groups) {
    const imageIds = imageIdsOf(settings.libraries[role]);
    for (const person of group) {
      const picked = settings.assigned[person.id];
      if (imageIds.length === 1) avatars.set(person.id, imageIds[0]);
      else if (picked !== undefined && imageIds.includes(picked)) avatars.set(person.id, picked);
      else if (imageIds.length > 1) needsPick.add(person.id);
    }
  }
  return { settings, avatars, changed: false, needsPick };
}

function teamsOf(group: readonly AvatarPerson[]): AvatarPerson[][] {
  const teams = new Map<string, AvatarPerson[]>();
  for (const person of group) {
    const key = person.teamId ?? "";
    const team = teams.get(key);
    if (team) team.push(person);
    else teams.set(key, [person]);
  }
  return [...teams.values()];
}

function settleAuto(groups: readonly AvatarGroup[], settings: AvatarSettings): AvatarSettlement {
  const avatars = new Map<string, string>();
  const live = new Set(groups.flatMap((group) => group.people.filter((person) => person.live ?? true).map((person) => person.id)));
  const assigned: Record<string, string> = {};
  for (const [id, imageId] of Object.entries(settings.assigned)) if (!live.has(id) && imageInUse(settings, imageId)) assigned[id] = imageId;
  const give = (person: AvatarPerson, imageId: string, taken: Set<string>) => {
    avatars.set(person.id, imageId);
    taken.add(imageId);
    if (live.has(person.id)) assigned[person.id] = imageId;
  };
  for (const { role, people: group } of groups) {
    const imageIds = imageIdsOf(settings.libraries[role]);
    for (const team of teamsOf(group)) {
      const taken = new Set<string>();
      for (const claimingLive of [true, false]) {
        const duplicates: [AvatarPerson, string][] = [];
        const unassigned: AvatarPerson[] = [];
        for (const person of team) {
          if (live.has(person.id) !== claimingLive) continue;
          const kept = settings.assigned[person.id];
          if (kept === undefined || !imageIds.includes(kept)) unassigned.push(person);
          else if (taken.has(kept)) duplicates.push([person, kept]);
          else give(person, kept, taken);
        }
        for (const [person, kept] of duplicates) {
          const imageId = firstFree(person.id, imageIds, taken) ?? (claimingLive ? kept : undefined);
          if (imageId !== undefined) give(person, imageId, taken);
        }
        for (const person of unassigned) {
          const imageId = firstFree(person.id, imageIds, taken);
          if (imageId === undefined) break;
          give(person, imageId, taken);
        }
      }
    }
  }
  const needsPick: ReadonlySet<string> = new Set();
  if (sameEntries(assigned, settings.assigned)) return { settings, avatars, changed: false, needsPick };
  return { settings: { ...settings, assigned }, avatars, changed: true, needsPick };
}

export function pickAvatar(settings: AvatarSettings, personId: string, imageId: string | null): AvatarSettings {
  const { [personId]: _previous, ...others } = settings.assigned;
  return { ...settings, assigned: imageId === null ? others : { ...others, [personId]: imageId } };
}

function sameEntries(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function withLibrary(settings: AvatarSettings, role: RoleKey, library: RoleLibrary): AvatarSettings {
  return { ...settings, libraries: { ...settings.libraries, [role]: library } };
}

export function addAvatarImage(settings: AvatarSettings, role: RoleKey, image: AvatarImage): AvatarChange {
  const library = settings.libraries[role];
  if (library.images.some((entry) => entry.id === image.id)) return { ok: false, error: "That picture is already in this role's library." };
  if (library.images.length >= MAX_AVATAR_IMAGES) return { ok: false, error: `A role's library holds at most ${MAX_AVATAR_IMAGES} pictures. Delete one to add another.` };
  return { ok: true, settings: withLibrary(settings, role, { ...library, images: [...library.images, image] }) };
}

export function removeAvatarImage(settings: AvatarSettings, role: RoleKey, imageId: string): AvatarSettings {
  const library = settings.libraries[role];
  const next = withLibrary(settings, role, { ...library, images: library.images.filter((image) => image.id !== imageId) });
  if (imageInUse(next, imageId)) return next;
  return { ...next, assigned: Object.fromEntries(Object.entries(next.assigned).filter(([, assignedId]) => assignedId !== imageId)) };
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function fromVersion1(values: unknown): Record<string, unknown> {
  const old = recordOf(values);
  const images = (Array.isArray(old.images) ? old.images : []).flatMap((entry) => {
    const parsed = AvatarImage.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  const kept = new Set(images.map((image) => image.id));
  const assigned: Record<string, string> = {};
  for (const [id, ref] of Object.entries(recordOf(old.assigned))) {
    const imageId = typeof ref === "string" && ref.startsWith("image:") ? ref.slice("image:".length) : null;
    if (imageId !== null && kept.has(imageId)) assigned[id] = imageId;
  }
  return { mode: old.mode === undefined ? undefined : old.mode === "auto" || old.mode === "manual" ? "on" : "off", libraries: Object.fromEntries(AVATAR_ROLES.map((role) => [role, { images }])), assigned };
}

function fromVersion2(values: unknown): Record<string, unknown> {
  const old = recordOf(values);
  return { ...old, mode: old.mode === undefined ? undefined : old.mode === "on" ? "auto" : "manual" };
}

export function migrateAvatarSettings(values: unknown, fromVersion: number): unknown {
  let migrated = values;
  if (fromVersion < 2) migrated = fromVersion1(migrated);
  if (fromVersion < 3) migrated = fromVersion2(migrated);
  return migrated;
}

export function avatarUploadError(upload: AvatarUpload, librarySize: number): string | null {
  if (librarySize >= MAX_AVATAR_IMAGES) return `A role's library holds at most ${MAX_AVATAR_IMAGES} pictures. Delete one to add another.`;
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
