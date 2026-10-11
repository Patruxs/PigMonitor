import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { MAX_AVATAR_IMAGES, type AvatarImage } from "../../shared/piggery/avatar.ts";
import { chooseFiles, clipboardImageFiles } from "../composer/attachments.tsx";
import { FileDropZone, useFileDrop } from "../composer/attachments-drop.tsx";
import type { ImageMetadata } from "../composer/attachment.ts";
import { AVATAR, Avatar } from "../kit/avatar.tsx";
import { Button } from "../kit/button.tsx";
import { ConfirmDialog } from "../kit/confirm.tsx";
import { AVATAR_LG, RADIUS, SPACING, text } from "../kit/theme.ts";
import { namedDropped, namedFile, type BatchProgress, type NamedSource } from "./avatar-batch-run.ts";
import { canEncodeAvatars, encodeAvatar, sourceOfDropped, sourceOfFile, type AvatarSource, type EncodedAvatar } from "./avatar-encode.ts";

export type PictureUse = { names: string[] };

const PREVIEW = 96;

const TILE = 112;

const ACCEPT = "image/png,image/jpeg,image/webp";

const dom = globalThis as { document?: Document };

const FORMAT_NAMES: Record<string, string> = { "image/webp": "WebP", "image/jpeg": "JPEG", "image/png": "PNG" };

export type ReshuffleOutcome = "changed" | "same" | "failed";

const RESHUFFLE_NOTE_MS = 4000;

function kilobytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function encodeFrom(source: Promise<AvatarSource>, librarySize: number): Promise<{ image: EncodedAvatar } | { problem: string }> {
  try {
    const encoded = await encodeAvatar(await source, librarySize);
    return encoded.ok ? { image: encoded.image } : { problem: encoded.error };
  } catch {
    return { problem: "That picture could not be read." };
  }
}

export function usePastedAvatar(): { pasted: EncodedAvatar | null; pastedMany: NamedSource[] | null; problem: string | null; busy: boolean; dismiss: () => void } {
  const [pasted, setPasted] = useState<EncodedAvatar | null>(null);
  const [pastedMany, setPastedMany] = useState<NamedSource[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const page = dom.document;
    if (!canEncodeAvatars || !page) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = clipboardImageFiles(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      setProblem(null);
      if (files.length > 1) {
        setPasted(null);
        setPastedMany(files.map(namedFile));
        return;
      }
      setPastedMany(null);
      setBusy(true);
      void encodeFrom(Promise.resolve(sourceOfFile(files[0])), 0).then((result) => {
        setBusy(false);
        if ("image" in result) setPasted(result.image);
        else setProblem(result.problem);
      });
    };
    page.addEventListener("paste", onPaste);
    return () => page.removeEventListener("paste", onPaste);
  }, []);
  return {
    pasted,
    pastedMany,
    problem,
    busy,
    dismiss: () => {
      setPasted(null);
      setPastedMany(null);
      setProblem(null);
    },
  };
}

function DropSink({ onSource, onBatch }: { onSource: (source: Promise<AvatarSource>) => void; onBatch: (items: NamedSource[]) => void }) {
  useFileDrop({ onFiles: (images: ImageMetadata[]) => (images.length === 1 ? onSource(sourceOfDropped(images[0])) : onBatch(images.map(namedDropped))), onGenericFiles: (files: File[]) => onBatch(files.map(namedFile)) }, { disabled: false });
  return null;
}

