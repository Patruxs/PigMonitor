import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { HUMAN, roleWord, sameDay, dayLabel } from "../shared/mail.ts";
import { hasImages, parseMarkdown } from "../shared/markdown.ts";
import { transcript } from "../shared/rpc.ts";
import { mergeItems } from "../shared/thread.ts";
import type { Item, Transcript } from "../shared/transcript.ts";
import { clockText } from "../shared/view.ts";
import { Chip } from "./kit/badge.tsx";
import { Markdown } from "./kit/markdown.tsx";
import { AVATAR, AVATAR_SM, BUBBLE_RADIUS, DayDivider, Legend, paint, Panel, Pill, Quiet, RoleAvatar, tint } from "./kit/chat.tsx";
import { Notice } from "./kit/notice.tsx";
import { RADIUS, READABLE, SPACING, text } from "./kit/theme.ts";
import { BUSY_MS, useNow, usePoll } from "./poll.ts";

const PAGE = 20000;
const GUTTER = AVATAR + SPACING[3];
const ICON_TOOL = 12;
const BODY_LINE = 22;

function useTranscript(id: string, limit: number) {
  const call = useRpc(transcript);
  return usePoll(
    async () => {
      const r = await call({ id, limit });
      return r.ok ? { ok: true as const, value: { items: r.items, total: r.total, name: r.name, role: r.role, files: r.files, roles: r.roles } as Transcript } : r;
    },
    `${id}:${limit}`,
    () => BUSY_MS,
  );
}

function shortTool(name: string): string {
  return name.replace(/^mcp__([^_]+)__/, "$1 · ");
}

function firstLine(s: string): string {
  return s.split("\n").find((l) => l.trim()) ?? "";
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

function Human({ theme, item, now }: { theme: PluginTheme; item: Item; now: number }) {
  const colour = paint(theme, HUMAN, HUMAN);
  const pictured = useMemo(() => hasImages(parseMarkdown(item.text)), [item.text]);
  return (
    <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: SPACING[3], paddingVertical: SPACING[3] }}>
      <View style={{ alignItems: "flex-end", gap: SPACING[1], maxWidth: "85%", flexGrow: pictured ? 1 : 0 }}>
        <View style={{ alignSelf: pictured ? "stretch" : "auto", paddingHorizontal: SPACING[4], paddingVertical: SPACING[3], borderRadius: BUBBLE_RADIUS, borderBottomRightRadius: 4, backgroundColor: tint(colour, "26"), borderWidth: 1, borderColor: tint(colour, "55") }}>
          <Markdown theme={theme} source={item.text} style={{ ...text(theme, "rowTitle"), lineHeight: BODY_LINE }} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5], paddingRight: SPACING[1] }}>
          <Text style={[text(theme, "label"), { color: colour, fontWeight: "600" }]}>{item.note ? "You" : "Human"}</Text>
          {item.ref ? <Text style={text(theme, "label")}>{item.ref}</Text> : null}
          {item.at !== undefined ? <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"] }]}>{clockText(item.at, now)}</Text> : null}
          {item.note ? <Text style={[text(theme, "label"), { color: item.note === "Held" ? theme.colors.statusWarning : theme.colors.foregroundMuted }]}>{`· ${item.note}`}</Text> : null}
        </View>
      </View>
      <View style={{ width: AVATAR, paddingTop: 1 }}>
        <RoleAvatar theme={theme} name="Human" role={HUMAN} id={HUMAN} />
      </View>
    </View>
  );
}

function Thought({ theme, item }: { theme: PluginTheme; item: Item }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ paddingLeft: GUTTER, paddingVertical: SPACING[1] }}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5], alignSelf: "flex-start" }}>
        <Icon name="Sparkles" size={11} color={theme.colors.foregroundMuted} />
        <Text style={text(theme, "label")}>{open ? "Thought" : `Thought · ${firstLine(item.text).slice(0, 80)}`}</Text>
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={11} color={theme.colors.foregroundMuted} />
      </Pressable>
      {open ? (
        <View style={{ paddingTop: SPACING[1.5], paddingLeft: SPACING[4], borderLeftWidth: 2, borderLeftColor: theme.colors.border, marginTop: SPACING[1] }}>
          <Markdown theme={theme} source={item.text} style={{ ...text(theme, "meta"), lineHeight: BODY_LINE }} />
        </View>
      ) : null}
    </View>
  );
}

