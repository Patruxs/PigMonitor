import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Text, useWindowDimensions, View } from "react-native";
import { tail } from "../shared/rpc.ts";
import { turnOf } from "../shared/chat-route.ts";
import { type Detail, type Row, type TailKind, type View as PigView } from "../shared/view.ts";
import { LogStream } from "./transcript.tsx";
import { Pill } from "./kit/pill.tsx";
import { paint, usePalette } from "./palette.tsx";
import { RoleAvatar } from "./piggery/role.tsx";
import { StatusPill } from "./piggery/status.tsx";
import { PressRow } from "./kit/press.tsx";
import { Rows } from "./kit/rows.tsx";
import { SectionTitle } from "./kit/section.tsx";
import { ICON_SIZE, KEY_WIDTH, RADIUS, READABLE, ROW_MIN, SPACING, text } from "./kit/theme.ts";
import { BUSY_MS, usePoll } from "./poll.ts";

export type Index = Map<string, Row>;

export type DialogPage = { kind: "detail"; id: string } | { kind: "tail"; id: string } | { kind: "transcript"; id: string };

const TAIL_COLOUR: Record<TailKind, keyof PluginTheme["colors"]> = {
  tool: "accent",
  result: "foregroundMuted",
  error: "statusDanger",
  warning: "statusWarning",
  rule: "foregroundMuted",
  user: "foregroundMuted",
  text: "foreground",
};

const STEP_ICON: Record<DialogPage["kind"], string> = { detail: "Info", tail: "Terminal", transcript: "MessagesSquare" };

export function DetailDialog({ theme, view, index, root, onClose }: { theme: PluginTheme; view: PigView; index: Index; root: string | null; onClose: () => void }) {
  const [trail, setTrail] = useState<DialogPage[]>([]);
  const [rootFor, setRootFor] = useState<string | null>(root);
  if (rootFor !== root) {
    setRootFor(root);
    setTrail([]);
  }
  const steps: DialogPage[] = root === null ? [] : [{ kind: "detail", id: root }, ...trail];
  const top = steps[steps.length - 1];
  const previous = steps[steps.length - 2];
  const nameOf = (id: string) => view.details[id]?.title ?? index.get(id)?.name ?? "";
  const row = top ? index.get(top.id) : undefined;
  const detail = top ? view.details[top.id] : undefined;
  const title = !top ? "" : top.kind === "tail" ? `Tail · ${nameOf(top.id)}` : top.kind === "transcript" ? `Session · ${nameOf(top.id)}` : (detail?.title ?? row?.name ?? "");
  return (
    <Modal title={title} icon={<Icon name={top ? STEP_ICON[top.kind] : "Info"} size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />} open={root !== null} onOpenChange={(next) => !next && onClose()}>
      <Modal.Content>
        <View style={{ maxWidth: READABLE, width: "100%", alignSelf: "center", gap: SPACING[3] }}>
          {previous ? (
            <PressRow theme={theme} onPress={() => setTrail((t) => t.slice(0, -1))} label={`Back to ${nameOf(previous.id)}`} style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5], paddingVertical: SPACING[1], alignSelf: "flex-start", borderRadius: RADIUS.md }}>
              <Icon name="ChevronLeft" size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />
              <Text style={text(theme, "meta")}>{`Back to ${nameOf(previous.id)}`}</Text>
            </PressRow>
          ) : null}
          {top?.kind === "tail" ? (
            <Tail theme={theme} id={top.id} />
          ) : top?.kind === "transcript" ? (
            <SessionStream theme={theme} id={top.id} row={row} />
          ) : detail ? (
            <Overview theme={theme} detail={detail} row={row} onTail={() => top && setTrail((t) => [...t, { kind: "tail", id: top.id }])} onTranscript={() => top && setTrail((t) => [...t, { kind: "transcript", id: top.id }])} />
          ) : root !== null ? (
            <Text style={text(theme, "meta")}>This row is no longer in piggery's list.</Text>
          ) : null}
        </View>
      </Modal.Content>
    </Modal>
  );
}

function SessionStream({ theme, id, row }: { theme: PluginTheme; id: string; row: Row | undefined }) {
  const { height } = useWindowDimensions();
  return (
    <View style={{ height: Math.max(320, Math.round(height * 0.7)), marginHorizontal: -SPACING[4] }}>
      <LogStream theme={theme} id={id} working={row ? turnOf(row).active : false} workingSince={row?.state_since} />
    </View>
  );
}

