import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { Usage } from "../shared/context-meter.ts";
import type { Conversation } from "../shared/conversations.ts";
import type { MailMessage } from "../shared/mail.ts";
import { stepInsOf, turnOf, type Native } from "../shared/native.ts";
import { mail, type AttachmentData, type ImageData } from "../shared/rpc.ts";
import { replyTarget, type Me } from "../shared/mail.ts";
import { FileDropZone } from "./attachments-drop.tsx";
import { ChatHead } from "./chat-head.tsx";
import { submitToAgent, useMountedTimeline, useSendMailTo } from "./chat-send.ts";
import { ChatPaneScope } from "./chat-pane-scope.tsx";
import { Composer, canAttach } from "./composer.tsx";
import { SessionContextMeter } from "./context-meter.tsx";
import { AgentContextMeter, AgentControls } from "./controls.tsx";
import { KeyboardAvoidingPane } from "./kit/keyboard-pane.tsx";
import { hovered } from "./kit/press.tsx";
import { RADIUS, SPACING, text, tint } from "./kit/theme.ts";
import { useStop, type NativeChat, type Stop } from "./native.tsx";
import { BUSY_MS, usePoll } from "./poll.ts";
import { useWithPromptImages } from "./prompt-images.ts";
import { RewindMenu } from "./rewind.tsx";
import { KillDialog, ModelDialog, ReleaseDialog, ResumeDialog, StepInNotice, stepInItems, useHeld, useStepIn, type StepInDialog } from "./step-in.tsx";
import { StreamView } from "./stream.tsx";
import type { ViewportHandle } from "./stream-viewport.tsx";
import { useAgentTimeline, type AgentTimeline } from "./timeline.ts";
import { useHasComposerTracks } from "./tracks.tsx";
import { MailStream } from "./transcript.tsx";

function useThread(me: Me | null, id: string, bump: number): MailMessage[] {
  const call = useRpc(mail);
  const { value } = usePoll(
    async () => {
      if (!me) return { ok: true as const, value: [] as MailMessage[] };
      const r = await call({ participants: [me.id], participant: id, limit: 200 });
      return r.ok ? { ok: true as const, value: r.messages } : r;
    },
    `thread:${me?.id ?? ""}:${id}:${bump}`,
    () => BUSY_MS,
  );
  return value ?? [];
}

function gateOf(item: Conversation, all: Conversation[]): Conversation | undefined {
  const gates = all.filter((c) => c.teamKey === item.teamKey && c.row.gate === true);
  return gates.find((c) => c.row.status !== "gone") ?? gates[0];
}

function StopTurn({ theme, stop }: { theme: PluginTheme; stop: Stop }) {
  const toast = useToast();
  const [stopping, setStopping] = useState(false);
  const press = async () => {
    setStopping(true);
    const failed = await stop.onStop();
    if (failed) toast.error(failed);
    setStopping(false);
  };
  return (
    <Pressable onPress={() => void press()} disabled={stopping} accessibilityRole="button" accessibilityLabel={stopping ? "Canceling agent" : "Stop agent"} style={(state) => ({ flexDirection: "row", alignItems: "center", gap: SPACING[1.5], paddingHorizontal: SPACING[3], paddingVertical: SPACING[1.5], borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.colors.statusDanger, backgroundColor: hovered(state) ? tint(theme.colors.statusDanger) : "transparent", opacity: stopping ? 0.5 : 1 })}>
      <Icon name={stopping ? "Loader" : "Square"} size={12} color={theme.colors.statusDanger} />
      <Text style={[text(theme, "label"), { color: theme.colors.statusDanger }]}>Stop</Text>
    </Pressable>
  );
}

function ThroughGate({ theme, gate, stop, onPick, trailing }: { theme: PluginTheme; gate: Conversation | undefined; stop: Stop | undefined; onPick: (id: string) => void; trailing?: ReactNode }) {
  const words = gate ? `You talk to this team through ${gate.row.name}${gate.row.role ? ` (${gate.row.role})` : ""}` : "This team has no gate you can write to";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[3], borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface0, paddingHorizontal: SPACING[4], paddingVertical: SPACING[3] }}>
      <Pressable onPress={gate ? () => onPick(gate.row.id) : undefined} disabled={!gate} accessibilityRole={gate ? "button" : undefined} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING[1.5] }}>
        <Icon name="DoorOpen" size={12} color={theme.colors.foregroundMuted} />
        <Text style={[text(theme, "label"), { flexShrink: 1 }]} numberOfLines={1}>
          {words}
        </Text>
        {gate ? <Icon name="ChevronRight" size={12} color={theme.colors.foregroundMuted} /> : null}
      </Pressable>
      {stop?.running ? <StopTurn theme={theme} stop={stop} /> : null}
      {trailing}
    </View>
  );
}

