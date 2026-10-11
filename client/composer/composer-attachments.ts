import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_UPLOAD_BYTES } from "../../shared/attach.ts";
import { toggleForgeAttachment, type ComposerAttachment, type ImageMetadata } from "./composer-logic.ts";
import { MAX_IMAGES, upload, type ForgeItemData } from "../../shared/rpc.ts";
import { canAttach, chooseFiles, clipboardImageFiles, readBase64, readImageFiles, type PendingFile } from "./attachments.tsx";
import { useFileDrop } from "./attachments-drop.tsx";
import { useForgeAutoAttach } from "./attachments-forge.tsx";
import { nodeOf } from "./composer-height.ts";

const GENERIC_FILE_MIME_TYPE = "application/octet-stream";

export function useComposerAttachments({ initial, text: value, cwd, field: input, disabled, isProcessing }: { initial: ComposerAttachment[]; text: string; cwd: string | undefined; field: { current: unknown }; disabled: boolean; isProcessing: boolean }) {
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(initial);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const nextPendingFileId = useRef(0);
  const toast = useToast();
  const callUpload = useRpc(upload);
  const isSubmitLoading = isProcessing || pendingFiles.length > 0;

  const forgeAutoAttach = useForgeAutoAttach({ text: value, cwd, attachments, setAttachments });

  const addImages = useCallback((images: ImageMetadata[]) => {
    if (images.length === 0) return;
    setAttachments((prev) => {
      const room = MAX_IMAGES - prev.filter((a) => a.kind === "image").length;
      return [...prev, ...images.slice(0, Math.max(0, room)).map((metadata) => ({ kind: "image" as const, metadata }))];
    });
  }, []);

  const uploadSelectedFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const placeholders = files.map((file) => ({ id: nextPendingFileId.current++, fileName: file.name }));
      setPendingFiles((pending) => [...pending, ...placeholders]);
      try {
        const prepared: { fileName: string; mimeType: string; data: string }[] = [];
        for (const file of files) {
          if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)`);
          prepared.push({ fileName: file.name, mimeType: file.type || GENERIC_FILE_MIME_TYPE, data: await readBase64(file) });
        }
        const uploaded: ComposerAttachment[] = [];
        for (const file of prepared) {
          const r = await callUpload(file);
          if (!r.ok) throw new Error(r.error || "Upload failed.");
          uploaded.push({ kind: "file", attachment: r.file });
        }
        setAttachments((prev) => [...prev, ...uploaded]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to upload file");
      } finally {
        setPendingFiles((pending) => pending.filter((entry) => !placeholders.includes(entry)));
      }
    },
    [callUpload, toast],
  );

  useFileDrop({ onFiles: addImages, onGenericFiles: (files) => void uploadSelectedFiles(files) }, { disabled: isSubmitLoading });

  useEffect(() => {
    const node = nodeOf(input);
    if (!canAttach || !node) return;
    let disposed = false;
    const onPaste = (event: Event) => {
      if (disabled) return;
      const files = clipboardImageFiles((event as ClipboardEvent).clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      void readImageFiles(files).then((images) => !disposed && addImages(images));
    };
    node.addEventListener("paste", onPaste);
    return () => {
      disposed = true;
      node.removeEventListener("paste", onPaste);
    };
  }, [disabled, addImages]);

  const pickImage = async () => addImages(await readImageFiles(await chooseFiles("image/*")));
  const pickFile = async () => uploadSelectedFiles(await chooseFiles(null));
  const toggleForgeItem = (item: ForgeItemData) =>
    setAttachments((prev) => {
      const existing = prev.find((a) => (a.kind === "forge_issue" || a.kind === "forge_change_request") && a.item.kind === item.kind && a.item.number === item.number);
      if (existing) forgeAutoAttach.markForgeAttachmentRemoved(existing);
      return toggleForgeAttachment(prev, item);
    });
  const removeAttachment = (index: number) => {
    forgeAutoAttach.markForgeAttachmentRemoved(attachments[index]);
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  return { attachments, setAttachments, pendingFiles, pickImage, pickFile, toggleForgeItem, removeAttachment };
}
