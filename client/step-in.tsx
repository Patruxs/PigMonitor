import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { MailMessage } from "../shared/mail.ts";
import { releasable, type StepIns } from "../shared/native.ts";
import { mail, models, stepIn, THINKING_LEVELS } from "../shared/rpc.ts";
import type { MenuItem } from "./kit/menu.tsx";
import { Actions, Button } from "./kit/button.tsx";
import { ConfirmDialog } from "./kit/confirm.tsx";
import { ICON_SIZE, RADIUS, SPACING, text, tint } from "./kit/theme.ts";
import { QUIET_MS, usePoll } from "./poll.ts";

export type StepInDialog = "kill" | "model" | "resume" | "release" | null;

type ThinkingLevel = (typeof THINKING_LEVELS)[number];

type StepInInput = { verb: "kill" | "resume" | "release"; id: string } | { verb: "model"; id: string; model?: string; thinking?: ThinkingLevel };

export interface StepInNote {
  text: string;
  error: boolean;
}

export interface StepIn {
  busy: boolean;
  note: StepInNote | null;
  dismiss: () => void;
  run: (input: StepInInput) => Promise<boolean>;
}

export function useStepIn(name: string, onDone: () => void): StepIn {
  const call = useRpc(stepIn);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<StepInNote | null>(null);
  return {
    busy,
    note,
    dismiss: () => setNote(null),
    run: async (input) => {
      setBusy(true);
      setNote(null);
      const r = await call(input);
      setNote(r.ok ? { text: (r.said || `${input.verb} done.`).replaceAll(input.id, name), error: false } : { text: r.error.replaceAll(input.id, name), error: true });
      setBusy(false);
      onDone();
      return r.ok;
    },
  };
}

export function useHeld(id: string, bump: number): MailMessage[] {
  const call = useRpc(mail);
  const { value } = usePoll(
    async () => {
      const r = await call({ participant: id, held: true, limit: 50 });
      return r.ok ? { ok: true as const, value: r.messages.filter((m) => releasable(m, r.teams)) as MailMessage[] } : r;
    },
    `held:${id}:${bump}`,
    () => QUIET_MS,
  );
  return value ?? [];
}

export function stepInItems(theme: PluginTheme, steps: StepIns, held: number, busy: boolean, open: (dialog: Exclude<StepInDialog, null>) => void): MenuItem[] {
  const muted = theme.colors.foregroundMuted;
  const icon = (name: string, colour = muted) => <Icon name={name} size={ICON_SIZE.md} color={colour} />;
  const items: MenuItem[] = [];
  if (steps.model) items.push({ id: "model", label: "Switch model or thinking…", icon: icon("Cpu"), disabled: busy, onSelect: () => open("model") });
  if (steps.resume) items.push({ id: "resume-team", label: "Resume in its team…", icon: icon("RotateCcw"), disabled: busy, onSelect: () => open("resume") });
  if (held > 0) items.push({ id: "release", label: `Release held mail (${held})…`, icon: icon("MailCheck"), disabled: busy, onSelect: () => open("release") });
  if (steps.kill) items.push({ id: "kill", label: "Kill worker…", icon: icon("OctagonX", theme.colors.statusDanger), disabled: busy, onSelect: () => open("kill") });
  return items;
}

export function KillDialog({ theme, name, open, step, onClose }: { theme: PluginTheme; name: string; open: boolean; step: StepIn & { id: string }; onClose: () => void }) {
  return (
    <ConfirmDialog theme={theme} title={`Kill ${name}?`} icon="OctagonX" tone="danger" confirmLabel={`Kill ${name}`} busy={step.busy} open={open} onConfirm={() => void step.run({ verb: "kill", id: step.id }).then(onClose)} onClose={onClose}>
      <Text style={text(theme, "rowTitle")}>piggery ends its process group now (SIGKILL). The turn it is on is lost and its mail stays unacked.</Text>
      <Text style={text(theme, "meta")}>Resume in its team starts it again in the same session.</Text>
    </ConfirmDialog>
  );
}

export function ResumeDialog({ theme, name, open, step, onClose }: { theme: PluginTheme; name: string; open: boolean; step: StepIn & { id: string }; onClose: () => void }) {
  return (
    <ConfirmDialog theme={theme} title={`Resume ${name}?`} icon="RotateCcw" tone="primary" confirmLabel={`Resume ${name}`} busy={step.busy} open={open} onConfirm={() => void step.run({ verb: "resume", id: step.id }).then(onClose)} onClose={onClose}>
      <Text style={text(theme, "rowTitle")}>piggery starts it again in its session, with its stored model and thinking level. That is a new paid run.</Text>
      <Text style={text(theme, "meta")}>It reads its pending mail first; it gets no new task.</Text>
    </ConfirmDialog>
  );
}

function useModels(id: string, open: boolean): { list: string[] | null; error: string | null } {
  const call = useRpc(models);
  const [state, setState] = useState<{ list: string[] | null; error: string | null }>({ list: null, error: null });
  useEffect(() => {
    if (!open) return;
    let live = true;
    setState({ list: null, error: null });
    void call({ id }).then((r) => live && setState(r.ok ? { list: r.models, error: null } : { list: [], error: r.error }));
    return () => {
      live = false;
    };
  }, [id, open]);
  return state;
}

