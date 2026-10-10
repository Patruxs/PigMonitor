import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { transcript } from "../shared/rpc.ts";
import { withIncrement, type Item, type Transcript } from "../shared/transcript.ts";
import type { Usage } from "../shared/context-meter.ts";
import { streamOfTranscript } from "../shared/stream-mail.ts";
import type { PiggeryStreamItem } from "../shared/stream.ts";
import type { TurnPresentation } from "../shared/timeline.ts";
import { StreamView, type ViewportHandle } from "./stream.tsx";
import { clockText } from "../shared/view.ts";
import { Markdown } from "./kit/markdown.tsx";
import { MESSAGE_TEXT } from "./message.tsx";
import { AVATAR, AVATAR_SM, paint, Panel, Pill, Quiet, RoleAvatar, tint } from "./kit/chat.tsx";
import { Notice } from "./kit/notice.tsx";
import { SPACING, text } from "./kit/theme.ts";
import { BUSY_MS, useNow, usePoll } from "./poll.ts";

export const PAGE = 20000;
const BODY_LINE = 22;

export function useTranscript(id: string, limit: number, refresh = 0) {
  const call = useRpc(transcript);
  const key = `${id}:${limit}:${refresh}`;
  const held = useRef<{ key: string; value: Transcript } | null>(null);
  return usePoll(
    async () => {
      const had = held.current?.key === key ? held.current.value : null;
      const r = await call({ id, limit, ...(had?.epoch !== undefined && had.rev !== undefined ? { since: { epoch: had.epoch, rev: had.rev } } : {}) });
      if (!r.ok) return r;
      const value: Transcript = { items: withIncrement(had?.items ?? [], r, limit), total: r.total, name: r.name, role: r.role, files: r.files, roles: r.roles, usage: r.usage, epoch: r.epoch, rev: r.rev };
      held.current = { key, value };
      return { ok: true as const, value };
    },
    key,
    () => BUSY_MS,
  );
}

function Header({ theme, who, colour, tags, at, now }: { theme: PluginTheme; who: string; colour: string; tags: ReactNode; at: number | undefined; now: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: SPACING[2], minHeight: AVATAR_SM }}>
      <Text style={[text(theme, "rowTitle"), { fontWeight: "600", color: colour }]} numberOfLines={1}>
        {who}
      </Text>
      {tags}
      {at !== undefined ? <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"] }]}>{clockText(at, now)}</Text> : null}
    </View>
  );
}

function Message({ avatar, colour, children }: { avatar: ReactNode; colour: string; children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", gap: SPACING[3], paddingVertical: SPACING[3] }}>
      <View style={{ width: AVATAR, paddingTop: 1 }}>{avatar}</View>
      <View style={{ flex: 1, minWidth: 0, gap: SPACING[2], paddingLeft: SPACING[3], borderLeftWidth: 2, borderLeftColor: tint(colour, "55") }}>{children}</View>
    </View>
  );
}

export function MailIn({ theme, item, role, now }: { theme: PluginTheme; item: Item; role: string | undefined; now: number }) {
  const from = item.from ?? "mail";
  const colour = paint(theme, role, from);
  return (
    <Message colour={colour} avatar={<RoleAvatar theme={theme} name={from} role={role} id={from} />}>
      <Header
        theme={theme}
        who={from}
        colour={colour}
        tags={
          <>
            {role ? <Pill theme={theme} label={role} colour={colour} filled /> : null}
            <Pill theme={theme} label={item.ref ? `mail ${item.ref}` : "mail"} icon="Mail" />
            {item.to ? <Pill theme={theme} label={`to ${item.to}`} icon="Send" /> : null}
            {item.reply ? <Pill theme={theme} label={`re ${item.reply}`} icon="Reply" /> : null}
          </>
        }
        at={item.at}
        now={now}
      />
      <Panel theme={theme} tone={colour}>
        <View {...MESSAGE_TEXT}>
          <Markdown theme={theme} source={item.text} style={{ ...text(theme, "rowTitle"), lineHeight: BODY_LINE }} />
        </View>
      </Panel>
    </Message>
  );
}

export function MailStream({ theme, id, refresh, working, workingSince, cwd, viewportRef, onUsage }: { theme: PluginTheme; id: string; refresh?: number; working: boolean; workingSince?: number; cwd?: string; viewportRef?: { current: ViewportHandle | null }; onUsage?: (usage: Usage | null) => void }) {
  const [limit, setLimit] = useState(PAGE);
  const now = useNow(30000);
  const { value: fresh, error } = useTranscript(id, limit, refresh);
  const kept = useRef<{ id: string; limit: number; value: Transcript } | null>(null);
  if (fresh) kept.current = { id, limit, value: fresh };
  const value = fresh ?? (kept.current?.id === id ? kept.current.value : null);
  const usage = value?.usage ?? null;
  useEffect(() => onUsage?.(usage), [onUsage, usage?.contextWindowUsedTokens, usage?.contextWindowMaxTokens]);
  const isLoadingOlder = fresh === null && value !== null && (kept.current?.limit ?? limit) < limit;
  const tail = useMemo(() => streamOfTranscript(value?.items ?? []), [value]);
  const hasOlder = value !== null && value.total > value.items.length;
  const turn: TurnPresentation = { isActive: working, isCancelling: false, startedAt: working && workingSince !== undefined ? new Date(workingSince) : null, turnId: null };
  const loadOlder = useCallback(async () => {
    if (!hasOlder) return false;
    setLimit((had) => had + PAGE);
    return true;
  }, [hasOlder]);
  const renderPiggery = useCallback(
    (item: PiggeryStreamItem) => {
      const { source } = item;
      if (source.kind === "session") return <Quiet theme={theme} icon="Play" label={`Session started${source.text ? ` · ${source.text}` : ""}`} />;
      if (source.kind === "wake") return <Quiet theme={theme} icon="Bell" label={source.text} />;
      if (source.kind === "turn") return null;
      return <MailIn theme={theme} item={{ i: 0, kind: "mail", at: item.timestamp.getTime(), text: source.text, from: source.from, to: source.to, ref: source.ref, reply: source.reply }} role={source.from ? value?.roles?.[source.from] : undefined} now={now} />;
    },
    [theme, value, now],
  );
  if (!value) return <View style={{ flex: 1, padding: SPACING[4] }}>{error ? <Notice theme={theme} kind={error.code} detail={error.message} /> : <Notice theme={theme} kind="loading" />}</View>;
  return <StreamView theme={theme} streamKey={id} tail={tail} head={[]} turn={turn} cwd={cwd} history={{ hasOlder, isLoadingOlder, progressKey: `${value.items.length}`, loadOlder }} renderPiggery={renderPiggery} viewportRef={viewportRef} emptyText="Nothing to show yet." />;
}
