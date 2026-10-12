import { addAvatarImage, type AvatarSettings, type AvatarGroupKey } from "../../shared/piggery/avatar.ts";

export type BatchEntry = { name: string; id: string } | { name: string; error: string } | { name: string; full: true };

export type BatchRefusal = { name: string; reason: string };

export type BatchReport = { added: string[]; duplicates: string[]; refused: BatchRefusal[]; full: string[] };

export const EMPTY_REPORT: BatchReport = { added: [], duplicates: [], refused: [], full: [] };

export function applyBatch(settings: AvatarSettings, role: AvatarGroupKey, entries: readonly BatchEntry[]): BatchReport & { settings: AvatarSettings } {
  let next = settings;
  const report: BatchReport = { added: [], duplicates: [], refused: [], full: [] };
  for (const entry of entries) {
    if ("error" in entry) report.refused.push({ name: entry.name, reason: entry.error });
    else if ("full" in entry) report.full.push(entry.name);
    else if (next.libraries[role].images.some((image) => image.id === entry.id)) report.duplicates.push(entry.name);
    else {
      const added = addAvatarImage(next, role, { id: entry.id });
      if (added.ok) {
        next = added.settings;
        report.added.push(entry.name);
      } else report.full.push(entry.name);
    }
  }
  return { settings: next, ...report };
}
