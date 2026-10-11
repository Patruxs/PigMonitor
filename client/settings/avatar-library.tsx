import type { PluginTheme } from "@getpaseo/plugin";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { MAX_AVATAR_IMAGES, removeAvatarImage, type AvatarImage, type AvatarSettings } from "../../shared/piggery/avatar.ts";
import { chooseFiles, clipboardImageFiles } from "../composer/attachments.tsx";
import { FileDropZone, useFileDrop } from "../composer/attachments-drop.tsx";
import type { ImageMetadata } from "../composer/attachment.ts";
import { AVATAR, Avatar } from "../kit/avatar.tsx";
import { useAvatarDelete, useAvatarUpload } from "../kit/avatar-pictures.ts";
import { Button } from "../kit/button.tsx";
import { ConfirmDialog } from "../kit/confirm.tsx";
import { AVATAR_LG, RADIUS, SPACING, text } from "../kit/theme.ts";
import { canEncodeAvatars, encodeAvatar, sourceOfDropped, sourceOfFile, type AvatarSource, type EncodedAvatar } from "./avatar-encode.ts";

export type AvatarChange = (current: AvatarSettings) => AvatarSettings | null;

export type AvatarCommit = (change: AvatarChange) => Promise<boolean | null>;

const PREVIEW = 96;

const TILE = 112;

const ACCEPT = "image/png,image/jpeg,image/webp";

const HINT = "Square 1:1. Keep the subject centred with about 15% margin on each side, because the circle cuts the corners. At least 128 px, 512 px or larger recommended. PNG, JPEG or WebP up to 5 MB.";

const dom = globalThis as { document?: Document };

const FORMAT_NAMES: Record<string, string> = { "image/webp": "WebP", "image/jpeg": "JPEG", "image/png": "PNG" };

export function pictureName(image: AvatarImage, index: number): string {
  return image.label?.trim() || `Picture ${index + 1}`;
}

function kilobytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function DropSink({ onSource }: { onSource: (source: Promise<AvatarSource>) => void }) {
  useFileDrop({ onFiles: (images: ImageMetadata[]) => images[0] && onSource(sourceOfDropped(images[0])), onGenericFiles: (files: File[]) => files[0] && onSource(Promise.resolve(sourceOfFile(files[0]))) }, { disabled: false });
  return null;
}

function Preview({ theme, image, busy, onAdd, onCancel }: { theme: PluginTheme; image: EncodedAvatar; busy: boolean; onAdd: (label: string) => void; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[3], padding: SPACING[3], borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.lg, backgroundColor: theme.colors.surface1, flexWrap: "wrap" }}>
      <Avatar theme={theme} name={label || "Preview"} colour={theme.colors.accent} size={PREVIEW} imageUri={image.uri} />
      <Avatar theme={theme} name={label || "Preview"} colour={theme.colors.accent} size={AVATAR} imageUri={image.uri} />
      <View style={{ flex: 1, minWidth: 200, gap: SPACING[2] }}>
        <Text style={text(theme, "label")}>
          {[image.name, `${FORMAT_NAMES[image.mimeType] ?? image.mimeType} · ${kilobytes(image.bytes)}`].filter(Boolean).join(" · ")}
        </Text>
        <TextInput
          value={label}
          onChangeText={setLabel}
          accessibilityLabel="Picture label"
          placeholder="Label (optional)"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[text(theme, "rowTitle"), { borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING[2], paddingVertical: SPACING[1.5] }]}
        />
        <View style={{ flexDirection: "row", gap: SPACING[2] }}>
          <Button theme={theme} label="Add to library" icon="Check" tone="primary" busy={busy} onPress={() => onAdd(label.trim())} />
          <Button theme={theme} label="Cancel" disabled={busy} onPress={onCancel} />
        </View>
      </View>
    </View>
  );
}

