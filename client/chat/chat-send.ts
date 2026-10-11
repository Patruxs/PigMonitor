import { useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef } from "react";
import { sendMail, type AttachmentData, type ImageData } from "../../shared/rpc.ts";
import { createUserMessage, generateMessageId } from "../../shared/stream.ts";
import type { PaseoApi } from "./agent-live.ts";
import type { AgentTimeline } from "../timeline.ts";
import { messageOf } from "../../shared/errors.ts";


async function sendToAgent(paseo: PaseoApi, agentId: string, body: string, images: ImageData[], attachments: AttachmentData[], messageId?: string): Promise<string | null> {
  try {
    await paseo.agents.ref(agentId).send(body, { ...(messageId ? { messageId } : {}), activeTurnBehavior: "steer" as const, images, attachments });
    return null;
  } catch (error) {
    return `Paseo did not take the message: ${messageOf(error)}`;
  }
}

const mountedTimelines = new Map<string, { current: AgentTimeline }>();

export function useMountedTimeline(timeline: AgentTimeline): void {
  const latest = useRef(timeline);
  latest.current = timeline;
  const { agentId } = timeline;
  useEffect(() => {
    mountedTimelines.set(agentId, latest);
    return () => {
      if (mountedTimelines.get(agentId) === latest) mountedTimelines.delete(agentId);
    };
  }, [agentId]);
}

export function mountedTimeline(agentId: string): AgentTimeline | null {
  return mountedTimelines.get(agentId)?.current ?? null;
}

export async function submitToAgent({ paseo, agentId, timeline, body, images, attachments, clientMessageId = generateMessageId() }: { paseo: PaseoApi; agentId: string; timeline: AgentTimeline | null; body: string; images: ImageData[]; attachments: AttachmentData[]; clientMessageId?: string }): Promise<string | null> {
  if (!timeline) return sendToAgent(paseo, agentId, body, images, attachments, clientMessageId);
  const message = createUserMessage({ clientMessageId, text: body, timestamp: new Date(), ...(timeline.turn.isActive && timeline.turn.turnId ? { turnId: timeline.turn.turnId } : {}), images: images.map((image, index) => ({ id: `${clientMessageId}:${index}`, uri: `data:${image.mimeType};base64,${image.data}`, mimeType: image.mimeType })), attachments });
  try {
    await timeline.submit(message, async () => {
      const failed = await sendToAgent(paseo, agentId, body, images, attachments, clientMessageId);
      if (failed) throw new Error(failed);
    });
    return null;
  } catch (failure) {
    return messageOf(failure);
  }
}

interface MailOut {
  to: string;
  body: string;
  images: ImageData[];
  attachments: AttachmentData[];
  replySeq?: number;
}

export function useSendMailTo(): (mail: MailOut) => Promise<string | null> {
  const call = useRpc(sendMail);
  return useCallback(
    async ({ to, body, images, attachments, replySeq }) => {
      const r = await call({ to, body, ...(images.length > 0 ? { images } : {}), ...(attachments.length > 0 ? { attachments } : {}), ...(replySeq !== undefined ? { reply_to: `#${replySeq}` } : {}) });
      if (r.ok) return null;
      return r.code === "denied" && r.gate_name ? `${r.error} Write to ${r.gate_name} instead.` : r.error;
    },
    [call],
  );
}
