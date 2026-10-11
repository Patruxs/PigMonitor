import { settingsRpc, type PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings, type SettingsState } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { AVATAR_ROLES, AvatarSettings, DEFAULT_AVATAR_SETTINGS, MAX_AVATAR_IMAGES, addAvatarImage, avatarPeopleOf, groupByRole, imageInUse, removeAvatarImage, reshuffleAvatars, type AvatarMode, type AvatarPerson } from "../../shared/piggery/avatar.ts";
import type { RoleKey } from "../../shared/piggery/palette.ts";
import { readView } from "../../shared/piggery/view.ts";
import { avatarSettings, snapshot } from "../../shared/rpc.ts";
import { useAvatarDelete, useAvatarUpload } from "../kit/avatar-pictures.ts";
import { Button } from "../kit/button.tsx";
import { Pill } from "../kit/pill.tsx";
import { QUIET_MS, usePoll } from "../kit/poll.ts";
import { SectionTitle } from "../kit/section.tsx";
import { TabBar } from "../kit/tab-bar.tsx";
import { RADIUS, SPACING, text } from "../kit/theme.ts";
import { useSettledAvatars } from "../piggery/avatars.tsx";
import { resolvePalette, useStoredPalette } from "../piggery/palette.tsx";
import { useAvatarBatches } from "./avatar-batch-run.ts";
import { canEncodeAvatars, type EncodedAvatar } from "./avatar-encode.ts";
import { Preview, RoleLibrary, usePastedAvatar } from "./avatar-library.tsx";

type Change = (current: AvatarSettings) => AvatarSettings | null;

type Commit = (change: Change) => Promise<AvatarSettings | null | false>;

const MODES: { id: AvatarMode; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "on", label: "On" },
];

const MODE_HINTS: Record<AvatarMode, string> = {
  off: "Everyone shows their initials. You can still prepare each role's pictures.",
  on: "Everyone gets a picture from their role's library, each used once per role. When a role has more people than pictures, the latest arrivals show their initials.",
};

const HINT = "Square 1:1. Keep the subject centred with about 15% margin on each side, because the circle cuts the corners. At least 128 px, 512 px or larger recommended. PNG, JPEG or WebP up to 5 MB.";

const ROLE_TITLES: Record<RoleKey, string> = {
  supervisor: "Supervisor",
  lead: "Lead",
  peer: "Peer",
  executor: "Executor",
  advisor: "Advisor",
};

const MAX_SAVE_TRIES = 3;

const NO_PEOPLE: AvatarPerson[] = [];

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

function useCommit(state: SettingsState<typeof AvatarSettings>): Commit {
  const read = useRpc(useMemo(() => settingsRpc(avatarSettings.id).read, []));
  return async (change) => {
    if (state.status !== "ready") return false;
    let base = { values: state.values, revision: state.revision };
    for (let attempt = 0; attempt < MAX_SAVE_TRIES; attempt++) {
      const next = change(base.values);
      if (next === null) return null;
      if (await state.save(next, base.revision)) return next;
      const fresh = await read({}).catch(() => null);
      const parsed = fresh?.status === "ready" ? AvatarSettings.safeParse(fresh.values) : null;
      if (!fresh || !parsed?.success) return false;
      base = { values: parsed.data, revision: fresh.revision };
    }
    return false;
  };
}

function RoleChoice({ theme, role, colours, onPick }: { theme: PluginTheme; role: RoleKey | null; colours: Record<RoleKey, string>; onPick: (role: RoleKey) => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[1.5], flexWrap: "wrap" }}>
      <Text style={text(theme, "label")}>Add to</Text>
      {AVATAR_ROLES.map((key) => (
        <Pill key={key} theme={theme} label={ROLE_TITLES[key]} colour={colours[key]} filled={role === key} icon={role === key ? "Check" : undefined} onPress={() => onPick(key)} />
      ))}
    </View>
  );
}

