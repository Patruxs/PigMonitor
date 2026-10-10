import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { agentsById, agentsBySession, chatRouteOf, heldAgentOf, paseoBusyOf, type ChatRoute, type ListedAgent, type PaseoHeld, type ParticipantRecord } from "../shared/chat-route.ts";
import { paseoLinks, resume, sessions, stop } from "../shared/rpc.ts";
import { useLiveAgent, type PaseoApi } from "./agent-live.ts";
import { SPACING, text } from "./kit/theme.ts";
import { QUIET_MS, usePoll } from "./poll.ts";
import { messageOf } from "../shared/errors.ts";
import { BoundedMap } from "../shared/bounded-map.ts";

export type Navigation = PluginSurfaceProps["navigation"];

const PAGE_SIZE = 200;
const MAX_PAGES = 5;



interface PaseoListing {
  byRef: Map<string, PaseoHeld>;
  byAgent: Map<string, ListedAgent>;
  sessions: { agentId: string; sessionId: string; archived: boolean }[];
}

interface Routing extends PaseoListing {
  links: ReadonlyMap<string, string>;
  formerly: ReadonlyMap<string, string>;
}

const NO_ROUTING: Routing = { byRef: new Map(), byAgent: new Map(), sessions: [], links: new Map(), formerly: new Map() };

const VERIFY_TTL_MS = 5 * 60 * 1000;
const VERIFIED_LIMIT = 200;

type ListedSession = PaseoListing["sessions"][number];

const verified = new BoundedMap<string, { at: number; agent: { session: ListedSession | null; listed: ListedAgent } | null }>(VERIFIED_LIMIT);

async function verifyAgents(paseo: PaseoApi, agentIds: string[]): Promise<{ sessions: ListedSession[]; listed: ListedAgent[]; missing: string[] }> {
  const out = { sessions: [] as ListedSession[], listed: [] as ListedAgent[], missing: [] as string[] };
  for (const agentId of agentIds) {
    let known = verified.get(agentId);
    if (!known || Date.now() - known.at >= VERIFY_TTL_MS) {
      try {
        const result = await paseo.agents.ref(agentId).refresh();
        const agent = result?.agent;
        const sessionId = agent?.persistence?.sessionId;
        known = { at: Date.now(), agent: agent ? { session: sessionId && agent.provider.startsWith("claude") ? { agentId, sessionId, archived: Boolean(agent.archivedAt) } : null, listed: { agentId, busy: paseoBusyOf(agent), archived: Boolean(agent.archivedAt) } } : null };
        verified.set(agentId, known);
      } catch {
        continue;
      }
    }
    if (!known.agent) {
      out.missing.push(agentId);
      continue;
    }
    if (known.agent.session) out.sessions.push(known.agent.session);
    out.listed.push(known.agent.listed);
  }
  return out;
}

async function agentsFor(paseo: PaseoApi, wantedRefs: string[]): Promise<PaseoListing> {
  const listing: PaseoListing = { byRef: new Map(), byAgent: new Map(), sessions: [] };
  const missing = () => wantedRefs.some((ref) => !listing.byRef.has(ref));
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES && missing(); page++) {
    const r = await paseo.agents.list({ filter: { includeArchived: true }, sort: [{ key: "updated_at", direction: "desc" }], page: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } });
    for (const [ref, held] of agentsBySession(r.entries)) if (!listing.byRef.has(ref)) listing.byRef.set(ref, held);
    for (const [agentId, listed] of agentsById(r.entries)) listing.byAgent.set(agentId, listed);
    for (const { agent } of r.entries) {
      const sessionId = agent.persistence?.sessionId;
      if (sessionId && agent.provider.startsWith("claude")) listing.sessions.push({ agentId: agent.id, sessionId, archived: Boolean(agent.archivedAt) });
    }
    if (!r.pageInfo.hasMore || !r.pageInfo.nextCursor) break;
    cursor = r.pageInfo.nextCursor;
  }
  return listing;
}



export interface ChatRouting {
  ready: boolean;
  canOpen: boolean;
  routeOf: (id: string) => ChatRoute;
  participant: (id: string) => ParticipantRecord | undefined;
  paseoBusy: (id: string) => boolean | null;
  agentNowHeldBy: (id: string) => string | null;
  open: (agentId: string) => void;
  resume: (id: string) => Promise<string | null>;
}

export function useChatRouting(ids: string[], selected: string, navigation: Navigation, serverId: string | undefined): ChatRouting {
  const paseo = usePaseo();
  const callSessions = useRpc(sessions);
  const callResume = useRpc(resume);
  const [bump, setBump] = useState(0);
  const lastKnown = useRef<ParticipantRecord[] | null>(null);
  const lastAgents = useRef<Routing | null>(null);
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
  const followed = known.filter((s) => !s.gone || s.id === selected);
  const wantedRefs = followed.flatMap((s) => (s.ref ? [s.ref] : []));
  const callLinks = useRpc(paseoLinks);
  const { value: found } = usePoll(
    async () => {
      try {
        const listed = wantedRefs.length === 0 ? NO_ROUTING : await agentsFor(paseo, wantedRefs);
        const remembered = [...new Set(lastAgents.current?.links.values() ?? [])].filter((agentId) => !listed.byAgent.has(agentId));
        const checked = await verifyAgents(paseo, remembered);
        const listing: PaseoListing = { byRef: listed.byRef, byAgent: new Map([...listed.byAgent, ...checked.listed.map((agent) => [agent.agentId, agent] as const)]), sessions: [...listed.sessions, ...checked.sessions] };
        const r = await callLinks({ agents: listing.sessions, missing: checked.missing });
        if (!r.ok) return r;
        return { ok: true as const, value: { ...listing, links: new Map(r.links.map((link) => [link.participantId, link.agentId])), formerly: new Map(r.formerly.map((former) => [former.participantId, former.heldBy])) } as Routing };
      } catch (error) {
        return { ok: false as const, code: "failed", error: messageOf(error) };
      }
    },
    `agents:${wantedRefs.join(",")}:${bump}`,
    () => QUIET_MS,
  );
  if (found) lastAgents.current = found;
  const listing = lastAgents.current ?? NO_ROUTING;
  const { links, formerly } = listing;
  const heldBy = (id: string) => heldAgentOf(byId.get(id), listing.byRef, links, listing.byAgent);
  return {
    ready: lastKnown.current !== null && lastAgents.current !== null,
    agentNowHeldBy: (id) => (links.has(id) ? null : (formerly.get(id) ?? null)),
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