function BatchStatus({ theme, roleName, batch, onDismiss }: { theme: PluginTheme; roleName: string; batch: BatchProgress; onDismiss: () => void }) {
  const { added, duplicates, refused, full } = batch.report;
  if (batch.running) return <Text style={text(theme, "meta")}>Adding pictures: {batch.done} of {batch.total}…</Text>;
  return (
    <View style={{ gap: SPACING[1], padding: SPACING[2], borderRadius: RADIUS.md, backgroundColor: theme.colors.surface1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
        <Text style={[text(theme, "meta", "foreground"), { flex: 1 }]}>
          Added {added.length} of {batch.total} {batch.total === 1 ? "picture" : "pictures"}.
        </Text>
        <Button theme={theme} label="Close" onPress={onDismiss} />
      </View>
      {duplicates.length > 0 ? <Text style={text(theme, "label")}>Already in {roleName}, skipped: {duplicates.join(", ")}</Text> : null}
      {full.length > 0 ? (
        <Text style={text(theme, "label", "statusWarning")}>
          {full.length} didn't fit, because a role's library holds at most {MAX_AVATAR_IMAGES} pictures: {full.join(", ")}
        </Text>
      ) : null}
      {refused.length > 0 ? <Text style={text(theme, "label", "statusDanger")}>Not added:</Text> : null}
      {refused.map((refusal, index) => (
        <Text key={index} style={text(theme, "label", "statusDanger")}>
          {refusal.name}: {refusal.reason}
        </Text>
      ))}
      {batch.problem ? <Text style={text(theme, "label", "statusDanger")}>{batch.problem}</Text> : null}
    </View>
  );
}

export function Preview({ theme, image, colour, busy, ready = true, destination, onAdd, onCancel }: { theme: PluginTheme; image: EncodedAvatar; colour: string; busy: boolean; ready?: boolean; destination?: ReactNode; onAdd: () => void; onCancel: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[3], padding: SPACING[3], borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.lg, backgroundColor: theme.colors.surface1, flexWrap: "wrap" }}>
      <Avatar theme={theme} name="Preview" colour={colour} size={PREVIEW} imageUri={image.uri} />
      <Avatar theme={theme} name="Preview" colour={colour} size={AVATAR} imageUri={image.uri} />
      <View style={{ flex: 1, minWidth: 200, gap: SPACING[2] }}>
        <Text style={text(theme, "label")}>
          {[image.name, `${FORMAT_NAMES[image.mimeType] ?? image.mimeType} · ${kilobytes(image.bytes)}`].filter(Boolean).join(" · ")}
        </Text>
        {destination}
        <View style={{ flexDirection: "row", gap: SPACING[2] }}>
          <Button theme={theme} label="Add to library" icon="Check" tone="primary" busy={busy} disabled={!ready} onPress={onAdd} />
          <Button theme={theme} label="Cancel" disabled={busy} onPress={onCancel} />
        </View>
      </View>
    </View>
  );
}

function Tile({ theme, image, index, colour, users, onDelete }: { theme: PluginTheme; image: AvatarImage; index: number; colour: string; users: string[]; onDelete: () => void }) {
  return (
    <View style={{ width: TILE, alignItems: "center", gap: SPACING[1], padding: SPACING[1.5], borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.colors.border }}>
      <Avatar theme={theme} name={`Picture ${index + 1}`} colour={colour} size={AVATAR_LG} imageId={image.id} />
      <Text style={text(theme, "label", users.length > 0 ? "foreground" : "foregroundMuted")} numberOfLines={2}>
        {users.length > 0 ? users.join(", ") : "Unused"}
      </Text>
      <Button theme={theme} label="Delete" icon="Trash2" onPress={onDelete} />
    </View>
  );
}

