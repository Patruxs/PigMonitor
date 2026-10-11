import type { PluginTheme } from "@getpaseo/plugin";
import { ActivityIndicator, View } from "react-native";
import { fileTypeLabel, forgeAttachmentKey, rasterImageMimeType, type ComposerAttachment, type ImageMetadata } from "./composer-input.ts";
import { forgeOf } from "../../shared/attach.ts";
import type { ForgeItemData } from "../../shared/rpc.ts";
import { AttachmentFrame, AttachmentLabel, AttachmentPill, AttachmentThumbnail } from "./attachment-pill.tsx";
import { SPACING } from "../kit/theme.ts";

export interface PendingFile {
  id: number;
  fileName: string;
}

const dom = globalThis as { document?: Document; FileReader?: typeof FileReader };
export const canAttach = dom.document !== undefined && dom.FileReader !== undefined;

let nextImageId = 0;

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!dom.FileReader) return reject(new Error("Files cannot be read here."));
    const reader = new dom.FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

export async function readImageFile(file: Blob & { name?: string }): Promise<ImageMetadata | null> {
  const mimeType = rasterImageMimeType({ mimeType: file.type, fileName: file.name });
  if (!mimeType) return null;
  try {
    const dataUrl = await readDataUrl(file);
    if (dataUrl.indexOf(",") < 0) return null;
    return { id: `img_${Date.now()}_${nextImageId++}`, mimeType, dataUrl, fileName: file.name ?? null, byteSize: file.size, createdAt: Date.now() };
  } catch (error) {
    console.error("[PigMonitor] Failed to read image attachment", error);
    return null;
  }
}

export async function readImageFiles(files: readonly Blob[]): Promise<ImageMetadata[]> {
  const read = await Promise.all(files.map(readImageFile));
  return read.filter((image): image is ImageMetadata => image !== null);
}

export async function readBase64(file: Blob): Promise<string> {
  const dataUrl = await readDataUrl(file);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export function clipboardImageFiles(data: DataTransfer | null | undefined): File[] {
  return Array.from(data?.items ?? []).flatMap((item) => {
    if (item.kind !== "file" || !rasterImageMimeType({ mimeType: item.type })) return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
}

export function chooseFiles(accept: string | null): Promise<File[]> {
  return new Promise((resolve) => {
    const doc = dom.document;
    if (!doc) return resolve([]);
    const input = doc.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    input.multiple = true;
    input.style.display = "none";
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => done([]));
    doc.body.appendChild(input);
    input.click();
  });
}

export function forgeNumberLabel(item: ForgeItemData): string {
  const forge = forgeOf(item.forge ?? "github");
  return `${item.kind === "change_request" ? forge.changeRequestNumberPrefix : "#"}${item.number}`;
}

function attachmentKey(attachment: ComposerAttachment): string {
  if (attachment.kind === "image") return attachment.metadata.id;
  if (attachment.kind === "file") return attachment.attachment.id;
  return forgeAttachmentKey(attachment) ?? "";
}

function ComposerAttachmentPill({ theme, attachment, disabled, onOpen, onRemove }: { theme: PluginTheme; attachment: ComposerAttachment; disabled: boolean; onOpen: () => void; onRemove: () => void }) {
  if (attachment.kind === "image") {
    return (
      <AttachmentPill theme={theme} openLabel="Open image attachment" removeLabel="Remove image attachment" disabled={disabled} onOpen={onOpen} onRemove={onRemove}>
        <AttachmentThumbnail theme={theme} uri={attachment.metadata.dataUrl} />
      </AttachmentPill>
    );
  }
  if (attachment.kind === "file") {
    const fileName = attachment.attachment.fileName;
    return (
      <AttachmentPill theme={theme} openLabel={fileName} removeLabel="Remove file attachment" disabled={disabled} onRemove={onRemove}>
        <AttachmentLabel theme={theme} icon="FileText" title={fileName} subtitle={fileTypeLabel(fileName) ?? "File"} />
      </AttachmentPill>
    );
  }
  const { item } = attachment;
  const isChangeRequest = item.kind === "change_request";
  const forge = forgeOf(item.forge ?? "github");
  const kindLabel = isChangeRequest ? forge.changeRequestAbbrev : "issue";
  const number = forgeNumberLabel(item);
  return (
    <AttachmentPill theme={theme} openLabel={`Open ${kindLabel} ${number}`} removeLabel={`Remove ${kindLabel} ${number}`} disabled={disabled} onOpen={onOpen} onRemove={onRemove}>
      <AttachmentLabel theme={theme} icon={isChangeRequest ? "GitPullRequest" : "CircleDot"} title={item.title} subtitle={`${isChangeRequest ? forge.changeRequestAbbrev : "Issue"} ${number}`} />
    </AttachmentPill>
  );
}

export function AttachmentTray({ theme, attachments, pendingFiles, disabled, onOpen, onRemove }: { theme: PluginTheme; attachments: ComposerAttachment[]; pendingFiles: PendingFile[]; disabled: boolean; onOpen: (attachment: ComposerAttachment) => void; onRemove: (index: number) => void }) {
  if (attachments.length === 0 && pendingFiles.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", gap: SPACING[2], flexWrap: "wrap" }}>
      {attachments.map((attachment, index) => (
        <ComposerAttachmentPill key={attachmentKey(attachment)} theme={theme} attachment={attachment} disabled={disabled} onOpen={() => onOpen(attachment)} onRemove={() => onRemove(index)} />
      ))}
      {pendingFiles.map((file) => (
        <AttachmentFrame key={file.id} theme={theme}>
          <AttachmentLabel theme={theme} icon={<ActivityIndicator size={18} color={theme.colors.foregroundMuted} />} title={file.fileName} subtitle={fileTypeLabel(file.fileName) ?? ""} />
        </AttachmentFrame>
      ))}
    </View>
  );
}
