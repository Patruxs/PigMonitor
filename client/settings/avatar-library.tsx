import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Text, TextInput, View } from "react-native";
import type { AvatarImage, AvatarSettings } from "../../shared/piggery/avatar.ts";
import { chooseFiles, clipboardImageFiles } from "../composer/attachments.tsx";
import { FileDropZone, useFileDrop } from "../composer/attachments-drop.tsx";
import type { ImageMetadata } from "../composer/attachment.ts";
import { AVATAR, Avatar } from "../kit/avatar.tsx";
import { Button } from "../kit/button.tsx";
import { ConfirmDialog } from "../kit/confirm.tsx";
import { AVATAR_LG, RADIUS, SPACING, text } from "../kit/theme.ts";
import { canEncodeAvatars, encodeAvatar, sourceOfDropped, sourceOfFile, type AvatarSource, type EncodedAvatar } from "./avatar-encode.ts";

export type AvatarChange = (current: AvatarSettings) => AvatarSettings | null;

export type AvatarCommit = (change: AvatarChange) => Promise<boolean | null>;

export type PictureUse = { names: string[] };

const PREVIEW = 96;

const TILE = 112;

const ACCEPT = "image/png,image/jpeg,image/webp";

const dom = globalThis as { document?: Document };

const FORMAT_NAMES: Record<string, string> = { "image/webp": "WebP", "image/jpeg": "JPEG", "image/png": "PNG" };

export function pictureName(image: AvatarImage, index: number): string {
  return image.label?.trim() || `Picture ${index + 1}`;
}

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

export function usePastedAvatar(): { pasted: EncodedAvatar | null; problem: string | null; busy: boolean; dismiss: () => void } {
  const [pasted, setPasted] = useState<EncodedAvatar | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const page = dom.document;
    if (!canEncodeAvatars || !page) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = clipboardImageFiles(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      setBusy(true);
      setProblem(null);
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
    problem,
    busy,
    dismiss: () => {
      setPasted(null);
      setProblem(null);
    },
  };
}

function DropSink({ onSource }: { onSource: (source: Promise<AvatarSource>) => void }) {
  useFileDrop({ onFiles: (images: ImageMetadata[]) => images[0] && onSource(sourceOfDropped(images[0])), onGenericFiles: (files: File[]) => files[0] && onSource(Promise.resolve(sourceOfFile(files[0]))) }, { disabled: false });
  return null;
}

export function Preview({ theme, image, colour, busy, ready = true, destination, onAdd, onCancel }: { theme: PluginTheme; image: EncodedAvatar; colour: string; busy: boolean; ready?: boolean; destination?: ReactNode; onAdd: (label: string) => void; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[3], padding: SPACING[3], borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.lg, backgroundColor: theme.colors.surface1, flexWrap: "wrap" }}>
      <Avatar theme={theme} name={label || "Preview"} colour={colour} size={PREVIEW} imageUri={image.uri} />
      <Avatar theme={theme} name={label || "Preview"} colour={colour} size={AVATAR} imageUri={image.uri} />
      <View style={{ flex: 1, minWidth: 200, gap: SPACING[2] }}>
        <Text style={text(theme, "label")}>
          {[image.name, `${FORMAT_NAMES[image.mimeType] ?? image.mimeType} · ${kilobytes(image.bytes)}`].filter(Boolean).join(" · ")}
        </Text>
        {destination}
        <TextInput
          value={label}
          onChangeText={setLabel}
          accessibilityLabel="Picture label"
          placeholder="Label (optional)"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[text(theme, "rowTitle"), { borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING[2], paddingVertical: SPACING[1.5] }]}
        />
        <View style={{ flexDirection: "row", gap: SPACING[2] }}>
          <Button theme={theme} label="Add to library" icon="Check" tone="primary" busy={busy} disabled={!ready} onPress={() => onAdd(label.trim())} />
          <Button theme={theme} label="Cancel" disabled={busy} onPress={onCancel} />
        </View>
      </View>
    </View>
  );
}