export function RoleLibrary({
  theme,
  title,
  roleName,
  colour,
  images,
  maxImages,
  people,
  withoutPicture,
  usersOf,
  onAdd,
  onDelete,
  reshuffleHint,
  onReshuffle,
  batch,
  onBatch,
  onDismissBatch,
}: {
  theme: PluginTheme;
  title: string;
  roleName: string;
  colour: string;
  images: readonly AvatarImage[];
  maxImages: number;
  people: number | null;
  withoutPicture: number;
  usersOf: (imageId: string) => string[];
  onAdd: (image: EncodedAvatar) => Promise<string | null>;
  onDelete: (imageId: string) => Promise<boolean>;
  reshuffleHint: string | null;
  onReshuffle: () => Promise<ReshuffleOutcome>;
  batch: BatchProgress | undefined;
  onBatch: (items: NamedSource[]) => void;
  onDismissBatch: () => void;
}) {
  const [pending, setPending] = useState<EncodedAvatar | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<{ image: AvatarImage; index: number } | null>(null);
  const [shuffling, setShuffling] = useState(false);
  const [shuffled, setShuffled] = useState<ReshuffleOutcome | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(noteTimer.current), []);
  const count = images.length;
  const latest = useRef({ count, busy });
  latest.current = { count, busy };
  const prepare = async (source: Promise<AvatarSource>) => {
    if (latest.current.busy) return;
    setBusy(true);
    setProblem(null);
    const result = await encodeFrom(source, latest.current.count);
    setBusy(false);
    if ("image" in result) setPending(result.image);
    else setProblem(result.problem);
  };
  const choose = async () => {
    const files = await chooseFiles(ACCEPT);
    if (files.length === 1) await prepare(Promise.resolve(sourceOfFile(files[0])));
    else onBatch(files.map(namedFile));
  };
  const add = async (image: EncodedAvatar) => {
    setBusy(true);
    const failed = await onAdd(image);
    setBusy(false);
    if (failed) setProblem(failed);
    else setPending(null);
  };
  const destroy = async (imageId: string) => {
    setBusy(true);
    if (await onDelete(imageId)) setDeleting(null);
    setBusy(false);
  };
  const reshuffle = async () => {
    clearTimeout(noteTimer.current);
    setShuffled(null);
    setShuffling(true);
    const outcome = await onReshuffle();
    setShuffling(false);
    setShuffled(outcome);
    noteTimer.current = setTimeout(() => setShuffled(null), RESHUFFLE_NOTE_MS);
  };
  const reshuffleNote = shuffled === "changed" ? { words: `${title} reshuffled`, colour: "statusSuccess" as const } : shuffled === "same" ? { words: "Same result, try again", colour: "foregroundMuted" as const } : shuffled === "failed" ? { words: "Could not reshuffle. Try again.", colour: "statusDanger" as const } : null;
  const showInitials = (n: number) => (n === 1 ? "1 shows their initials" : `${n} show their initials`);
  const shortage = people === null ? null : count === 0 ? (people === 0 ? null : people === 1 ? "No pictures yet, so they show their initials." : `No pictures yet, so all ${people} show their initials.`) : withoutPicture > 0 ? `${count} ${count === 1 ? "picture" : "pictures"} for ${people} people, so ${showInitials(withoutPicture)}.` : null;
  const body = (
    <View style={{ gap: SPACING[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], flexWrap: "wrap" }}>
        <Text style={[text(theme, "rowTitle"), { color: colour, fontWeight: "600" }]}>{title}</Text>
        <Text style={text(theme, "label")}>
          {count} of {maxImages} pictures{people === null ? "" : ` · ${people} ${people === 1 ? "person" : "people"}`}
        </Text>
        <View style={{ flex: 1 }} />
        {reshuffleNote ? <Text style={text(theme, "label", reshuffleNote.colour)}>{reshuffleNote.words}</Text> : null}
        <Button theme={theme} label={shuffling ? "Reshuffling…" : "Reshuffle"} icon="Shuffle" busy={shuffling} disabled={reshuffleHint !== null} onPress={() => void reshuffle()} />
      </View>
      {reshuffleHint ? <Text style={[text(theme, "label"), { alignSelf: "flex-end" }]}>{reshuffleHint}</Text> : null}
      {shortage ? <Text style={text(theme, "label", "statusWarning")}>{shortage}</Text> : null}
      {canEncodeAvatars ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], flexWrap: "wrap" }}>
          <Button theme={theme} label="Add picture" icon="ImagePlus" busy={busy && !pending && !deleting} disabled={count >= maxImages || pending !== null || batch?.running === true} onPress={() => void choose()} />
          <Text style={text(theme, "label")}>one or several, or drop them here</Text>
        </View>
      ) : null}
      {problem ? <Text style={text(theme, "meta", "statusDanger")}>{problem}</Text> : null}
      {batch ? <BatchStatus theme={theme} roleName={roleName} batch={batch} onDismiss={onDismissBatch} /> : null}
      {pending ? <Preview theme={theme} image={pending} colour={colour} busy={busy} onAdd={() => void add(pending)} onCancel={() => setPending(null)} /> : null}
      {count > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACING[2] }}>
          {images.map((image, index) => (
            <Tile key={image.id} theme={theme} image={image} index={index} colour={colour} users={usersOf(image.id)} onDelete={() => (usersOf(image.id).length > 0 ? setDeleting({ image, index }) : void destroy(image.id))} />
          ))}
        </View>
      ) : null}
      <ConfirmDialog theme={theme} title="Delete picture?" icon="Trash2" tone="danger" confirmLabel="Delete" busy={busy} open={deleting !== null} onConfirm={() => deleting && void destroy(deleting.image.id)} onClose={() => setDeleting(null)}>
        <Text style={text(theme, "meta")}>{deleting ? `This picture is in use by ${usersOf(deleting.image.id).join(", ")}. They get another free ${roleName} picture, or their initials if none is left.` : ""}</Text>
      </ConfirmDialog>
    </View>
  );
  const framed = <View style={{ padding: SPACING[3], borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.lg }}>{body}</View>;
  if (!canEncodeAvatars) return framed;
  return (
    <FileDropZone theme={theme}>
      <DropSink onSource={(source) => void prepare(source)} onBatch={onBatch} />
      {framed}
    </FileDropZone>
  );
}