function Choice({ theme, label, on, hint, onPress }: { theme: PluginTheme; label: string; on: boolean; hint?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={label} style={(state) => ({ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingHorizontal: SPACING[2], paddingVertical: SPACING[1.5], borderRadius: RADIUS.md, backgroundColor: on || state.pressed ? theme.colors.surface2 : "transparent" })}>
      <Icon name={on ? "CircleDot" : "Circle"} size={ICON_SIZE.sm} color={on ? theme.colors.accent : theme.colors.foregroundMuted} />
      <Text style={[text(theme, "rowTitle"), { flex: 1, minWidth: 0 }]} numberOfLines={1}>
        {label}
      </Text>
      {hint ? <Text style={text(theme, "label")}>{hint}</Text> : null}
    </Pressable>
  );
}

export function ModelDialog({ theme, name, current, open, step, onClose }: { theme: PluginTheme; name: string; current: string | undefined; open: boolean; step: StepIn & { id: string }; onClose: () => void }) {
  const { list, error } = useModels(step.id, open);
  const [model, setModel] = useState<string | null>(null);
  const [thinking, setThinking] = useState<ThinkingLevel | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (open) return;
    setModel(null);
    setThinking(null);
    setConfirming(false);
  }, [open]);
  const what = [model ? model : null, thinking ? `thinking ${thinking}` : null].filter(Boolean).join(", ");
  const apply = () => void step.run({ verb: "model", id: step.id, ...(model ? { model } : {}), ...(thinking ? { thinking } : {}) }).then(onClose);
  return (
    <Modal title={`Model of ${name}`} icon={<Icon name="Cpu" size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />} open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content contentContainerStyle={{ padding: SPACING[3], gap: SPACING[3] }}>
        {confirming ? (
          <>
            <Text style={text(theme, "rowTitle")}>{`Switch ${name} to ${what}?`}</Text>
            <Text style={text(theme, "meta")}>A running worker switches from its next turn and keeps its context; the harness may refuse a level its model does not run, and then nothing changes.</Text>
            <Actions>
              <Button theme={theme} label="Back" disabled={step.busy} onPress={() => setConfirming(false)} />
              <Button theme={theme} label="Switch" icon="Check" tone="primary" busy={step.busy} onPress={apply} />
            </Actions>
          </>
        ) : (
          <>
            <View style={{ gap: SPACING[1] }}>
              <Text style={text(theme, "section")}>Model</Text>
              {list === null ? <ActivityIndicator size="small" color={theme.colors.foregroundMuted} /> : null}
              {error ? <Text style={text(theme, "label", "statusDanger")}>{error}</Text> : null}
              {(list ?? []).map((m) => (
                <Choice key={m} theme={theme} label={m} on={model === m} hint={m === current ? "now" : undefined} onPress={() => setModel(model === m ? null : m)} />
              ))}
            </View>
            <View style={{ gap: SPACING[1] }}>
              <Text style={text(theme, "section")}>Thinking</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACING[1.5] }}>
                {THINKING_LEVELS.map((level) => (
                  <Pressable key={level} onPress={() => setThinking(thinking === level ? null : level)} accessibilityRole="radio" accessibilityState={{ checked: thinking === level }} style={{ paddingHorizontal: SPACING[2], paddingVertical: SPACING[1], borderRadius: RADIUS.md, borderWidth: 1, borderColor: thinking === level ? theme.colors.accent : theme.colors.border, backgroundColor: thinking === level ? tint(theme.colors.accent) : "transparent" }}>
                    <Text style={text(theme, "label", thinking === level ? "foreground" : undefined)}>{level}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <Actions>
              <Button theme={theme} label="Cancel" onPress={onClose} />
              <Button theme={theme} label="Continue" tone="primary" disabled={!what} onPress={() => setConfirming(true)} />
            </Actions>
          </>
        )}
      </Modal.Content>
    </Modal>
  );
}

export function ReleaseDialog({ theme, held, open, step, onClose }: { theme: PluginTheme; held: MailMessage[]; open: boolean; step: StepIn; onClose: () => void }) {
  return (
    <Modal title="Held mail" icon={<Icon name="MailCheck" size={ICON_SIZE.md} color={theme.colors.foregroundMuted} />} open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Modal.Content contentContainerStyle={{ padding: SPACING[3], gap: SPACING[2] }}>
        {held.length === 0 ? <Text style={text(theme, "meta")}>Nothing is held now.</Text> : null}
        {held.map((m) => (
          <View key={m.id} style={{ gap: SPACING[1], padding: SPACING[2], borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.lg }}>
            <Text style={text(theme, "label")} numberOfLines={1}>{`#${m.seq} ${m.from_name} → ${m.to_name} · held: ${m.held}`}</Text>
            <Text style={text(theme, "rowTitle")} numberOfLines={3}>
              {m.body}
            </Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
              <Button theme={theme} label="Release" icon="Send" busy={step.busy} onPress={() => void step.run({ verb: "release", id: m.id })} />
            </View>
          </View>
        ))}
      </Modal.Content>
    </Modal>
  );
}

export function StepInNotice({ theme, note, onDismiss }: { theme: PluginTheme; note: StepInNote; onDismiss: () => void }) {
  const colour = note.error ? theme.colors.statusDanger : theme.colors.foregroundMuted;
  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingHorizontal: SPACING[4], paddingVertical: SPACING[2], borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: note.error ? tint(theme.colors.statusDanger, "14") : theme.colors.surface0 }}>
      <Icon name={note.error ? "TriangleAlert" : "Check"} size={ICON_SIZE.sm} color={colour} />
      <Text selectable style={[text(theme, "label"), { flex: 1, minWidth: 0, color: note.error ? theme.colors.statusDanger : theme.colors.foreground }]}>
        {note.text}
      </Text>
      <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={SPACING[2]}>
        <Icon name="X" size={ICON_SIZE.sm} color={theme.colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}
