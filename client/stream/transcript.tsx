import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { transcript } from "../../shared/rpc.ts";
import { withIncrement, type Item, type Transcript } from "../../shared/stream/transcript.ts";
import type { Usage } from "../../shared/stream/context-meter.ts";
import { streamOfLog } from "./log-stream.ts";
import type { PiggeryStreamItem } from "../../shared/stream/stream.ts";
import type { TurnPresentation } from "./turns.ts";
import { StreamView } from "./stream.tsx";
import type { ViewportHandle } from "./stream-viewport.tsx";
import { messageClock } from "../../shared/format.ts";
import { Markdown } from "./markdown.tsx";
import { messageTextProps } from "./find-anchors.ts";
import { AVATAR, AVATAR_SM } from "../kit/avatar.tsx";
import { Panel, Quiet } from "../kit/panel.tsx";
import { Pill } from "../kit/pill.tsx";
import { tint } from "../kit/theme.ts";
import { paint, usePalette } from "../piggery/palette.tsx";
import { RoleAvatar } from "../piggery/role.tsx";
import { Notice } from "../piggery/notice.tsx";
import { SPACING, text } from "../kit/theme.ts";
import { BUSY_MS, useNow, usePoll } from "../kit/poll.ts";

const PAGE = 20000;
const BODY_LINE = 22;

function useTranscript(id: string, limit: number, refresh = 0) {
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
      {at !== undefined ? <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"] }]}>{messageClock(new Date(at), new Date(now))}</Text> : null}
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

function MailBubble({ theme, mail, at, role, now }: { theme: PluginTheme; mail: PiggeryStreamItem["source"]; at: number; role: string | undefined; now: number }) {
  const palette = usePalette(theme);
  const from = mail.from ?? "mail";
  const colour = paint(palette, role, from);
  return (
    <Message colour={colour} avatar={<RoleAvatar theme={theme} name={from} role={role} id={from} />}>
      <Header
        theme={theme}
        who={from}
        colour={colour}
        tags={
          <>
            {role ? <Pill theme={theme} label={role} colour={colour} filled /> : null}
            <Pill theme={theme} label={mail.ref ? `mail ${mail.ref}` : "mail"} icon="Mail" />
            {mail.to ? <Pill theme={theme} label={`to ${mail.to}`} icon="Send" /> : null}
            {mail.reply ? <Pill theme={theme} label={`re ${mail.reply}`} icon="Reply" /> : null}
          </>
        }
        at={at}
        now={now}
      />
      <Panel theme={theme} tone={colour}>
        <View {...messageTextProps}>
          <Markdown theme={theme} source={mail.text} style={{ ...text(theme, "rowTitle"), lineHeight: BODY_LINE }} />
        </View>
      </Panel>
    </Message>
  );
}

export function LogStream({ theme, id, refresh, working, workingSince, cwd, viewportRef, onUsage }: { theme: PluginTheme; id: string; refresh?: number; working: boolean; workingSince?: number; cwd?: string; viewportRef?: { current: ViewportHandle | null }; onUsage?: (usage: Usage | null) => void }) {
  const [limit, setLimit] = useState(PAGE);
  const now = useNow(30000);
  const { value: fresh, error } = useTranscript(id, limit, refresh);
  const kept = useRef<{ id: string; limit: number; value: Transcript } | null>(null);
  if (fresh) kept.current = { id, limit, value: fresh };
  const value = fresh ?? (kept.current?.id === id ? kept.current.value : null);
  const usage = value?.usage ?? null;
  useEffect(() => onUsage?.(usage), [onUsage, usage?.contextWindowUsedTokens, usage?.contextWindowMaxTokens]);
  const isLoadingOlder = fresh === null && value !== null && (kept.current?.limit ?? limit) < limit;
  const tail = useMemo(() => streamOfLog(value?.items ?? []), [value]);
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
      if (source.kind === "run-start") return <Quiet theme={theme} icon="Play" label={`Session started${source.text ? ` · ${source.text}` : ""}`} />;
      if (source.kind === "wake") return <Quiet theme={theme} icon="Bell" label={source.text} />;
      if (source.kind === "turn-end") return null;
      return <MailBubble theme={theme} mail={source} at={item.timestamp.getTime()} role={source.from ? value?.roles?.[source.from] : undefined} now={now} />;
    },
    [theme, value, now],
  );
  if (!value) return <View style={{ flex: 1, padding: SPACING[4] }}>{error ? <Notice theme={theme} kind={error.code} detail={error.message} /> : <Notice theme={theme} kind="loading" />}</View>;
  return <StreamView theme={theme} streamKey={id} tail={tail} head={[]} turn={turn} cwd={cwd} history={{ hasOlder, isLoadingOlder, progressKey: `${value.items.length}`, loadOlder }} renderPiggery={renderPiggery} viewportRef={viewportRef} emptyText="Nothing to show yet." />;
}
