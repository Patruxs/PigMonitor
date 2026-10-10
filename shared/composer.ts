import { forgeAttachment } from "./attach.ts";
import type { AttachmentData, ForgeItemData, ImageData, UploadedFileData } from "./rpc.ts";

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

export type SubmitResult = "noop" | "queued" | "submitted" | "failed";

export interface SubmitInput<T> {
  message: string;
  attachments: T[];
  forceSend?: boolean;
  isAgentRunning: boolean;
  canSubmit: boolean;
  queueMessage: (input: { message: string; attachments: T[] }) => void;
  submitMessage: (input: { message: string; attachments: T[] }) => Promise<void>;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  setUserInput: (text: string) => void;
  setAttachments: (attachments: T[]) => void;
  setSendError: (message: string | null) => void;
  setIsProcessing: (isProcessing: boolean) => void;
}

export const FAILED_TO_SEND = "Failed to send message";

export async function submitAgentInput<T>(input: SubmitInput<T>): Promise<SubmitResult> {
  const trimmedMessage = input.message.trim();
  const attachments = input.attachments;
  if (!trimmedMessage && attachments.length === 0) return "noop";
  if (!input.canSubmit) return "noop";
  if (input.isAgentRunning && !input.forceSend) {
    input.queueMessage({ message: trimmedMessage, attachments });
    input.setUserInput("");
    input.setAttachments([]);
    return "queued";
  }
  input.setUserInput("");
  input.setAttachments([]);
  input.setSendError(null);
  input.setIsProcessing(true);
  try {
    await input.submitMessage({ message: trimmedMessage, attachments });
    input.clearDraft("sent");
    input.setIsProcessing(false);
    return "submitted";
  } catch (error) {
    input.setUserInput(trimmedMessage);
    input.setAttachments(attachments);
    input.setSendError(error instanceof Error ? error.message : FAILED_TO_SEND);
    input.setIsProcessing(false);
    return "failed";
  }
}

export interface QueuedComposerMessage {
  id: string;
  text: string;
  attachments: ComposerAttachment[];
}

export interface QueueWriter {
  read: (agentId: string) => QueuedComposerMessage[];
  write: (updater: (prev: Map<string, QueuedComposerMessage[]>) => Map<string, QueuedComposerMessage[]>) => void;
}

function withQueue(agentId: string, update: (queue: QueuedComposerMessage[]) => QueuedComposerMessage[]) {
  return (prev: Map<string, QueuedComposerMessage[]>) => {
    const next = new Map(prev);
    next.set(agentId, update(prev.get(agentId) ?? []));
    return next;
  };
}

export function queueComposerMessage(input: { agentId: string; id: string; text: string; attachments: ComposerAttachment[]; queue: QueueWriter }): QueuedComposerMessage | null {
  const trimmed = input.text.trim();
  if (!trimmed && input.attachments.length === 0) return null;
  const item: QueuedComposerMessage = { id: input.id, text: trimmed, attachments: input.attachments };
  input.queue.write(withQueue(input.agentId, (queue) => [...queue, item]));
  return item;
}

export function editQueuedComposerMessage(input: { agentId: string; messageId: string; queue: QueueWriter }): { text: string; attachments: ComposerAttachment[] } | null {
  const item = input.queue.read(input.agentId).find((q) => q.id === input.messageId);
  if (!item) return null;
  input.queue.write(withQueue(input.agentId, (queue) => queue.filter((q) => q.id !== input.messageId)));
  return { text: item.text, attachments: item.attachments };
}

export type SendQueuedNowResult = { status: "missing" } | { status: "submitted" } | { status: "failed"; errorMessage: string };

export async function sendQueuedComposerMessageNow(input: { agentId: string; messageId: string; queue: QueueWriter; submitMessage: (input: { text: string; attachments: ComposerAttachment[] }) => Promise<void> }): Promise<SendQueuedNowResult> {
  const item = input.queue.read(input.agentId).find((q) => q.id === input.messageId);
  if (!item) return { status: "missing" };
  input.queue.write(withQueue(input.agentId, (queue) => queue.filter((q) => q.id !== input.messageId)));
  try {
    await input.submitMessage({ text: item.text, attachments: item.attachments });
    return { status: "submitted" };
  } catch (error) {
    input.queue.write(withQueue(input.agentId, (queue) => [item, ...queue]));
    return { status: "failed", errorMessage: error instanceof Error ? error.message : FAILED_TO_SEND };
  }
}

export type PrimaryActionKind = "send" | "active" | "none";

export function resolvePrimaryActionKind(input: { hasSendableContent: boolean; isAgentRunning: boolean; isSubmitLoading: boolean }): PrimaryActionKind {
  if (input.hasSendableContent) return "send";
  if (input.isAgentRunning) return "active";
  if (input.isSubmitLoading) return "send";
  return "none";
}

export const MIN_INPUT_HEIGHT = 46;
const DEFAULT_MAX_INPUT_HEIGHT = 160;
const MAX_INPUT_VIEWPORT_RATIO = 0.5;

export function resolveMaxInputHeight(windowHeight: number): number {
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return DEFAULT_MAX_INPUT_HEIGHT;
  return Math.max(DEFAULT_MAX_INPUT_HEIGHT, Math.floor(windowHeight * MAX_INPUT_VIEWPORT_RATIO));
}

const RASTER_IMAGE_MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};
const RASTER_IMAGE_MIME_TYPES = new Set(Object.values(RASTER_IMAGE_MIME_TYPE_BY_EXTENSION));

function fileExtension(path: string): string {
  const normalizedPath = path.split("#", 1)[0]?.split("?", 1)[0] ?? path;
  const extensionIndex = normalizedPath.lastIndexOf(".");
  return extensionIndex < 0 ? "" : normalizedPath.slice(extensionIndex).toLowerCase();
}

export function rasterImageMimeType(input: { mimeType?: string | null; fileName?: string | null }): string | null {
  const normalizedMimeType = input.mimeType?.trim().toLowerCase();
  if (normalizedMimeType) return RASTER_IMAGE_MIME_TYPES.has(normalizedMimeType) ? normalizedMimeType : null;
  return input.fileName ? (RASTER_IMAGE_MIME_TYPE_BY_EXTENSION[fileExtension(input.fileName)] ?? null) : null;
}

export function fileTypeLabel(fileName: string): string | null {
  const extension = fileExtension(fileName);
  return extension.length > 1 ? extension.slice(1).toUpperCase() : null;
}
