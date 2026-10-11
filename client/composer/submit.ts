import { messageOf } from "../../shared/errors.ts";

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
    input.setSendError(messageOf(error, FAILED_TO_SEND));
    input.setIsProcessing(false);
    return "failed";
  }
}

export type PrimaryActionKind = "send" | "active" | "none";

export function resolvePrimaryActionKind(input: { hasSendableContent: boolean; isAgentRunning: boolean; isSubmitLoading: boolean; keepSendVisible: boolean }): PrimaryActionKind {
  if (input.hasSendableContent) return "send";
  if (input.isAgentRunning) return "active";
  if (input.isSubmitLoading || input.keepSendVisible) return "send";
  return "none";
}