function hintOf(item: Conversation, native: Native, me: Me | null): string | undefined {
  if (native.kind === "open") return undefined;
  const keys = canAttach ? "Enter sends · paste images or + to attach" : "Enter sends";
  const why = native.kind === "mail" ? ` (${native.why})` : "";
  const who = me ? `you write as ${me.name}` : "your first message joins piggery as a solo session of yours";
  return `Piggery mail to ${item.row.name}${why} · ${who} · attachments go as file paths and links · ${keys}`;
}

function OpenStream({ theme, id, timeline, cwd, draftKey, viewportRef }: { theme: PluginTheme; id: string; timeline: AgentTimeline; cwd: string; draftKey: string; viewportRef: { current: ViewportHandle | null } }) {
  const composerTracks = useHasComposerTracks(timeline.agentId);
  const { tail, head } = useWithPromptImages(id, timeline.tail, timeline.head);
  return (
    <StreamView
      theme={theme}
      streamKey={timeline.agentId}
      tail={tail}
      head={head}
      turn={timeline.turn}
      cwd={timeline.agent?.cwd ?? cwd}
      permissions={timeline.permissions}
      pendingClientMessageIds={timeline.pendingClientMessageIds}
      history={{ hasOlder: timeline.hasOlder, isLoadingOlder: timeline.isLoadingOlder, progressKey: timeline.progressKey, loadOlder: timeline.loadOlder }}
      syncError={timeline.error ? { message: timeline.error, onRetry: timeline.retry } : null}
      onRespond={timeline.respond}
      viewportRef={viewportRef}
      outline={{ agentId: timeline.agentId, epoch: timeline.epoch, fetchPromptWindow: timeline.jumpToPrompt }}
      composerTracks={composerTracks}
      renderUserActions={(message) => (message.messageId ? <RewindMenu theme={theme} capabilities={timeline.agent?.capabilities} agentId={timeline.agentId} messageId={message.messageId} rewoundText={message.text} draftKey={draftKey} onRewound={timeline.refetchTail} /> : null)}
    />
  );
}

function OpenChat({ agentId, children }: { agentId: string; children: (timeline: AgentTimeline) => ReactNode }) {
  const timeline = useAgentTimeline(agentId);
  useMountedTimeline(timeline);
  return <>{children(timeline)}</>;
}

export function Chat({ theme, item, all, me, chat, onSent, onPick, onBack, onInfo }: { theme: PluginTheme; item: Conversation; all: Conversation[]; me: Me | null; chat: NativeChat; onSent: () => void; onPick: (id: string) => void; onBack?: () => void; onInfo: () => void }) {
  const native = chat.of(item.row.id);
  if (native.kind === "open") {
    return (
      <OpenChat key={native.agentId} agentId={native.agentId}>
        {(timeline) => <ChatPane theme={theme} item={item} all={all} me={me} chat={chat} native={native} timeline={timeline} onSent={onSent} onPick={onPick} onBack={onBack} onInfo={onInfo} />}
      </OpenChat>
    );
  }
  return <ChatPane theme={theme} item={item} all={all} me={me} chat={chat} native={native} timeline={null} onSent={onSent} onPick={onPick} onBack={onBack} onInfo={onInfo} />;
}

