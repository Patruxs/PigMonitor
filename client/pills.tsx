import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { agentConfig } from "../shared/rpc.ts";
import { PressRow } from "./kit/press.tsx";
import { ICON_SIZE, RADIUS, ROW_MIN, SPACING, text } from "./kit/theme.ts";
import { BUSY_MS, usePoll } from "./poll.ts";

const MODELS_MS = 10 * 60 * 1000;
const PILL_HEIGHT = 28;

type Field = "model" | "thinking" | "mode";

interface Choice {
  value: string;
  label: string;
}

function hoveredOf(state: PressableStateCallbackType): boolean {
  return (state as PressableStateCallbackType & { hovered?: boolean }).hovered === true;
}

function messageOf(error: unknown): string {
  return String((error as Error)?.message ?? error);
}

function PillSelect({ theme, title, icon, value, choices, busy, onPick }: { theme: PluginTheme; title: string; icon: string; value: string | null; choices: Choice[]; busy: boolean; onPick: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const label = choices.find((c) => c.value === value)?.label ?? value ?? "Default";
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={busy || choices.length === 0}
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${label}`}
        style={(state) => ({ flexDirection: "row", alignItems: "center", gap: SPACING[1], height: PILL_HEIGHT, paddingHorizontal: SPACING[2], borderRadius: PILL_HEIGHT / 2, flexShrink: 1, minWidth: 0, opacity: busy ? 0.5 : 1, backgroundColor: state.pressed || hoveredOf(state) ? theme.colors.surface2 : "transparent" })}
      >
        <Icon name={busy ? "Loader" : icon} size={13} color={theme.colors.foregroundMuted} />
        <Text style={[text(theme, "label"), { flexShrink: 1 }]} numberOfLines={1}>
          {label}
        </Text>
        <Icon name="ChevronDown" size={12} color={theme.colors.foregroundMuted} />
      </Pressable>
      <Modal title={title} open={open} onOpenChange={setOpen}>
        <Modal.Content contentContainerStyle={{ padding: SPACING[2], gap: 0 }}>
          {choices.map((c) => (
            <PressRow
              key={c.value}
              theme={theme}
              onPress={() => {
                setOpen(false);
                if (c.value !== value) onPick(c.value);
              }}
              label={c.label}
              style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], minHeight: ROW_MIN, paddingHorizontal: SPACING[2], borderRadius: RADIUS.md }}
            >
              <View style={{ width: ICON_SIZE.sm }}>{c.value === value ? <Icon name="Check" size={ICON_SIZE.sm} color={theme.colors.foreground} /> : null}</View>
              <Text style={[text(theme, "rowTitle"), { flex: 1, minWidth: 0 }]} numberOfLines={1}>
                {c.label}
              </Text>
            </PressRow>
          ))}
        </Modal.Content>
      </Modal>
    </>
  );
}

export function AgentPills({ theme, agentId }: { theme: PluginTheme; agentId: string }) {
  const paseo = usePaseo();
  const call = useRpc(agentConfig);
  const toast = useToast();
  const [bump, setBump] = useState(0);
  const [busy, setBusy] = useState<Field | null>(null);
  const { value: agent } = usePoll(
    async () => {
      try {
        const r = await paseo.agents.ref(agentId).refresh();
        return r ? { ok: true as const, value: r.agent } : { ok: false as const, code: "failed", error: "Paseo does not know this agent." };
      } catch (error) {
        return { ok: false as const, code: "failed", error: messageOf(error) };
      }
    },
    `agent:${agentId}:${bump}`,
    () => BUSY_MS,
  );
  const provider = agent?.provider;
  const cwd = agent?.cwd;
  const { value: models } = usePoll(
    async () => {
      if (!provider) return { ok: true as const, value: [] };
      try {
        const r = await paseo.providers.listModels(provider, cwd ? { cwd } : undefined);
        return { ok: true as const, value: r.models ?? [] };
      } catch (error) {
        return { ok: false as const, code: "failed", error: messageOf(error) };
      }
    },
    `models:${provider ?? ""}:${cwd ?? ""}`,
    () => MODELS_MS,
  );
  if (!agent) return null;
  const list = (models ?? []).filter((m) => m.isSelectable !== false);
  const model = list.find((m) => m.id === agent.model || m.aliases?.includes(agent.model ?? "")) ?? list.find((m) => m.isDefault);
  const modelChoices = list.map((m) => ({ value: m.id, label: m.label }));
  const thinkingChoices = (model?.thinkingOptions ?? []).map((t) => ({ value: t.id, label: t.label }));
  const thinking = agent.thinkingOptionId ?? agent.effectiveThinkingOptionId ?? model?.defaultThinkingOptionId ?? null;
  const modeChoices = (agent.availableModes ?? []).map((m) => ({ value: m.id, label: m.label }));
  const mode = agent.currentModeId ?? null;
  const set = async (field: Field, value: string) => {
    setBusy(field);
    const r = await call({ agentId, field, value });
    setBusy(null);
    if (!r.ok) toast.error(r.error);
    setBump((n) => n + 1);
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1, minWidth: 0 }}>
      {modelChoices.length > 0 || agent.model ? <PillSelect theme={theme} title="Model" icon="Sparkles" value={model?.id ?? agent.model} choices={modelChoices} busy={busy === "model"} onPick={(v) => void set("model", v)} /> : null}
      {thinkingChoices.length > 0 ? <PillSelect theme={theme} title="Thinking" icon="Brain" value={thinking} choices={thinkingChoices} busy={busy === "thinking"} onPick={(v) => void set("thinking", v)} /> : null}
      {modeChoices.length > 0 ? <PillSelect theme={theme} title="Mode" icon={mode && /bypass/i.test(mode) ? "ShieldOff" : "Shield"} value={mode} choices={modeChoices} busy={busy === "mode"} onPick={(v) => void set("mode", v)} /> : null}
    </View>
  );
}
