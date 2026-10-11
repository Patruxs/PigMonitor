import { settingsRpc, type PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings, type SettingsState } from "@getpaseo/plugin/client";
import { Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AvatarSettings, avatarPeopleOf, avatarPool, groupByRole, imageIdOf, imageRef, reshuffleAvatars, type AvatarGroup, type AvatarMode, type AvatarPerson, type AvatarRef } from "../../shared/piggery/avatar.ts";
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
import { useSettledAvatars } from "../piggery/avatars.tsx";
import { resolvePalette, useStoredPalette } from "../piggery/palette.tsx";
import { AvatarLibrary, pictureName, type AvatarChange, type AvatarCommit } from "./avatar-library.tsx";

const MODES: { id: AvatarMode; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "manual", label: "Manual" },
  { id: "auto", label: "Auto random" },
];

const MODE_HINTS: Record<AvatarMode, string> = {
  off: "Everyone shows their initials.",
  manual: "Pick a picture or an icon for anyone you like; the rest show their initials. Avatars are meant to be unique within a role.",
  auto: "Each role gets distinct avatars at random, pictures first, then icons. Picks made in Manual still win. When a role has more people than avatars, the latest arrivals show initials.",
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

const MAX_SAVE_TRIES = 3;

const NO_PEOPLE: AvatarPerson[] = [];

function iconWords(icon: string): string {
  return icon.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function refLabel(ref: AvatarRef, settings: AvatarSettings): string {
  const imageId = imageIdOf(ref);
  if (imageId === null) return iconWords(ref);
  const index = settings.images.findIndex((image) => image.id === imageId);
  return index < 0 ? "Picture" : pictureName(settings.images[index], index);
}

function refProps(ref: AvatarRef | undefined): { icon?: string; imageId?: string } {
  if (ref === undefined) return {};
  const imageId = imageIdOf(ref);
  return imageId === null ? { icon: ref } : { imageId };
}

function useCommit(state: SettingsState<typeof AvatarSettings>): AvatarCommit {
  const read = useRpc(useMemo(() => settingsRpc(avatarSettings.id).read, []));
  return async (change: AvatarChange) => {
    if (state.status !== "ready") return false;
    let base = { values: state.values, revision: state.revision };
    for (let attempt = 0; attempt < MAX_SAVE_TRIES; attempt++) {
      const next = change(base.values);
      if (next === null) return null;
      if (await state.save(next, base.revision)) return true;
      const fresh = await read({}).catch(() => null);
      const parsed = fresh?.status === "ready" ? AvatarSettings.safeParse(fresh.values) : null;
      if (!fresh || !parsed?.success) return false;
      base = { values: parsed.data, revision: fresh.revision };
    }
    return false;
  };
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

function AvatarChoice({ theme, label, avatar, colour, chosen, takenBy, onPick }: { theme: PluginTheme; label: string; avatar: AvatarRef; colour: string; chosen: boolean; takenBy: string[]; onPick: () => void }) {
  return (
    <Pressable onPress={onPick} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: chosen }} style={(state) => ({ width: 88, alignItems: "center", gap: SPACING[1], padding: SPACING[1.5], borderRadius: RADIUS.md, borderWidth: 1, borderColor: chosen ? theme.colors.accent : "transparent", backgroundColor: state.pressed ? theme.colors.surface2 : "transparent" })}>
      <Avatar theme={theme} name={label} colour={colour} size={AVATAR_LG} {...refProps(avatar)} />
      <Text style={text(theme, "label", "foreground")} numberOfLines={1}>
        {label}
      </Text>
      {takenBy.length > 0 ? (
        <Text style={text(theme, "label", "statusWarning")} numberOfLines={2}>
          {takenBy.join(", ")}
        </Text>
      ) : null}
    </Pressable>
  );
}

function PersonRow({ theme, person, colour, avatar, avatarLabel, picked, sharedWith, editable, onChoose, onClear }: { theme: PluginTheme; person: AvatarPerson; colour: string; avatar: AvatarRef | undefined; avatarLabel: string; picked: boolean; sharedWith: string[]; editable: boolean; onChoose: () => void; onClear: () => void }) {
  const name = nameOf(person);
  const detail = [person.team, avatarLabel, picked && !editable ? "your pick" : undefined].filter(Boolean).join(" · ");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingVertical: SPACING[2], flexWrap: "wrap" }}>
      <Avatar theme={theme} name={name} colour={colour} size={AVATAR} {...refProps(avatar)} />
      <View style={{ flex: 1, minWidth: 160 }}>
        <Text style={text(theme, "rowTitle")} numberOfLines={1}>
          {name}
        </Text>
        <Text style={text(theme, "label")} numberOfLines={1}>
          {detail}
        </Text>
        {sharedWith.length > 0 ? (
          <Text style={text(theme, "label", "statusWarning")} numberOfLines={2}>
            Same avatar as {sharedWith.join(", ")}
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
  const commit = useCommit(state);
  const settled = useSettledAvatars(known.error ? NO_PEOPLE : people);
  if (state.status !== "ready") {
    return <Text style={text(theme, "meta", state.status === "loading" ? "foregroundMuted" : "statusDanger")}>{state.status === "loading" ? "Loading avatars…" : state.error}</Text>;
  }
  const values: AvatarSettings = state.values;
  const assigned = settled.avatars;
  const pool = avatarPool(values);
  const nameFor = (id: string) => nameOf(people.find((person) => person.id === id) ?? { id, role: undefined });
  const save = async (change: AvatarChange, done: string) => {
    if ((await commit(change)) === false) toast.error("Could not save the avatars. Try again.");
    else toast.show(done);
  };
  const pick = (id: string, ref: AvatarRef) => {
    setPicking(null);
    void save((current) => ({ ...current, picks: { ...current.picks, [id]: ref } }), `${nameFor(id)} is now ${refLabel(ref, values)}`);
  };
  const clear = (id: string) =>
    void save((current) => {
      const { [id]: _dropped, ...picks } = current.picks;
      return { ...current, picks };
    }, `${nameFor(id)}'s pick cleared`);
  const holdersOf = (group: AvatarGroup, ref: AvatarRef, except?: string) => group.people.filter((person) => person.id !== except && assigned.get(person.id) === ref).map(nameOf);
  const usersOf = (imageId: string) => {
    const ref = imageRef(imageId);
    const ids = new Set([...[...assigned].filter(([, value]) => value === ref).map(([id]) => id), ...Object.keys(values.picks).filter((id) => values.picks[id] === ref)]);
    return [...ids].map(nameFor);
  };
  const pickingGroup = picking ? groups.find((group) => group.role === picking.role) : undefined;
  const editable = values.mode === "manual";
  return (
    <View style={{ gap: SPACING[3] }}>
      <View style={{ marginHorizontal: -SPACING[4] }}>
        <SectionTitle theme={theme} icon="SmilePlus" title="Avatars" />
      </View>
      <TabBar theme={theme} tabs={MODES} active={values.mode} onPick={(mode) => mode !== values.mode && void save((current) => ({ ...current, mode }), MODE_TOASTS[mode])} />
      <Text style={text(theme, "meta")}>{MODE_HINTS[values.mode]}</Text>
      <AvatarLibrary theme={theme} values={values} usersOf={usersOf} commit={commit} />
      {values.mode === "auto" ? (
        <View style={{ flexDirection: "row" }}>
          <Button theme={theme} label="Reshuffle" icon="Shuffle" busy={state.saving} disabled={people.length === 0} onPress={() => void save((current) => reshuffleAvatars(people, current), "Avatars reshuffled")} />
        </View>
      ) : null}
      {values.mode === "off" ? null : !view || known.error ? (
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
                  {initials} of {group.people.length} have no avatar left and show initials.
                </Text>
              ) : null}
              {values.mode === "manual" && group.people.length > pool.length ? (
                <Text style={text(theme, "label", "statusWarning")}>
                  {group.people.length} people share {pool.length} avatars, so some will share one or keep initials.
                </Text>
              ) : null}
              <Rows theme={theme}>
                {group.people.map((person) => {
                  const avatar = assigned.get(person.id);
                  return (
                    <PersonRow
                      key={person.id}
                      theme={theme}
                      person={person}
                      colour={palette[group.role]}
                      avatar={avatar}
                      avatarLabel={avatar ? refLabel(avatar, values) : "Initials"}
                      picked={values.picks[person.id] !== undefined}
                      sharedWith={avatar ? holdersOf(group, avatar, person.id) : []}
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
          <Text style={text(theme, "meta")}>Names under an avatar are already using it in this role.</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACING[1] }}>
            {picking && pickingGroup
              ? pool.map((ref) => (
                  <AvatarChoice key={ref} theme={theme} label={refLabel(ref, values)} avatar={ref} colour={palette[picking.role]} chosen={assigned.get(picking.id) === ref} takenBy={holdersOf(pickingGroup, ref, picking.id)} onPick={() => pick(picking.id, ref)} />
                ))
              : null}
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}
