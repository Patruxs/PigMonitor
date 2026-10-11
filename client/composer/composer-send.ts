import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { AttachmentData, ImageData } from "../../shared/rpc.ts";
import { generateMessageId } from "../../shared/stream/stream.ts";
import type { PaseoApi } from "../chat/agent-live.ts";
import { splitAttachmentsForSubmit, type ComposerAttachment } from "./attachment.ts";
import { clearDraft } from "./drafts.ts";
import { queueComposerMessage } from "./message-queue.ts";
import { drainWhenIdle, queueWriter } from "./queue.tsx";
import { submitAgentInput } from "./submit.ts";

export function useComposerSend({ onSend, draftKey, value, attachments, setAttachments, replaceText, setIsProcessing, isAgentRunning, agentId, queueKey, paseo, composerHeight }: { onSend: (body: string, images: ImageData[], attachments: AttachmentData[]) => Promise<string | null>; draftKey: string | undefined; value: string; attachments: ComposerAttachment[]; setAttachments: Dispatch<SetStateAction<ComposerAttachment[]>>; replaceText: (next: string) => void; setIsProcessing: (isProcessing: boolean) => void; isAgentRunning: boolean; agentId: string | undefined; queueKey: string | undefined; paseo: PaseoApi; composerHeight: { reset: () => void } }) {
  const [sendError, setSendError] = useState<string | null>(null);

  const submitMessage = useCallback(
    async (message: string, outgoing: ComposerAttachment[]) => {
      const wire = splitAttachmentsForSubmit(outgoing);
      const failed = await onSend(message, wire.images, wire.attachments);
      if (failed) throw new Error(failed);
    },
    [onSend],
  );

  const sendMessageWithContent = useCallback(
    async (message: string, outgoing: ComposerAttachment[], forceSend?: boolean) => {
      await submitAgentInput({
        message,
        attachments: outgoing,
        forceSend,
        isAgentRunning,
        canSubmit: true,
        queueMessage: ({ message: queuedText, attachments: queuedAttachments }) => {
          if (!agentId || !queueKey || !queueComposerMessage({ queueKey, id: generateMessageId(), text: queuedText, attachments: queuedAttachments, queue: queueWriter })) return;
          drainWhenIdle(paseo, queueKey, agentId);
        },
        submitMessage: ({ message: submitText, attachments: submitAttachments }) => submitMessage(submitText, submitAttachments),
        clearDraft: (lifecycle) => draftKey !== undefined && clearDraft(draftKey, lifecycle),
        setUserInput: replaceText,
        setAttachments,
        setSendError,
        setIsProcessing,
      });
    },
    [isAgentRunning, agentId, queueKey, paseo, submitMessage, draftKey, replaceText],
  );

  const handleSendMessage = () => {
    const trimmed = value.trim();
    if (!trimmed && attachments.length === 0) return;
    void sendMessageWithContent(trimmed, attachments, isAgentRunning || undefined);
    composerHeight.reset();
  };

  return { sendError, setSendError, submitMessage, sendMessageWithContent, handleSendMessage };
}
