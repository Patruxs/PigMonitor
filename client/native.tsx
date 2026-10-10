import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { agentsBySession, nativeOf, type Native, type Session } from "../shared/native.ts";
import { resume, sessions, stop, type AttachmentData, type ImageData } from "../shared/rpc.ts";
import { SPACING, text } from "./kit/theme.ts";
import { BUSY_MS, QUIET_MS, usePoll } from "./poll.ts";

export type Navigation = PluginSurfaceProps["navigation"];

const PAGE_SIZE = 200;
const MAX_PAGES = 5;

type PaseoApi = ReturnType<typeof usePaseo>;

async function agentsFor(paseo: PaseoApi, wanted: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES && wanted.some((ref) => !found.has(ref)); page++) {
    const r = await paseo.agents.list({ filter: { includeArchived: true }, sort: [{ key: "updated_at", direction: "desc" }], page: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } });
    for (const [ref, id] of agentsBySession(r.entries)) if (!found.has(ref)) found.set(ref, id);
    if (!r.pageInfo.hasMore || !r.pageInfo.nextCursor) break;
    cursor = r.pageInfo.nextCursor;
  }
  return found;
}

function messageOf(error: unknown): string {
  return String((error as Error)?.message ?? error);
}

export interface NativeChat {
  ready: boolean;
  canOpen: boolean;
  of: (id: string) => Native;
  open: (agentId: string) => void;
  resume: (id: string) => Promise<string | null>;
  send: (agentId: string, body: string, images: ImageData[], attachments: AttachmentData[], messageId?: string) => Promise<string | null>;
}

export function useNative(ids: string[], selected: string, navigation: Navigation, serverId: string | undefined): NativeChat {
  const paseo = usePaseo();
  const callSessions = useRpc(sessions);
  const callResume = useRpc(resume);
  const [bump, setBump] = useState(0);
  const lastKnown = useRef<Session[] | null>(null);
  const lastAgents = useRef<Map<string, string> | null>(null);
  const asked = [...ids].sort();
  const { value: fresh } = usePoll(
    async () => {
      const r = await callSessions({ ids: asked });
      return r.ok ? { ok: true as const, value: r.sessions } : r;
    },
    `sessions:${asked.join(",")}`,
    () => QUIET_MS,
  );
  if (fresh) lastKnown.current = fresh;
  const known = lastKnown.current ?? [];
  const byId = new Map<string, Session>(known.map((s) => [s.id, s]));
  const wanted = known.filter((s) => s.ref && (!s.gone || s.id === selected)).map((s) => s.ref as string);
  const { value: found } = usePoll(
    async () => {
      if (wanted.length === 0) return { ok: true as const, value: new Map<string, string>() };
      try {
        return { ok: true as const, value: await agentsFor(paseo, wanted) };
      } catch (error) {
        return { ok: false as const, code: "failed", error: messageOf(error) };
      }
    },
    `agents:${wanted.join(",")}:${bump}`,
    () => QUIET_MS,
  );
  if (found) lastAgents.current = found;
  const agents = lastAgents.current ?? new Map<string, string>();
  return {
    ready: lastKnown.current !== null && lastAgents.current !== null,
    canOpen: navigation !== undefined,
    of: (id) => {
      const session = byId.get(id);
      return nativeOf(session, session?.ref ? agents.get(session.ref) : undefined);
    },
    open: (agentId) => navigation?.openAgent({ agentId, ...(serverId ? { serverId } : {}) }),
    resume: async (id) => {
      const r = await callResume({ id });
      if (!r.ok) return r.error;
      setBump((n) => n + 1);
      return null;
    },
    send: async (agentId, body, images, attachments, messageId) => {
      try {
        const options = { ...(messageId ? { messageId } : {}), activeTurnBehavior: "steer", images, attachments };
        await paseo.agents.ref(agentId).send(body, options as Parameters<ReturnType<typeof paseo.agents.ref>["send"]>[1]);
        return null;
      } catch (error) {
        return `Paseo did not take the message: ${messageOf(error)}`;
      }
    },
  };
}

export interface Stop {
  running: boolean;
  onStop: () => Promise<string | null>;
}

export function useStop(id: string, native: Native, abortable: boolean): Stop | undefined {
  const paseo = usePaseo();
  const callStop = useRpc(stop);
  const [bump, setBump] = useState(0);
  const agentId = native.kind === "open" ? native.agentId : "";
  const { value: agentRunning } = usePoll(
    async () => {
      if (!agentId) return { ok: true as const, value: false };
      try {
        const r = await paseo.agents.ref(agentId).refresh();
        return { ok: true as const, value: r?.agent.status === "running" };
      } catch (error) {
        return { ok: false as const, code: "failed", error: messageOf(error) };
      }
    },
    `running:${agentId}:${bump}`,
    () => BUSY_MS,
  );
  if (native.kind === "resume") return undefined;
  return {
    running: native.kind === "open" ? agentRunning === true : abortable,
    onStop: async () => {
      const r = await callStop({ id, ...(agentId ? { agentId } : {}) });
      setBump((n) => n + 1);
      return r.ok ? null : r.error;
    },
  };
}

function Link({ theme, label, icon, busy, onPress }: { theme: PluginTheme; label: string; icon: string; busy?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="link" accessibilityLabel={label} hitSlop={SPACING[2]} style={(state) => ({ flexDirection: "row", alignItems: "center", gap: SPACING[1], opacity: busy ? 0.5 : state.pressed ? 0.7 : 1 })}>
      <Icon name={busy ? "Loader" : icon} size={12} color={theme.colors.foregroundMuted} />
      <Text style={[text(theme, "label"), { textDecorationLine: "underline" }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function NativeLink({ theme, id, native, chat, writable }: { theme: PluginTheme; id: string; native: Native; chat: NativeChat; writable: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (native.kind === "open") return chat.canOpen ? <Link theme={theme} label="Open in Paseo" icon="ExternalLink" onPress={() => chat.open(native.agentId)} /> : null;
  if (native.kind !== "resume" || !writable) return null;
  const press = async () => {
    setBusy(true);
    setError(null);
    setError(await chat.resume(id));
    setBusy(false);
  };
  return (
    <View style={{ alignItems: "flex-end", gap: SPACING[1] }}>
      <Link theme={theme} label="Resume in Paseo" icon="Import" busy={busy} onPress={() => void press()} />
      {error ? <Text style={[text(theme, "label", "statusDanger"), { maxWidth: 280 }]}>{error}</Text> : null}
    </View>
  );
}
