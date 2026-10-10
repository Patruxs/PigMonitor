import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { agentsBySession, chatRouteOf, paseoBusyOf, type ChatRoute, type PaseoHeld, type ParticipantRecord } from "../shared/chat-route.ts";
import { resume, sessions, stop } from "../shared/rpc.ts";
import { useLiveAgent, type PaseoApi } from "./agent-live.ts";
import { SPACING, text } from "./kit/theme.ts";
import { QUIET_MS, usePoll } from "./poll.ts";
import { messageOf } from "../shared/errors.ts";

export type Navigation = PluginSurfaceProps["navigation"];

const PAGE_SIZE = 200;
const MAX_PAGES = 5;


async function agentsFor(paseo: PaseoApi, wanted: string[]): Promise<Map<string, PaseoHeld>> {
  const found = new Map<string, PaseoHeld>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES && wanted.some((ref) => !found.has(ref)); page++) {
    const r = await paseo.agents.list({ filter: { includeArchived: true }, sort: [{ key: "updated_at", direction: "desc" }], page: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } });
    for (const [ref, held] of agentsBySession(r.entries)) if (!found.has(ref)) found.set(ref, held);
    if (!r.pageInfo.hasMore || !r.pageInfo.nextCursor) break;
    cursor = r.pageInfo.nextCursor;
  }
  return found;
}



export interface ChatRouting {
  ready: boolean;
  canOpen: boolean;
  routeOf: (id: string) => ChatRoute;
  participant: (id: string) => ParticipantRecord | undefined;
  paseoBusy: (id: string) => boolean | null;
  open: (agentId: string) => void;
  resume: (id: string) => Promise<string | null>;
}

export function useChatRouting(ids: string[], selected: string, navigation: Navigation, serverId: string | undefined): ChatRouting {
  const paseo = usePaseo();
  const callSessions = useRpc(sessions);
  const callResume = useRpc(resume);
  const [bump, setBump] = useState(0);
  const lastKnown = useRef<ParticipantRecord[] | null>(null);
  const lastAgents = useRef<Map<string, PaseoHeld> | null>(null);
  const [liveBusy, setLiveBusy] = useState<ReadonlyMap<string, boolean | null>>(new Map());
  useEffect(
    () =>
      paseo.agents.subscribe((update) => {
        if (update.kind !== "upsert") return;
        const busy = paseoBusyOf(update.agent);
        setLiveBusy((had) => (had.get(update.agent.id) === busy ? had : new Map(had).set(update.agent.id, busy)));
      }),
    [paseo],
  );
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
  const byId = new Map<string, ParticipantRecord>(known.map((s) => [s.id, s]));
  const wanted = known.filter((s) => s.ref && (!s.gone || s.id === selected)).map((s) => s.ref as string);
  const { value: found } = usePoll(
    async () => {
      if (wanted.length === 0) return { ok: true as const, value: new Map<string, PaseoHeld>() };
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
  const agents = lastAgents.current ?? new Map<string, PaseoHeld>();
  const heldBy = (id: string) => {
    const ref = byId.get(id)?.ref;
    return ref ? agents.get(ref) : undefined;
  };
  return {
    ready: lastKnown.current !== null && lastAgents.current !== null,
    canOpen: navigation !== undefined,
    routeOf: (id) => chatRouteOf(byId.get(id), heldBy(id)?.agentId),
    participant: (id) => byId.get(id),
    paseoBusy: (id) => {
      const held = heldBy(id);
      if (!held) return null;
      return liveBusy.has(held.agentId) ? (liveBusy.get(held.agentId) ?? null) : held.busy;
    },
    open: (agentId) => navigation?.openAgent({ agentId, ...(serverId ? { serverId } : {}) }),
    resume: async (id) => {
      const r = await callResume({ id });
      if (!r.ok) return r.error;
      setBump((n) => n + 1);
      return null;
    },
  };
}

export interface Stop {
  running: boolean;
  onStop: () => Promise<string | null>;
}

export function useStop(id: string, route: ChatRoute, abortable: boolean): Stop | undefined {
  const callStop = useRpc(stop);
  const agentId = route.kind === "open" ? route.agentId : null;
  const live = useLiveAgent(agentId);
  if (route.kind === "resume") return undefined;
  return {
    running: route.kind === "open" ? live.agent?.status === "running" : abortable,
    onStop: async () => {
      const r = await callStop({ id, ...(agentId ? { agentId } : {}) });
      void live.refresh();
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

export function PaseoLink({ theme, id, route, chat, writable }: { theme: PluginTheme; id: string; route: ChatRoute; chat: ChatRouting; writable: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (route.kind === "open") return chat.canOpen ? <Link theme={theme} label="Open in Paseo" icon="ExternalLink" onPress={() => chat.open(route.agentId)} /> : null;
  if (route.kind !== "resume" || !writable) return null;
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
