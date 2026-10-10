import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { createQueueDrainer, splitAttachmentsForSubmit, type QueuedComposerMessage, type QueueWriter } from "../shared/composer.ts";
import { sendToAgent, type PaseoApi } from "./native.tsx";
import { ICON_SIZE, SPACING } from "./kit/theme.ts";
import { BUSY_MS } from "./poll.ts";

const QUEUE_BUTTON = 32;

const EMPTY: QueuedComposerMessage[] = [];

let queues = new Map<string, QueuedComposerMessage[]>();
const listeners = new Set<() => void>();

export const queueWriter: QueueWriter = {
  read: (agentId) => queues.get(agentId) ?? EMPTY,
  write: (updater) => {
    queues = updater(queues);
    for (const listener of listeners) listener();
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useQueuedMessages(agentId: string | undefined): QueuedComposerMessage[] {
  return useSyncExternalStore(
    subscribe,
    () => (agentId ? queueWriter.read(agentId) : EMPTY),
    () => EMPTY,
  );
}

const drainer = createQueueDrainer(queueWriter);

export function drainWhenIdle(paseo: PaseoApi, agentId: string): void {
  const handle = paseo.agents.ref(agentId);
  drainer.watch(
    agentId,
    {
      status: () => handle.current()?.status ?? null,
      subscribe: (listener) => {
        const unsubscribe = handle.subscribe((update) => {
          if (update.kind === "upsert") listener(update.agent.status);
        });
        const timer = setInterval(() => {
          void handle.refresh().then(
            (result) => result && listener(result.agent.status),
            () => undefined,
          );
        }, BUSY_MS);
        return () => {
          clearInterval(timer);
          unsubscribe();
        };
      },
    },
    async (message) => {
      const wire = splitAttachmentsForSubmit(message.attachments);
      const failed = await sendToAgent(paseo, agentId, message.text, wire.images, wire.attachments, message.id);
      if (failed) throw new Error(failed);
    },
  );
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