function ChatPane({ theme, item, all, me, chat, native, timeline, onSent, onPick, onBack, onInfo }: { theme: PluginTheme; item: Conversation; all: Conversation[]; me: Me | null; chat: NativeChat; native: Native; timeline: AgentTimeline | null; onSent: () => void; onPick: (id: string) => void; onBack?: () => void; onInfo: () => void }) {
  const turn = turnOf(item.row);
  const stop = useStop(item.row.id, native, turn.active);
  const [heldBump, setHeldBump] = useState(0);
  const held = useHeld(item.row.id, heldBump);
  const step = useStepIn(item.row.name, () => setHeldBump((n) => n + 1));
  const [dialog, setDialog] = useState<StepInDialog>(null);
  const steps = stepInItems(theme, stepInsOf(item.row, chat.session(item.row.id)), held.length, step.busy, setDialog);
  const target = { ...step, id: item.row.id };
  const [bump, setBump] = useState(0);
  const paseo = usePaseo();
  const sendMailTo = useSendMailTo();
  const writable = item.row.kind === "solo" || item.row.gate === true;
  const thread = useThread(me, item.row.id, bump);
  const viewportRef = useRef<ViewportHandle | null>(null);
  const [logUsage, setLogUsage] = useState<Usage | null>(null);
  const sent = () => {
    viewportRef.current?.scrollToBottom();
    setBump((n) => n + 1);
    onSent();
  };
  const send = async (body: string, images: ImageData[], attachments: AttachmentData[]): Promise<string | null> => {
    const reply = me ? replyTarget(thread, item.row.id) : undefined;
    const failed = native.kind === "open" && timeline ? await submitToAgent({ paseo, agentId: native.agentId, timeline, body, images, attachments }) : await sendMailTo({ to: item.row.id, body, images, attachments, ...(reply ? { replySeq: reply.seq } : {}) });
    if (failed) return failed;
    sent();
    return null;
  };
  const ended = item.row.status === "gone" && native.kind !== "open";
  return (
    <FileDropZone theme={theme} style={{ flex: 1, minWidth: 0 }}>
    <ChatPaneScope>
    <KeyboardAvoidingPane>
      <ChatHead theme={theme} item={item} native={native} chat={chat} writable={writable} steps={steps} onBack={onBack} onInfo={onInfo} />
      {timeline ? <OpenStream theme={theme} id={item.row.id} timeline={timeline} cwd={item.dir.path} draftKey={item.row.id} viewportRef={viewportRef} /> : <MailStream theme={theme} id={item.row.id} refresh={bump} working={turn.active} workingSince={item.row.state_since} cwd={item.dir.path} viewportRef={viewportRef} onUsage={setLogUsage} />}
      {step.note ? <StepInNotice theme={theme} note={step.note} onDismiss={step.dismiss} /> : null}
      {writable ? (
        <Composer key={item.row.id} draftKey={item.row.id} cwd={item.dir.path} theme={theme} placeholder={ended ? "This session has ended" : `Message ${item.row.name}`} disabled={!chat.ready || ended} hint={hintOf(item, native, me)} controls={native.kind === "open" ? ({ isCompactLayout }) => <AgentControls theme={theme} agentId={native.agentId} isCompactLayout={isCompactLayout} /> : undefined} trailing={native.kind === "open" ? ({ isCompactLayout }) => <AgentContextMeter theme={theme} agentId={native.agentId} isCompactLayout={isCompactLayout} /> : ({ isCompactLayout }) => <SessionContextMeter theme={theme} usage={logUsage} status={turn.meterStatus} isCompactLayout={isCompactLayout} />} stop={stop} agent={native.kind === "open" && timeline ? { agentId: native.agentId, participantId: item.row.id, timeline, open: chat.canOpen ? chat.open : undefined } : undefined} onSend={send} />
      ) : (
        <ThroughGate theme={theme} gate={gateOf(item, all)} stop={stop} onPick={onPick} trailing={timeline ? undefined : <SessionContextMeter theme={theme} usage={logUsage} status={turn.meterStatus} isCompactLayout={false} />} />
      )}
      <KillDialog theme={theme} name={item.row.name} open={dialog === "kill"} step={target} onClose={() => setDialog(null)} />
      <ModelDialog theme={theme} name={item.row.name} current={item.row.model} open={dialog === "model"} step={target} onClose={() => setDialog(null)} />
      <ResumeDialog theme={theme} name={item.row.name} open={dialog === "resume"} step={target} onClose={() => setDialog(null)} />
      <ReleaseDialog theme={theme} held={held} open={dialog === "release"} step={step} onClose={() => setDialog(null)} />
    </KeyboardAvoidingPane>
    </ChatPaneScope>
    </FileDropZone>
  );
}