function ToolCall({ theme, item, now, allOpen }: { theme: PluginTheme; item: Item; now: number; allOpen: boolean }) {
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? allOpen;
  const pending = item.result === undefined;
  const colour = item.error ? theme.colors.statusDanger : pending ? theme.colors.foregroundMuted : theme.colors.statusSuccess;
  const icon = item.error ? "X" : pending ? "Loader" : "Check";
  const preview = item.input ? firstLine(item.input) : "";
  return (
    <View style={{ gap: SPACING[1] }}>
      <Pressable
        onPress={() => setChosen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${item.tool ?? "tool"} call`}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: 30, paddingHorizontal: SPACING[2], borderRadius: RADIUS.md, backgroundColor: pressed ? theme.colors.surface2 : hovered || open ? theme.colors.surface1 : "transparent" })}
      >
        <Icon name={icon} size={ICON_TOOL} color={colour} />
        <Text style={[text(theme, "code"), { color: theme.colors.foreground }]} numberOfLines={1}>
          {shortTool(item.tool ?? item.text)}
        </Text>
        {preview ? (
          <Text style={[text(theme, "code", "foregroundMuted"), { flex: 1, minWidth: 0 }]} numberOfLines={1}>
            {preview}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {item.at !== undefined ? <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"] }]}>{clockText(item.at, now)}</Text> : null}
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={11} color={theme.colors.foregroundMuted} />
      </Pressable>
      {open ? (
        <View style={{ marginLeft: SPACING[2], gap: SPACING[2] }}>
          {item.input ? (
            <Panel theme={theme}>
              <Text style={text(theme, "label")}>Input</Text>
              <Text style={text(theme, "code")} selectable>
                {item.input}
              </Text>
            </Panel>
          ) : null}
          <Panel theme={theme} tone={item.error ? theme.colors.statusDanger : undefined}>
            <Text style={text(theme, "label", item.error ? "statusDanger" : "foregroundMuted")}>{item.error ? "Error" : pending ? "Running" : "Output"}</Text>
            {item.result !== undefined ? (
              <Text style={text(theme, "code", item.error ? "foreground" : "foregroundMuted")} selectable>
                {item.result || "(empty)"}
              </Text>
            ) : (
              <Text style={text(theme, "meta")}>No result recorded.</Text>
            )}
          </Panel>
        </View>
      ) : null}
    </View>
  );
}

function ToolGroup({ theme, items, now, allOpen }: { theme: PluginTheme; items: Item[]; now: number; allOpen: boolean }) {
  const failed = items.filter((i) => i.error).length;
  return (
    <View style={{ paddingLeft: GUTTER, paddingVertical: SPACING[1.5] }}>
      <View style={{ borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.colors.border, paddingVertical: SPACING[1], paddingHorizontal: SPACING[1] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingHorizontal: SPACING[2], paddingVertical: SPACING[1] }}>
          <Icon name="Wrench" size={11} color={theme.colors.foregroundMuted} />
          <Text style={text(theme, "label")}>{`${items.length} tool call${items.length === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}`}</Text>
        </View>
        {items.map((it) => (
          <ToolCall key={`${it.run ?? ""}:${it.i}`} theme={theme} item={it} now={now} allOpen={allOpen} />
        ))}
      </View>
    </View>
  );
}

function Agent({ theme, item, me, role, now }: { theme: PluginTheme; item: Item; me: string; role: string | undefined; now: number }) {
  const colour = paint(theme, role, me);
  return (
    <Message colour={colour} avatar={<RoleAvatar theme={theme} name={me} role={role} id={me} />}>
      <Header theme={theme} who={me} colour={colour} tags={<Pill theme={theme} label={roleWord(role, me)} colour={colour} filled />} at={item.at} now={now} />
      <Markdown theme={theme} source={item.text} style={{ ...text(theme, "rowTitle"), lineHeight: BODY_LINE }} />
    </Message>
  );
}

function MailIn({ theme, item, role, now }: { theme: PluginTheme; item: Item; role: string | undefined; now: number }) {
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
            {item.reply ? <Pill theme={theme} label={`re ${item.reply}`} icon="Reply" /> : null}
          </>
        }
        at={item.at}
        now={now}
      />
      <Panel theme={theme} tone={colour}>
        <Markdown theme={theme} source={item.text} style={{ ...text(theme, "rowTitle"), lineHeight: BODY_LINE }} />
      </Panel>
    </Message>
  );
}

type Block = { kind: "one"; item: Item } | { kind: "tools"; items: Item[] };

function blocksOf(items: Item[]): Block[] {
  const out: Block[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (it.kind === "tool") {
      if (last?.kind === "tools") last.items.push(it);
      else out.push({ kind: "tools", items: [it] });
    } else out.push({ kind: "one", item: it });
  }
  return out;
}

function Entry({ theme, item, me, role, roles, now }: { theme: PluginTheme; item: Item; me: string; role: string | undefined; roles: Record<string, string>; now: number }) {
  switch (item.kind) {
    case "session":
      return <Quiet theme={theme} icon="Play" label={`Session started${item.text ? ` · ${item.text}` : ""}`} />;
    case "turn":
      return <Quiet theme={theme} icon="Flag" label={`Worked${item.text ? ` · ${item.text}` : ""}`} colour={item.error ? theme.colors.statusDanger : undefined} />;
    case "wake":
      return <Quiet theme={theme} icon="Bell" label={item.text} />;
    case "thinking":
      return <Thought theme={theme} item={item} />;
    case "user":
      return <Human theme={theme} item={item} now={now} />;
    case "mail":
      return <MailIn theme={theme} item={item} role={item.from ? roles[item.from] : undefined} now={now} />;
    case "assistant":
      return <Agent theme={theme} item={item} me={me} role={role} now={now} />;
    case "tool":
      return null;
  }
}

function legendOf(theme: PluginTheme, value: Transcript): { label: string; colour: string }[] {
  const seen = new Map<string, string>();
  const add = (role: string | undefined, id: string) => {
    const label = roleWord(role, id);
    if (!seen.has(label)) seen.set(label, paint(theme, role, id));
  };
  for (const it of value.items) {
    if (it.kind === "user") add(HUMAN, HUMAN);
    else if (it.kind === "assistant") add(value.role, value.name);
    else if (it.kind === "mail" && it.from) add(value.roles?.[it.from], it.from);
  }
  return [...seen].map(([label, colour]) => ({ label, colour }));
}

export function TranscriptView({ theme, id, embedded, extra, hideFrom }: { theme: PluginTheme; id: string; embedded?: boolean; /** Mail between the person and this session, drawn among its items (sessions.tsx). */ extra?: Item[]; /** The person's piggery name: the session's copies of their mail are left out. */ hideFrom?: string }) {
  const [limit, setLimit] = useState(PAGE);
  const [tools, setTools] = useState(true);
  const [allOpen, setAllOpen] = useState(false);
  const now = useNow(30000);
  const { value, error } = useTranscript(id, limit);
  const pad = embedded ? 0 : SPACING[4];
  const items = mergeItems(value?.items ?? [], extra ?? [], hideFrom).filter((it) => tools || (it.kind !== "tool" && it.kind !== "turn" && it.kind !== "wake" && it.kind !== "thinking"));
  const more = value !== null && value.total > value.items.length;
  const blocks = blocksOf(items);
  const toolCount = (value?.items ?? []).filter((i) => i.kind === "tool").length;
  const frame = embedded ? {} : { width: "100%" as const, maxWidth: READABLE + SPACING[8], alignSelf: "center" as const };
  return (
    <View style={[{ gap: SPACING[2], paddingHorizontal: pad }, frame]}>
      {value ? (
        <View style={{ gap: SPACING[2], paddingTop: embedded ? 0 : SPACING[2] }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACING[2] }}>
            <Pill theme={theme} label={`${value.total} entries`} icon="List" />
            <Pill theme={theme} label={`${value.files} run${value.files === 1 ? "" : "s"}`} icon="History" />
            <View style={{ flex: 1 }} />
            {toolCount > 0 ? <Chip theme={theme} label={allOpen ? "Collapse tools" : "Expand tools"} on={allOpen} onPress={() => setAllOpen(!allOpen)} /> : null}
            <Chip theme={theme} label={tools ? "Conversation only" : "Everything"} on={!tools} onPress={() => setTools(!tools)} />
          </View>
          <Legend theme={theme} entries={legendOf(theme, value)} />
        </View>
      ) : null}
      {error && !value ? <Notice theme={theme} kind={error.code} detail={error.message} /> : null}
      {!value && !error ? <Notice theme={theme} kind="loading" /> : null}
      {error && value ? <Text style={text(theme, "label", "statusWarning")}>{`Showing the last read: ${error.message}`}</Text> : null}
      {more ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2] }}>
          <Chip theme={theme} label="Load earlier" on={false} onPress={() => setLimit(limit + PAGE)} />
          <Text style={[text(theme, "label"), { fontVariant: ["tabular-nums"] }]}>{`showing the last ${value?.items.length ?? 0} of ${value?.total ?? 0}`}</Text>
        </View>
      ) : null}
      {value && items.length === 0 ? <Text style={[text(theme, "meta"), { paddingVertical: SPACING[3] }]}>Nothing to show yet.</Text> : null}
      <View>
        {blocks.map((b, i) => {
          const first = b.kind === "one" ? b.item : b.items[0];
          const previous = blocks[i - 1];
          const previousAt = previous === undefined ? undefined : previous.kind === "one" ? previous.item.at : previous.items[0].at;
          const newDay = first.at !== undefined && (previousAt === undefined || !sameDay(previousAt, first.at));
          return (
            <View key={`${first.run ?? ""}:${first.i}`}>
              {newDay ? <DayDivider theme={theme} label={dayLabel(first.at as number, now)} /> : null}
              {b.kind === "tools" ? <ToolGroup theme={theme} items={b.items} now={now} allOpen={allOpen} /> : <Entry theme={theme} item={b.item} me={value?.name ?? ""} role={value?.role} roles={value?.roles ?? {}} now={now} />}
            </View>
          );
        })}
      </View>
    </View>
  );
}
