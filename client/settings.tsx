import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { settings } from "../shared/rpc.ts";
import { RADIUS, SPACING, text } from "./kit/theme.ts";
import { NotifyHint } from "./notify.tsx";

function Field({ theme, label, hint, value, placeholder, onChange }: { theme: PluginTheme; label: string; hint: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <View style={{ gap: SPACING[2] }}>
      <Text style={text(theme, "rowTitle")}>{label}</Text>
      <Text style={text(theme, "meta")}>{hint}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        style={[text(theme, "rowTitle"), { borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.md, paddingHorizontal: SPACING[2], paddingVertical: SPACING[1.5] }]}
      />
    </View>
  );
}

/** Settings: which piggery binary to run, and which piggery database to read mail from. */
export function PigMonitorSettings({ theme }: PluginSurfaceProps) {
  const state = useSettings(settings);
  const [path, setPath] = useState<string | null>(null);
  const [database, setDatabase] = useState<string | null>(null);
  if (state.status !== "ready") {
    return <Text style={text(theme, "meta", state.status === "loading" ? "foregroundMuted" : "statusDanger")}>{state.status === "loading" ? "Loading…" : state.error}</Text>;
  }
  const pathValue = path ?? state.values.path;
  const databaseValue = database ?? state.values.database;
  const changed = pathValue.trim() !== state.values.path || databaseValue.trim() !== state.values.database;
  const c = theme.colors;
  return (
    <View style={{ padding: SPACING[3], gap: SPACING[4] }}>
      <Field theme={theme} label="piggery binary" hint="A full path. Leave it empty to use the piggery that installed this plugin, or else the one in the Paseo daemon's PATH." value={pathValue} placeholder="piggery" onChange={setPath} />
      <Field theme={theme} label="piggery database" hint="The piggery.db the Mail tab reads (read-only). Leave it empty for ~/.piggery/piggery.db, or $PIGGERY_HOME/piggery.db when that is set." value={databaseValue} placeholder="~/.piggery/piggery.db" onChange={setDatabase} />
      {state.saveError ? <Text style={text(theme, "meta", "statusDanger")}>{state.saveError}</Text> : null}
      <Pressable
        disabled={!changed || state.saving}
        onPress={async () => {
          if (await state.save({ path: pathValue.trim(), database: databaseValue.trim() }, state.revision)) {
            setPath(null);
            setDatabase(null);
          }
        }}
        style={{ alignSelf: "flex-start", paddingHorizontal: SPACING[3], paddingVertical: SPACING[1.5], borderRadius: RADIUS.md, borderWidth: 1, borderColor: c.border, backgroundColor: changed ? c.surface2 : "transparent" }}
      >
        <Text style={text(theme, "meta", changed ? "foreground" : "foregroundMuted")}>{state.saving ? "Saving…" : "Save"}</Text>
      </Pressable>
      <NotifyHint theme={theme} />
    </View>
  );
}