function Overview({ theme, detail, row, onTail, onTranscript }: { theme: PluginTheme; detail: Detail; row: Row | undefined; onTail: () => void; onTranscript: () => void }) {
  const palette = usePalette(theme);
  const task = detail.task;
  const facts = detail.facts;
  return (
    <View style={{ gap: SPACING[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: SPACING[2] }}>
        {row && (row.kind === "member" || row.kind === "solo") ? <RoleAvatar theme={theme} name={row.name} role={row.role} id={row.id} dim={row.dim} /> : null}
        {row?.role ? <Pill theme={theme} label={row.role} colour={paint(palette, row.role, row.id)} filled /> : null}
        {row?.gate ? <Pill theme={theme} label="gate" icon="DoorOpen" /> : null}
        {row ? <StatusPill theme={theme} status={row.status} word={row.state_text} dim={row.dim} /> : null}
        {detail.sub ? <Text style={text(theme, "meta")}>{detail.sub}</Text> : null}
      </View>
      {task ? (
        <View>
          <SectionTitle theme={theme} icon="ListChecks" title="Task" />
          <View style={{ paddingHorizontal: SPACING[4], gap: SPACING[0.5] }}>
            <Text style={text(theme, "rowTitle")}>{task.title}</Text>
            <Text style={text(theme, "meta")}>{task.from}</Text>
            {task.chain ? <Text style={text(theme, "meta")}>{task.chain}</Text> : null}
            {task.mail ? <Text style={text(theme, "meta")}>{`${task.mail.head} ${task.mail.title}${task.mail.tail}`}</Text> : null}
          </View>
        </View>
      ) : null}
      {facts.length > 0 ? (
        <Rows theme={theme}>
          {facts.map((f, i) => (
            <View key={`${f.label}:${i}`} style={{ flexDirection: "row", gap: SPACING[3], minHeight: SPACING[8], alignItems: "flex-start", paddingHorizontal: SPACING[4], paddingVertical: SPACING[1.5] }}>
              <Text style={[text(theme, "label"), { width: KEY_WIDTH, paddingTop: SPACING[0.5] }]} numberOfLines={1}>
                {f.label}
              </Text>
              <Text style={[text(theme, "rowTitle", f.muted ? "foregroundMuted" : "foreground"), { flex: 1, minWidth: 0 }]} selectable>
                {f.value}
                {f.note ? <Text style={text(theme, "meta")}>{` ${f.note}`}</Text> : null}
              </Text>
            </View>
          ))}
        </Rows>
      ) : null}
      {detail.hint ? <Text style={text(theme, "label")}>{detail.hint}</Text> : null}
      {row && (row.kind === "member" || row.kind === "solo") ? (
        <PressRow theme={theme} onPress={onTranscript} label="Read the whole session" style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: ROW_MIN, paddingHorizontal: SPACING[4], borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.lg }}>
          <Icon name="MessagesSquare" size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />
          <Text style={[text(theme, "rowTitle"), { flex: 1 }]}>Read the whole session</Text>
          <Icon name="ChevronRight" size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />
        </PressRow>
      ) : null}
      {row?.actions?.tail ? (
        <PressRow theme={theme} onPress={onTail} label="Tail the session" style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: ROW_MIN, paddingHorizontal: SPACING[4], borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.lg }}>
          <Icon name="Terminal" size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />
          <Text style={[text(theme, "rowTitle"), { flex: 1 }]}>Tail the session</Text>
          <Icon name="ChevronRight" size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />
        </PressRow>
      ) : null}
    </View>
  );
}

function Tail({ theme, id }: { theme: PluginTheme; id: string }) {
  const call = useRpc(tail);
  const { value, error } = usePoll(
    async () => {
      const r = await call({ id, lines: 40 });
      return r.ok ? { ok: true as const, value: r.lines } : r;
    },
    id,
    () => BUSY_MS,
  );
  const lines = value ?? [];
  return (
    <View style={{ gap: SPACING[1], backgroundColor: theme.colors.surface1, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: theme.colors.border, padding: SPACING[4] }} accessibilityLabel="Tail of the session">
      {error ? <Text style={text(theme, "meta", "statusDanger")}>{error.message}</Text> : null}
      {value === null && !error ? <Text style={text(theme, "meta")}>Loading…</Text> : null}
      {value !== null && lines.length === 0 ? <Text style={text(theme, "meta")}>No output yet.</Text> : null}
      {lines.map((line, i) => (
        <Text key={i} style={text(theme, "code", TAIL_COLOUR[line.kind])} numberOfLines={4} selectable>
          {line.text}
          {line.rest ? <Text style={text(theme, "code", "foregroundMuted")}>{line.rest}</Text> : null}
        </Text>
      ))}
    </View>
  );
}
