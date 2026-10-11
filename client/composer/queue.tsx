import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { Pressable, Text, View } from "react-native";
import { createQueueDrainer, editQueuedComposerMessage, queueComposerMessage, sendQueuedComposerMessageNow, type QueuedComposerMessage, type QueueWriter } from "./message-queue.ts";
import { splitAttachmentsForSubmit, type ComposerAttachment } from "./attachment.ts";
import { generateMessageId } from "../../shared/stream/stream.ts";
import { agentStatusFeed, type PaseoApi } from "../chat/agent-live.ts";
import { mountedTimeline, submitToAgent } from "../chat/chat-send.ts";
import { ICON_SIZE, SPACING } from "../kit/theme.ts";

const QUEUE_BUTTON = 32;

const EMPTY: QueuedComposerMessage[] = [];

let queues = new Map<string, QueuedComposerMessage[]>();
const listeners = new Set<() => void>();

export const queueWriter: QueueWriter = {
  read: (queueKey) => queues.get(queueKey) ?? EMPTY,
  write: (updater) => {
    queues = updater(queues);
    for (const listener of listeners) listener();
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useQueuedMessages(queueKey: string | undefined): QueuedComposerMessage[] {
  return useSyncExternalStore(
    subscribe,
    () => (queueKey ? queueWriter.read(queueKey) : EMPTY),
    () => EMPTY,
  );
}

const drainer = createQueueDrainer(queueWriter);

export function drainWhenIdle(paseo: PaseoApi, queueKey: string, agentId: string): void {
  drainer.watch(
    queueKey,
    agentId,
    agentStatusFeed(paseo, agentId),
    async (message) => {
      const wire = splitAttachmentsForSubmit(message.attachments);
      const failed = await submitToAgent({ paseo, agentId, timeline: mountedTimeline(agentId), body: message.text, images: wire.images, attachments: wire.attachments, clientMessageId: message.id });
      if (failed) throw new Error(failed);
    },
  );
}

export function useQueueActions({ paseo, queueKey, agentId, value, attachments, setAttachments, replaceText, composerHeight, submitMessage, setSendError }: { paseo: PaseoApi; queueKey: string | undefined; agentId: string | undefined; value: string; attachments: ComposerAttachment[]; setAttachments: Dispatch<SetStateAction<ComposerAttachment[]>>; replaceText: (next: string) => void; composerHeight: { reset: () => void }; submitMessage: (message: string, outgoing: ComposerAttachment[]) => Promise<void>; setSendError: (message: string | null) => void }) {
  useEffect(() => {
    if (agentId && queueKey && queueWriter.read(queueKey).length > 0) drainWhenIdle(paseo, queueKey, agentId);
  }, [paseo, queueKey, agentId]);

  const handleQueueMessage = () => {
    if (!agentId || !queueKey) return;
    const trimmed = value.trim();
    if (!trimmed && attachments.length === 0) return;
    const queued = queueComposerMessage({ queueKey, id: generateMessageId(), text: trimmed, attachments, queue: queueWriter });
    if (!queued) return;
    drainWhenIdle(paseo, queueKey, agentId);
    replaceText("");
    setAttachments([]);
    composerHeight.reset();
  };

  const handleEditQueuedMessage = (id: string) => {
    if (!queueKey) return;
    const result = editQueuedComposerMessage({ queueKey, messageId: id, queue: queueWriter });
    if (!result) return;
    replaceText(result.text);
    setAttachments(result.attachments);
  };

  const handleSendQueuedNow = async (id: string) => {
    if (!queueKey) return;
    const result = await sendQueuedComposerMessageNow({ queueKey, messageId: id, queue: queueWriter, submitMessage: ({ text: queuedText, attachments: queuedAttachments }) => submitMessage(queuedText, queuedAttachments) });
    if (result.status === "failed") setSendError(result.errorMessage);
  };

  return { handleQueueMessage, handleEditQueuedMessage, handleSendQueuedNow };
}

export function QueuedMessageRow({ theme, item, onEdit, onSendNow }: { theme: PluginTheme; item: QueuedComposerMessage; onEdit: () => void; onSendNow: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING[3], paddingVertical: SPACING[2], backgroundColor: theme.colors.surface1, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, gap: SPACING[2] }}>
      <Text style={{ flex: 1, color: theme.colors.foreground, fontSize: 14 }} numberOfLines={2} ellipsizeMode="tail">
        {item.text}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
        <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel="Edit queued message" style={{ width: QUEUE_BUTTON, height: QUEUE_BUTTON, borderRadius: QUEUE_BUTTON / 2, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface2 }}>
          <Icon name="Pencil" size={ICON_SIZE.sm} color={theme.colors.foreground} />
        </Pressable>
        <Pressable onPress={onSendNow} accessibilityRole="button" accessibilityLabel="Send queued message now" style={{ width: QUEUE_BUTTON, height: QUEUE_BUTTON, borderRadius: QUEUE_BUTTON / 2, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.accent }}>
          <Icon name="ArrowUp" size={ICON_SIZE.sm} color={theme.colors.accentForeground} />
        </Pressable>
      </View>
    </View>
  );
}