function Tile({ theme, image, index, users, onRename, onDelete }: { theme: PluginTheme; image: AvatarImage; index: number; users: string[]; onRename: (label: string) => void; onDelete: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commitLabel = () => {
    if (draft !== null && draft.trim() !== (image.label ?? "")) onRename(draft.trim());
    setDraft(null);
  };
  return (
    <View style={{ width: TILE, alignItems: "center", gap: SPACING[1], padding: SPACING[1.5], borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.colors.border }}>
      <Avatar theme={theme} name={pictureName(image, index)} colour={theme.colors.foregroundMuted} size={AVATAR_LG} imageId={image.id} />
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

export function AvatarLibrary({ theme, values, usersOf, commit }: { theme: PluginTheme; values: AvatarSettings; usersOf: (imageId: string) => string[]; commit: AvatarCommit }) {
  const toast = useToast();
  const upload = useAvatarUpload();
  const remove = useAvatarDelete();
  const [pending, setPending] = useState<EncodedAvatar | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<{ image: AvatarImage; index: number } | null>(null);
  const count = values.images.length;
  const latest = useRef({ count, busy });
  latest.current = { count, busy };
  const prepare = async (source: Promise<AvatarSource>) => {
    if (latest.current.busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const encoded = await encodeAvatar(await source, latest.current.count);
      if (encoded.ok) setPending(encoded.image);
      else setProblem(encoded.error);
    } catch {
      setProblem("That picture could not be read.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const page = dom.document;
    if (!canEncodeAvatars || !page) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = clipboardImageFiles(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      void prepare(Promise.resolve(sourceOfFile(files[0])));
    };
    page.addEventListener("paste", onPaste);
    return () => page.removeEventListener("paste", onPaste);
  }, []);
  const choose = async () => {
    const files = await chooseFiles(ACCEPT);
    if (files[0]) await prepare(Promise.resolve(sourceOfFile(files[0])));
  };
  const add = async (image: EncodedAvatar, label: string) => {
    setBusy(true);
    try {
      const stored = await upload(image.data, image.mimeType);
      if (!stored.ok) return setProblem(stored.error);
      const result: { outcome: "added" | "present" | "full" } = { outcome: "added" };
      const saved = await commit((current) => {
        if (current.images.some((entry) => entry.id === stored.id)) {
          result.outcome = "present";
          return null;
        }
        if (current.images.length >= MAX_AVATAR_IMAGES) {
          result.outcome = "full";
          return null;
        }
        result.outcome = "added";
        return { ...current, images: [...current.images, label ? { id: stored.id, label } : { id: stored.id }] };
      });
      if (saved === false) return setProblem("Could not save the library. Try again.");
      setPending(null);
      if (result.outcome === "full") setProblem(`The library holds at most ${MAX_AVATAR_IMAGES} pictures. Delete one to add another.`);
      else toast.show(result.outcome === "present" ? "That picture is already in the library" : "Picture added");
    } finally {
      setBusy(false);
    }
  };
  const rename = (imageId: string, label: string) =>
    void commit((current) => ({ ...current, images: current.images.map((entry) => (entry.id !== imageId ? entry : label ? { ...entry, label } : { id: entry.id })) })).then((saved) => saved === false && toast.error("Could not save the label."));
  const destroy = async (imageId: string) => {
    setBusy(true);
    try {
      const saved = await commit((current) => (current.images.some((entry) => entry.id === imageId) ? removeAvatarImage(current, imageId) : null));
      if (saved === false) return toast.error("Could not delete the picture. Try again.");
      setDeleting(null);
      const gone = await remove(imageId);
      toast.show(gone.ok ? "Picture deleted" : "Picture removed from the library; its file stays until the next clean-up");
    } finally {
      setBusy(false);
    }
  };
  const body = (
    <View style={{ gap: SPACING[2] }}>
      <Text style={text(theme, "label")}>
        Pictures · {count} of {MAX_AVATAR_IMAGES}
      </Text>
      <Text style={text(theme, "meta")}>{HINT}</Text>
      {canEncodeAvatars ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], flexWrap: "wrap" }}>
          <Button theme={theme} label="Add picture" icon="ImagePlus" busy={busy && !pending} disabled={count >= MAX_AVATAR_IMAGES || pending !== null} onPress={() => void choose()} />
          <Text style={text(theme, "label")}>or paste or drop one here</Text>
        </View>
      ) : (
        <Text style={text(theme, "meta")}>Upload pictures from Paseo desktop or web. Pictures already in the library show here too.</Text>
      )}
      {problem ? <Text style={text(theme, "meta", "statusDanger")}>{problem}</Text> : null}
      {pending ? <Preview theme={theme} image={pending} busy={busy} onAdd={(label) => void add(pending, label)} onCancel={() => setPending(null)} /> : null}
      {count > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACING[2] }}>
          {values.images.map((image, index) => (
            <Tile
              key={image.id}
              theme={theme}
              image={image}
              index={index}
              users={usersOf(image.id)}
              onRename={(label) => rename(image.id, label)}
              onDelete={() => (usersOf(image.id).length > 0 ? setDeleting({ image, index }) : void destroy(image.id))}
            />
          ))}
        </View>
      ) : null}
      <ConfirmDialog theme={theme} title="Delete picture?" icon="Trash2" tone="danger" confirmLabel="Delete" busy={busy} open={deleting !== null} onConfirm={() => deleting && void destroy(deleting.image.id)} onClose={() => setDeleting(null)}>
        <Text style={text(theme, "meta")}>
          {deleting ? `${pictureName(deleting.image, deleting.index)} is in use by ${usersOf(deleting.image.id).join(", ")}. They go back to an icon or their initials.` : ""}
        </Text>
      </ConfirmDialog>
    </View>
  );
  if (!canEncodeAvatars) return body;
  return (
    <FileDropZone theme={theme}>
      <DropSink onSource={(source) => void prepare(source)} />
      {body}
    </FileDropZone>
  );
}
