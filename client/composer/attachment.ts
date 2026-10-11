import { forgeAttachment } from "../../shared/chat/attach.ts";
import type { AttachmentData, ForgeItemData, ImageData, UploadedFileData } from "../../shared/rpc.ts";

export interface ImageMetadata {
  id: string;
  mimeType: string;
  dataUrl: string;
  fileName: string | null;
  byteSize: number | null;
  createdAt: number;
}

export type ComposerAttachment =
  | { kind: "image"; metadata: ImageMetadata }
  | { kind: "file"; attachment: UploadedFileData }
  | { kind: "forge_issue"; item: ForgeItemData }
  | { kind: "forge_change_request"; item: ForgeItemData };

export type ForgeComposerAttachment = Extract<ComposerAttachment, { kind: "forge_issue" | "forge_change_request" }>;

export function isForgeAttachment(attachment: ComposerAttachment | undefined): attachment is ForgeComposerAttachment {
  return attachment?.kind === "forge_issue" || attachment?.kind === "forge_change_request";
}

export function buildForgeAttachment(item: ForgeItemData): ComposerAttachment {
  return item.kind === "change_request" ? { kind: "forge_change_request", item } : { kind: "forge_issue", item };
}

function sameForgeItem(attachment: ComposerAttachment, item: ForgeItemData): boolean {
  return isForgeAttachment(attachment) && attachment.item.kind === item.kind && attachment.item.number === item.number;
}

export function isAttachmentSelectedForForgeItem(current: readonly ComposerAttachment[], item: ForgeItemData): boolean {
  return current.some((attachment) => sameForgeItem(attachment, item));
}

export function toggleForgeAttachment(current: ComposerAttachment[], item: ForgeItemData): ComposerAttachment[] {
  if (current.some((attachment) => sameForgeItem(attachment, item))) return current.filter((attachment) => !sameForgeItem(attachment, item));
  return [...current, buildForgeAttachment(item)];
}

export function forgeAttachmentKey(attachment: ComposerAttachment | undefined): string | null {
  return isForgeAttachment(attachment) ? `${attachment.item.kind}:${attachment.item.number}` : null;
}

export function imageDataOf(metadata: ImageMetadata): ImageData {
  return { data: metadata.dataUrl.slice(metadata.dataUrl.indexOf(",") + 1), mimeType: metadata.mimeType };
}

export function splitAttachmentsForSubmit(attachments: readonly ComposerAttachment[]): { images: ImageData[]; attachments: AttachmentData[] } {
  const images: ImageData[] = [];
  const agentAttachments: AttachmentData[] = [];
  for (const attachment of attachments) {
    if (attachment.kind === "image") images.push(imageDataOf(attachment.metadata));
    else if (attachment.kind === "file") agentAttachments.push(attachment.attachment);
    else agentAttachments.push(forgeAttachment(attachment.item));
  }
  return { images, attachments: agentAttachments };
}
