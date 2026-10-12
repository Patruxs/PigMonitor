import { useRef, useState } from "react";
import { MAX_AVATAR_IMAGES, type AvatarSettings, type AvatarGroupKey } from "../../shared/piggery/avatar.ts";
import { useAvatarUpload } from "../kit/avatar-pictures.ts";
import { applyBatch, EMPTY_REPORT, type BatchEntry, type BatchReport } from "./avatar-batch.ts";
import type { ImageMetadata } from "../composer/attachment.ts";
import { encodeAvatar, sourceOfDropped, sourceOfFile, type AvatarSource } from "./avatar-encode.ts";

export type NamedSource = { name: string; source: () => Promise<AvatarSource> };

export type BatchProgress = { total: number; done: number; running: boolean; report: BatchReport; problem: string | null };

type Commit = (change: (current: AvatarSettings) => AvatarSettings | null) => Promise<AvatarSettings | null | false>;

type Queue = { pending: NamedSource[]; running: boolean; progress: BatchProgress };

function merged(a: BatchReport, b: BatchReport): BatchReport {
  return { added: [...a.added, ...b.added], duplicates: [...a.duplicates, ...b.duplicates], refused: [...a.refused, ...b.refused], full: [...a.full, ...b.full] };
}

export function useAvatarBatches(commit: Commit, settings: AvatarSettings): { progress: Partial<Record<AvatarGroupKey, BatchProgress>>; run: (role: AvatarGroupKey, items: NamedSource[]) => void; dismiss: (role: AvatarGroupKey) => void } {
  const upload = useAvatarUpload();
  const [progress, setProgress] = useState<Partial<Record<AvatarGroupKey, BatchProgress>>>({});
  const queues = useRef(new Map<AvatarGroupKey, Queue>());
  const latest = useRef({ commit, settings });
  latest.current = { commit, settings };
  const publish = (role: AvatarGroupKey, queue: Queue) => setProgress((shown) => ({ ...shown, [role]: { ...queue.progress } }));
  const entryOf = async (item: NamedSource, room: number, seen: Set<string>): Promise<BatchEntry> => {
    if (room <= 0) return { name: item.name, full: true };
    try {
      const encoded = await encodeAvatar(await item.source(), 0);
      if (!encoded.ok) return { name: item.name, error: encoded.error };
      const stored = await upload(encoded.image.data, encoded.image.mimeType);
      if (!stored.ok) return { name: item.name, error: stored.error };
      seen.add(stored.id);
      return { name: item.name, id: stored.id };
    } catch {
      return { name: item.name, error: "That picture could not be read." };
    }
  };
  const work = async (role: AvatarGroupKey, queue: Queue) => {
    queue.running = true;
    while (queue.pending.length > 0) {
      const seen = new Set(latest.current.settings.libraries[role].images.map((image) => image.id));
      const entries: BatchEntry[] = [];
      while (queue.pending.length > 0) {
        const item = queue.pending.shift()!;
        entries.push(await entryOf(item, MAX_AVATAR_IMAGES - seen.size, seen));
        queue.progress.done += 1;
        publish(role, queue);
      }
      const outcome: { report: BatchReport } = { report: EMPTY_REPORT };
      const saved = await latest.current.commit((current) => {
        const result = applyBatch(current, role, entries);
        outcome.report = result;
        return result.added.length > 0 ? result.settings : null;
      });
      if (saved === false) queue.progress.problem = "Could not save the library. The pictures were uploaded; add them again to retry.";
      else queue.progress.report = merged(queue.progress.report, { added: outcome.report.added, duplicates: outcome.report.duplicates, refused: outcome.report.refused, full: outcome.report.full });
    }
    queue.running = false;
    queue.progress.running = false;
    publish(role, queue);
  };
  return {
    progress,
    run: (role, items) => {
      if (items.length === 0) return;
      const known = queues.current.get(role);
      const queue: Queue = known?.running ? known : { pending: [], running: false, progress: { total: 0, done: 0, running: true, report: EMPTY_REPORT, problem: null } };
      queues.current.set(role, queue);
      queue.pending.push(...items);
      queue.progress.total += items.length;
      queue.progress.running = true;
      publish(role, queue);
      if (!queue.running) void work(role, queue);
    },
    dismiss: (role) => {
      if (queues.current.get(role)?.running) return;
      queues.current.delete(role);
      setProgress(({ [role]: _gone, ...rest }) => rest);
    },
  };
}

export function namedFile(file: File): NamedSource {
  return { name: file.name || "Pasted picture", source: async () => sourceOfFile(file) };
}

export function namedDropped(image: ImageMetadata): NamedSource {
  return { name: image.fileName ?? "Dropped picture", source: () => sourceOfDropped(image) };
}
