import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AVATAR_POOL, assignAvatars, avatarPeopleOf, groupByRole, reshuffleAvatars, type AvatarGroup, type AvatarIcon, type AvatarMode, type AvatarPerson, type AvatarSettings } from "../../shared/piggery/avatar.ts";
import type { RoleKey } from "../../shared/piggery/palette.ts";
import { readView } from "../../shared/piggery/view.ts";
import { avatarSettings, snapshot } from "../../shared/rpc.ts";
import { AVATAR, Avatar } from "../kit/avatar.tsx";
import { Button } from "../kit/button.tsx";
import { QUIET_MS, usePoll } from "../kit/poll.ts";
import { Rows } from "../kit/rows.tsx";
import { SectionTitle } from "../kit/section.tsx";
import { TabBar } from "../kit/tab-bar.tsx";
import { AVATAR_LG, RADIUS, SPACING, text } from "../kit/theme.ts";
import { resolvePalette, useStoredPalette } from "../piggery/palette.tsx";

const MODES: { id: AvatarMode; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "manual", label: "Manual" },
  { id: "auto", label: "Auto random" },
];

const MODE_HINTS: Record<AvatarMode, string> = {
  off: "Everyone shows their initials.",
  manual: "Pick an icon for anyone you like; the rest show their initials. Icons are meant to be unique within a role.",
  auto: "Each role gets distinct icons at random. Picks made in Manual still win. When a role has more people than icons, the latest arrivals show initials.",
};

const MODE_TOASTS: Record<AvatarMode, string> = {
  off: "Avatars off",
  manual: "Avatars picked by hand",
  auto: "Avatars drawn at random",
};

const ROLE_TITLES: Record<RoleKey, string> = {
  supervisor: "Supervisors",
  lead: "Leads",
  peer: "Peers",
  executor: "Executors",
  advisor: "Advisors",
};

function iconWords(icon: string): string {
  return icon.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function nameOf(person: AvatarPerson): string {
  return person.name ?? person.id;
}

function useKnownView() {
  const call = useRpc(snapshot);
  return usePoll(
    async () => {
      const r = await call({});
      if (!r.ok) return r;
      const v = readView(r.view);
      return v.ok ? { ok: true as const, value: v.view } : v;
    },
    "avatar-people",
    () => QUIET_MS,
  );
}

function IconChoice({ theme, icon, colour, chosen, takenBy, onPick }: { theme: PluginTheme; icon: AvatarIcon; colour: string; chosen: boolean; takenBy: string[]; onPick: () => void }) {
  return (
    <Pressable onPress={onPick} accessibilityRole="button" accessibilityLabel={iconWords(icon)} accessibilityState={{ selected: chosen }} style={(state) => ({ width: 88, alignItems: "center", gap: SPACING[1], padding: SPACING[1.5], borderRadius: RADIUS.md, borderWidth: 1, borderColor: chosen ? theme.colors.accent : "transparent", backgroundColor: state.pressed ? theme.colors.surface2 : "transparent" })}>
      <Avatar theme={theme} name={icon} colour={colour} size={AVATAR_LG} icon={icon} />
      <Text style={text(theme, "label", "foreground")} numberOfLines={1}>
        {iconWords(icon)}
      </Text>
      {takenBy.length > 0 ? (
        <Text style={text(theme, "label", "statusWarning")} numberOfLines={2}>
          {takenBy.join(", ")}
        </Text>
      ) : null}
    </Pressable>
  );
}

function PersonRow({ theme, person, colour, icon, picked, sharedWith, editable, onChoose, onClear }: { theme: PluginTheme; person: AvatarPerson; colour: string; icon: AvatarIcon | undefined; picked: boolean; sharedWith: string[]; editable: boolean; onChoose: () => void; onClear: () => void }) {
  const name = nameOf(person);
  const detail = [person.team, icon ? iconWords(icon) : "Initials", picked && !editable ? "your pick" : undefined].filter(Boolean).join(" · ");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingVertical: SPACING[2], flexWrap: "wrap" }}>
      <Avatar theme={theme} name={name} colour={colour} size={AVATAR} icon={icon} />
      <View style={{ flex: 1, minWidth: 160 }}>
        <Text style={text(theme, "rowTitle")} numberOfLines={1}>
          {name}
        </Text>
        <Text style={text(theme, "label")} numberOfLines={1}>
          {detail}
        </Text>
        {sharedWith.length > 0 ? (
          <Text style={text(theme, "label", "statusWarning")} numberOfLines={2}>
            Same icon as {sharedWith.join(", ")}
          </Text>
        ) : null}
      </View>
      {editable ? <Button theme={theme} label="Choose" icon="SmilePlus" onPress={onChoose} /> : null}
      {picked ? <Button theme={theme} label={editable ? "Clear" : "Clear pick"} onPress={onClear} /> : null}
    </View>
  );
}