function PasteManyCard({ theme, count, colours, onAdd, onCancel }: { theme: PluginTheme; count: number; colours: Record<RoleKey, string>; onAdd: (role: RoleKey) => void; onCancel: () => void }) {
  const [role, setRole] = useState<RoleKey | null>(null);
  return (
    <View style={{ gap: SPACING[2], padding: SPACING[3], borderWidth: 1, borderColor: theme.colors.border, borderRadius: RADIUS.lg, backgroundColor: theme.colors.surface1 }}>
      <Text style={text(theme, "meta", "foreground")}>{count} pictures pasted. Each is centre-cropped and added without a preview; you can delete any afterwards.</Text>
      <RoleChoice theme={theme} role={role} colours={colours} onPick={setRole} />
      <View style={{ flexDirection: "row", gap: SPACING[2] }}>
        <Button theme={theme} label="Add all" icon="Check" tone="primary" disabled={role === null} onPress={() => role && onAdd(role)} />
        <Button theme={theme} label="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

function PasteCard({ theme, image, colours, busy, onAdd, onCancel }: { theme: PluginTheme; image: EncodedAvatar; colours: Record<RoleKey, string>; busy: boolean; onAdd: (role: RoleKey, label: string) => void; onCancel: () => void }) {
  const [role, setRole] = useState<RoleKey | null>(null);
  const destination = <RoleChoice theme={theme} role={role} colours={colours} onPick={setRole} />;
  return <Preview theme={theme} image={image} colour={role ? colours[role] : theme.colors.accent} busy={busy} ready={role !== null} destination={destination} onAdd={(label) => role && onAdd(role, label)} onCancel={onCancel} />;
}

export function AvatarSettingsSection({ theme }: { theme: PluginTheme }) {
  const state = useSettings(avatarSettings);
  const toast = useToast();
  const known = useKnownView();
  const palette = resolvePalette(theme, useStoredPalette());
  const upload = useAvatarUpload();
  const remove = useAvatarDelete();
  const paste = usePastedAvatar();
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteProblem, setPasteProblem] = useState<string | null>(null);
  const view = known.value;
  const people = useMemo(() => (view ? avatarPeopleOf(view) : []), [view]);
  const groups = useMemo(() => groupByRole(people), [people]);
  const commit = useCommit(state);
  const settled = useSettledAvatars(known.error ? NO_PEOPLE : people);
  const batches = useAvatarBatches(commit, state.status === "ready" ? state.values : DEFAULT_AVATAR_SETTINGS);
  if (state.status !== "ready") {
    return <Text style={text(theme, "meta", state.status === "loading" ? "foregroundMuted" : "statusDanger")}>{state.status === "loading" ? "Loading avatars…" : state.error}</Text>;
  }
  const values: AvatarSettings = state.values;
  const on = values.mode === "on";
  const listed = on && view !== null && !known.error;
  const colours = Object.fromEntries(AVATAR_ROLES.map((role) => [role, palette[role]])) as Record<RoleKey, string>;
  const groupOf = (role: RoleKey) => groups.find((group) => group.role === role)?.people ?? NO_PEOPLE;
  const usersOf = (role: RoleKey, imageId: string) => groupOf(role).filter((person) => settled.avatars.get(person.id) === imageId).map(nameOf);
  const addTo = async (role: RoleKey, image: EncodedAvatar, label: string): Promise<string | null> => {
    const stored = await upload(image.data, image.mimeType);
    if (!stored.ok) return stored.error;
    const refusal: { error: string | null } = { error: null };
    const saved = await commit((current) => {
      const added = addAvatarImage(current, role, label ? { id: stored.id, label } : { id: stored.id });
      refusal.error = added.ok ? null : added.error;
      return added.ok ? added.settings : null;
    });
    if (saved === false) return "Could not save the library. Try again.";
    if (refusal.error) return refusal.error;
    toast.show(`Picture added to ${ROLE_TITLES[role]}`);
    return null;
  };
  const rename = (role: RoleKey, imageId: string, label: string) =>
    void commit((current) => {
      const library = current.libraries[role];
      const images = library.images.map((image) => (image.id !== imageId ? image : label ? { ...image, label } : { id: image.id }));
      return { ...current, libraries: { ...current.libraries, [role]: { ...library, images } } };
    }).then((saved) => saved === false && toast.error("Could not save the label."));
  const deleteFrom = async (role: RoleKey, imageId: string): Promise<boolean> => {
    const saved = await commit((current) => (current.libraries[role].images.some((image) => image.id === imageId) ? removeAvatarImage(current, role, imageId) : null));
    if (saved === false) {
      toast.error("Could not delete the picture. Try again.");
      return false;
    }
    if (saved !== null && imageInUse(saved, imageId)) {
      toast.show(`Picture removed from ${ROLE_TITLES[role]}; other roles still use it`);
      return true;
    }
    if (saved === null) return true;
    const gone = await remove(imageId);
    toast.show(gone.ok ? "Picture deleted" : "Picture removed; its file stays until the next clean-up");
    return true;
  };
  const reshuffle = async (role: RoleKey) => {
    const saved = await commit((current) => reshuffleAvatars(people, current, role));
    if (saved === false) toast.error("Could not reshuffle. Try again.");
    else toast.show(`${ROLE_TITLES[role]} pictures reshuffled`);
  };
  const addPasted = async (role: RoleKey, label: string) => {
    if (!paste.pasted) return;
    setPasteBusy(true);
    const failed = await addTo(role, paste.pasted, label);
    setPasteBusy(false);
    setPasteProblem(failed);
    if (!failed) paste.dismiss();
  };
  return (
    <View style={{ gap: SPACING[3] }}>
      <View style={{ marginHorizontal: -SPACING[4] }}>
        <SectionTitle theme={theme} icon="SmilePlus" title="Avatars" />
      </View>
      <TabBar theme={theme} tabs={MODES} active={values.mode} onPick={(mode) => mode !== values.mode && void commit((current) => ({ ...current, mode })).then((saved) => (saved === false ? toast.error("Could not save the avatars. Try again.") : toast.show(mode === "on" ? "Avatars on" : "Avatars off")))} />
      <Text style={text(theme, "meta")}>{MODE_HINTS[values.mode]}</Text>
      <Text style={text(theme, "meta")}>{HINT}</Text>
      <Text style={text(theme, "meta")}>{canEncodeAvatars ? "Add pictures in a role below, drop them onto it, or paste one or several anywhere here and choose their role." : "Upload pictures from Paseo desktop or web. Pictures already in the libraries show here too."}</Text>
      {on && !listed ? <Text style={text(theme, "meta", known.error ? "statusWarning" : "foregroundMuted")}>{known.error ? `Can't list the team members: ${known.error.message}` : "Reading piggery…"}</Text> : null}
      {paste.busy ? <Text style={text(theme, "meta", "foregroundMuted")}>Preparing the pasted picture…</Text> : null}
      {paste.problem || pasteProblem ? <Text style={text(theme, "meta", "statusDanger")}>{paste.problem ?? pasteProblem}</Text> : null}
      {paste.pasted ? (
        <PasteCard
          theme={theme}
          image={paste.pasted}
          colours={colours}
          busy={pasteBusy}
          onAdd={(role, label) => void addPasted(role, label)}
          onCancel={() => {
            setPasteProblem(null);
            paste.dismiss();
          }}
        />
      ) : null}
      {paste.pastedMany ? (
        <PasteManyCard
          theme={theme}
          count={paste.pastedMany.length}
          colours={colours}
          onAdd={(role) => {
            if (paste.pastedMany) batches.run(role, paste.pastedMany);
            paste.dismiss();
          }}
          onCancel={paste.dismiss}
        />
      ) : null}
      {AVATAR_ROLES.map((role) => {
        const members = groupOf(role);
        return (
          <RoleLibrary
            key={role}
            theme={theme}
            title={ROLE_TITLES[role]}
            roleName={ROLE_TITLES[role]}
            colour={colours[role]}
            images={values.libraries[role].images}
            maxImages={MAX_AVATAR_IMAGES}
            people={listed ? members.length : null}
            withoutPicture={members.filter((person) => !settled.avatars.has(person.id)).length}
            usersOf={(imageId) => usersOf(role, imageId)}
            onAdd={(image, label) => addTo(role, image, label)}
            onRename={(imageId, label) => rename(role, imageId, label)}
            onDelete={(imageId) => deleteFrom(role, imageId)}
            onReshuffle={() => reshuffle(role)}
            batch={batches.progress[role]}
            onBatch={(items) => batches.run(role, items)}
            onDismissBatch={() => batches.dismiss(role)}
          />
        );
      })}
    </View>
  );
}
