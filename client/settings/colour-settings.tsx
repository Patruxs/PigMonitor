import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { exportPalette, importPalette, mergePalette, PALETTE_KEYS, parseTeamHues, resetPalette, resetPaletteValue, setPaletteValue, valueError, type PaletteKey, type PaletteOverrides } from "../../shared/palette.ts";
import { colourSettings } from "../../shared/rpc.ts";
import { SectionTitle } from "../kit/section.tsx";
import { RADIUS, SPACING, text } from "../kit/theme.ts";
import { resolveColour } from "../piggery/palette.tsx";

const LABELS: Record<PaletteKey, string> = {
  working: "Working",
  waiting: "Waiting",
  idle: "Idle",
  gone: "Exited",
  supervisor: "Supervisor (chair)",
  lead: "Lead",
  peer: "Peer",
  executor: "Executor (member)",
  advisor: "Advisor (oracle, reviewer)",
  mail: "Unread mail",
  mailHeld: "Held mail",
  team: "Teams tile",
  teamHues: "Team lanes (1 to 8 hex, comma-separated)",
};

const SWATCH = 22;

function copyText(value: string): Promise<void> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  return clipboard ? clipboard.writeText(value) : Promise.reject(new Error("Clipboard unavailable"));
}

function Swatches({ theme, colours }: { theme: PluginTheme; colours: string[] | null }) {
  if (!colours) return <View accessibilityLabel="not a colour" style={{ width: SWATCH, height: SWATCH, borderRadius: RADIUS.md, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.statusDanger }} />;
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {colours.map((colour, i) => (
        <View key={i} accessibilityLabel={colour} style={{ width: colours.length > 1 ? SWATCH / 2 : SWATCH, height: SWATCH, borderRadius: RADIUS.md, backgroundColor: colour, borderWidth: 1, borderColor: theme.colors.border }} />
      ))}
    </View>
  );
}

function SmallButton({ theme, label, disabled, onPress }: { theme: PluginTheme; label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={{ paddingHorizontal: SPACING[2], paddingVertical: SPACING[1], borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: disabled ? "transparent" : theme.colors.surface2, opacity: disabled ? 0.5 : 1 }}>
      <Text style={text(theme, "meta", disabled ? "foregroundMuted" : "foreground")}>{label}</Text>
    </Pressable>
  );
}

function ColourRow({ theme, name, value, overridden, onChange, onReset }: { theme: PluginTheme; name: PaletteKey; value: string; overridden: boolean; onChange: (value: string) => void; onReset: () => void }) {
  const valid = valueError(name, value) === null;
  const colours = !valid ? null : name === "teamHues" ? parseTeamHues(value) : [resolveColour(theme, value.trim())];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], flexWrap: "wrap" }}>
      <Swatches theme={theme} colours={colours} />
      <Text style={[text(theme, "rowTitle"), { width: 200 }]} numberOfLines={2}>
        {LABELS[name]}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel={`${LABELS[name]} colour`}
        autoCapitalize="none"
        autoCorrect={false}
        style={[text(theme, "code"), { flex: 1, minWidth: 160, borderWidth: 1, borderColor: valid ? theme.colors.border : theme.colors.statusDanger, borderRadius: RADIUS.md, paddingHorizontal: SPACING[2], paddingVertical: SPACING[1.5] }]}
      />
      <SmallButton theme={theme} label="Reset" disabled={!overridden} onPress={onReset} />
    </View>
  );
}

export function ColourSettings({ theme }: { theme: PluginTheme }) {
  const state = useSettings(colourSettings);
  const toast = useToast();
  const [drafts, setDrafts] = useState<Partial<Record<PaletteKey, string>>>({});
  const [pasted, setPasted] = useState("");
  if (state.status !== "ready") {
    return <Text style={text(theme, "meta", state.status === "loading" ? "foregroundMuted" : "statusDanger")}>{state.status === "loading" ? "Loading colours…" : state.error}</Text>;
  }
  const overrides: PaletteOverrides = state.values;
  const effective = mergePalette(overrides);
  const edited = Object.keys(drafts).length > 0;
  const save = async (next: PaletteOverrides, done: string) => {
    if (await state.save(next, state.revision)) {
      setDrafts({});
      toast.show(done);
    } else toast.error(state.saveError ?? "Could not save the colours.");
  };
  const saveEdits = () => {
    let next = overrides;
    for (const key of PALETTE_KEYS) {
      const draft = drafts[key];
      if (draft === undefined) continue;
      const change = setPaletteValue(next, key, draft);
      if (!change.ok) return toast.error(change.error);
      next = change.overrides;
    }
    void save(next, "Colours saved");
  };
  const pastePalette = () => {
    const change = importPalette(pasted);
    if (!change.ok) return toast.error(change.error);
    setPasted("");
    void save(change.overrides, "Palette applied");
  };
  return (
    <View style={{ gap: SPACING[3] }}>
      <View style={{ marginHorizontal: -SPACING[4] }}>
        <SectionTitle theme={theme} icon="Palette" title="Colours" />
      </View>
      <Text style={text(theme, "meta")}>A hex colour (#rgb, #rrggbb, #rrggbbaa) or a Paseo theme token such as statusSuccess or accent. Fills and borders are made from these.</Text>
      {PALETTE_KEYS.map((key) => (
        <ColourRow
          key={key}
          theme={theme}
          name={key}
          value={drafts[key] ?? effective[key]}
          overridden={overrides[key] !== undefined}
          onChange={(value) => setDrafts((d) => ({ ...d, [key]: value }))}
          onReset={() => {
            setDrafts((d) => {
              const { [key]: _dropped, ...rest } = d;
              return rest;
            });
            void save(resetPaletteValue(overrides, key), `${LABELS[key]} reset`);
          }}
        />
      ))}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACING[2] }}>
        <SmallButton theme={theme} label={state.saving ? "Saving…" : "Save colours"} disabled={!edited || state.saving} onPress={saveEdits} />
        <SmallButton theme={theme} label="Reset all" disabled={Object.keys(overrides).length === 0 && !edited} onPress={() => void save(resetPalette(), "Colours reset to the defaults")} />
        <SmallButton theme={theme} label="Copy palette as JSON" onPress={() => void copyText(exportPalette(overrides)).then(() => toast.show("Palette copied"), () => toast.error("Could not copy the palette"))} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], flexWrap: "wrap" }}>
        <TextInput
          value={pasted}
          onChangeText={setPasted}
          accessibilityLabel="Palette JSON"
          placeholder="Paste palette JSON here"
          placeholderTextColor={theme.colors.foregroundMuted}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          style={[text(theme, "code"), { flex: 1, minWidth: 220, minHeight: 36, borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING[2], paddingVertical: SPACING[1.5] }]}
        />
        <SmallButton theme={theme} label="Paste palette JSON" disabled={pasted.trim() === "" || state.saving} onPress={pastePalette} />
      </View>
    </View>
  );
}