function Tile({ theme, image, index, colour, users, onRename, onDelete }: { theme: PluginTheme; image: AvatarImage; index: number; colour: string; users: string[]; onRename: (label: string) => void; onDelete: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commitLabel = () => {
    if (draft !== null && draft.trim() !== (image.label ?? "")) onRename(draft.trim());
    setDraft(null);
  };
  return (
    <View style={{ width: TILE, alignItems: "center", gap: SPACING[1], padding: SPACING[1.5], borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.colors.border }}>
      <Avatar theme={theme} name={pictureName(image, index)} colour={colour} size={AVATAR_LG} imageId={image.id} />
      <TextInput
        value={draft ?? image.label ?? ""}
        onChangeText={setDraft}
        onBlur={commitLabel}
        onSubmitEditing={commitLabel}
        accessibilityLabel={`Label for ${pictureName(image, index)}`}
        placeholder={`Picture ${index + 1}`}
        placeholderTextColor={theme.colors.foregroundMuted}
        style={[text(theme, "label", "foreground"), { width: "100%", textAlign: "center", borderBottomWidth: 1, borderColor: theme.colors.border, paddingVertical: 2 }]}
      />
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
  onRename,
  onDelete,
  onReshuffle,
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
  onAdd: (image: EncodedAvatar, label: string) => Promise<string | null>;
  onRename: (imageId: string, label: string) => void;
  onDelete: (imageId: string) => Promise<boolean>;
  onReshuffle: () => Promise<void>;
}) {
  const [pending, setPending] = useState<EncodedAvatar | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<{ image: AvatarImage; index: number } | null>(null);
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
    if (files[0]) await prepare(Promise.resolve(sourceOfFile(files[0])));
  };
  const add = async (image: EncodedAvatar, label: string) => {
    setBusy(true);
    const failed = await onAdd(image, label);
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
    setBusy(true);
    await onReshuffle();
    setBusy(false);
  };
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
        <Button theme={theme} label="Reshuffle" icon="Shuffle" busy={busy && !pending && !deleting} disabled={count === 0 || !people} onPress={() => void reshuffle()} />
      </View>
      {shortage ? <Text style={text(theme, "label", "statusWarning")}>{shortage}</Text> : null}
      {canEncodeAvatars ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], flexWrap: "wrap" }}>
          <Button theme={theme} label="Add picture" icon="ImagePlus" busy={busy && !pending && !deleting} disabled={count >= maxImages || pending !== null} onPress={() => void choose()} />
          <Text style={text(theme, "label")}>or drop one here</Text>
        </View>
      ) : null}
      {problem ? <Text style={text(theme, "meta", "statusDanger")}>{problem}</Text> : null}
      {pending ? <Preview theme={theme} image={pending} colour={colour} busy={busy} onAdd={(label) => void add(pending, label)} onCancel={() => setPending(null)} /> : null}
      {count > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACING[2] }}>
          {images.map((image, index) => (
            <Tile key={image.id} theme={theme} image={image} index={index} colour={colour} users={usersOf(image.id)} onRename={(label) => onRename(image.id, label)} onDelete={() => (usersOf(image.id).length > 0 ? setDeleting({ image, index }) : void destroy(image.id))} />
          ))}
        </View>
      ) : null}
      <ConfirmDialog theme={theme} title="Delete picture?" icon="Trash2" tone="danger" confirmLabel="Delete" busy={busy} open={deleting !== null} onConfirm={() => deleting && void destroy(deleting.image.id)} onClose={() => setDeleting(null)}>
        <Text style={text(theme, "meta")}>{deleting ? `${pictureName(deleting.image, deleting.index)} is in use by ${usersOf(deleting.image.id).join(", ")}. They get another free ${roleName} picture, or their initials if none is left.` : ""}</Text>
      </ConfirmDialog>
    </View>
  );
  const framed = <View style={{ padding: SPACING[3], borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.lg }}>{body}</View>;
  if (!canEncodeAvatars) return framed;
  return (
    <FileDropZone theme={theme}>
      <DropSink onSource={(source) => void prepare(source)} />
      {framed}
    </FileDropZone>
  );
}