export function AvatarSettingsSection({ theme }: { theme: PluginTheme }) {
  const state = useSettings(avatarSettings);
  const toast = useToast();
  const known = useKnownView();
  const palette = resolvePalette(theme, useStoredPalette());
  const [picking, setPicking] = useState<{ id: string; role: RoleKey } | null>(null);
  const view = known.value;
  const people = useMemo(() => (view ? avatarPeopleOf(view) : []), [view]);
  const groups = useMemo(() => groupByRole(people), [people]);
  if (state.status !== "ready") {
    return <Text style={text(theme, "meta", state.status === "loading" ? "foregroundMuted" : "statusDanger")}>{state.status === "loading" ? "Loading avatars…" : state.error}</Text>;
  }
  const values: AvatarSettings = state.values;
  const assigned = assignAvatars(people, values);
  const nameFor = (id: string) => nameOf(people.find((person) => person.id === id) ?? { id, role: undefined });
  const save = async (next: AvatarSettings, done: string) => {
    if (await state.save(next, state.revision)) toast.show(done);
    else toast.error(state.saveError ?? "Could not save the avatars.");
  };
  const pick = (id: string, icon: AvatarIcon) => {
    setPicking(null);
    void save({ ...values, picks: { ...values.picks, [id]: icon } }, `${nameFor(id)} is now ${iconWords(icon)}`);
  };
  const clear = (id: string) => {
    const { [id]: _dropped, ...picks } = values.picks;
    void save({ ...values, picks }, `${nameFor(id)}'s pick cleared`);
  };
  const holdersOf = (group: AvatarGroup, icon: AvatarIcon, except?: string) => group.people.filter((person) => person.id !== except && assigned.get(person.id) === icon).map(nameOf);
  const pickingGroup = picking ? groups.find((group) => group.role === picking.role) : undefined;
  const editable = values.mode === "manual";
  return (
    <View style={{ gap: SPACING[3] }}>
      <View style={{ marginHorizontal: -SPACING[4] }}>
        <SectionTitle theme={theme} icon="SmilePlus" title="Avatars" />
      </View>
      <TabBar theme={theme} tabs={MODES} active={values.mode} onPick={(mode) => mode !== values.mode && void save({ ...values, mode }, MODE_TOASTS[mode])} />
      <Text style={text(theme, "meta")}>{MODE_HINTS[values.mode]}</Text>
      {values.mode === "auto" ? (
        <View style={{ flexDirection: "row" }}>
          <Button theme={theme} label="Reshuffle" icon="Shuffle" busy={state.saving} disabled={people.length === 0} onPress={() => void save(reshuffleAvatars(people, values), "Avatars reshuffled")} />
        </View>
      ) : null}
      {values.mode === "off" ? null : !view ? (
        <Text style={text(theme, "meta", known.error ? "statusWarning" : "foregroundMuted")}>{known.error ? `Can't list the team members: ${known.error.message}` : "Reading piggery…"}</Text>
      ) : groups.length === 0 ? (
        <Text style={text(theme, "meta")}>No team members yet. They appear here once piggery has teams.</Text>
      ) : (
        groups.map((group) => {
          const initials = group.people.filter((person) => !assigned.has(person.id)).length;
          return (
            <View key={group.role} style={{ gap: SPACING[1] }}>
              <Text style={text(theme, "label")}>
                {ROLE_TITLES[group.role]} · {group.people.length}
              </Text>
              {values.mode === "auto" && initials > 0 ? (
                <Text style={text(theme, "label", "statusWarning")}>
                  {initials} of {group.people.length} have no icon left and show initials.
                </Text>
              ) : null}
              {values.mode === "manual" && group.people.length > AVATAR_POOL.length ? (
                <Text style={text(theme, "label", "statusWarning")}>
                  {group.people.length} people share {AVATAR_POOL.length} icons, so some will share an icon or keep initials.
                </Text>
              ) : null}
              <Rows theme={theme}>
                {group.people.map((person) => {
                  const icon = assigned.get(person.id);
                  return (
                    <PersonRow
                      key={person.id}
                      theme={theme}
                      person={person}
                      colour={palette[group.role]}
                      icon={icon}
                      picked={values.picks[person.id] !== undefined}
                      sharedWith={icon ? holdersOf(group, icon, person.id) : []}
                      editable={editable}
                      onChoose={() => setPicking({ id: person.id, role: group.role })}
                      onClear={() => clear(person.id)}
                    />
                  );
                })}
              </Rows>
            </View>
          );
        })
      )}
      <Modal title={picking ? `Avatar for ${nameFor(picking.id)}` : "Avatar"} open={picking !== null} onOpenChange={(open) => !open && setPicking(null)}>
        <Modal.Content contentContainerStyle={{ padding: SPACING[3], gap: SPACING[2] }}>
          <Text style={text(theme, "meta")}>Names under an icon are already using it in this role.</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACING[1] }}>
            {picking && pickingGroup
              ? AVATAR_POOL.map((icon) => (
                  <IconChoice key={icon} theme={theme} icon={icon} colour={palette[picking.role]} chosen={assigned.get(picking.id) === icon} takenBy={holdersOf(pickingGroup, icon, picking.id)} onPick={() => pick(picking.id, icon)} />
                ))
              : null}
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}
