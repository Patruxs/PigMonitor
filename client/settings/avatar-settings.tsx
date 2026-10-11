import { settingsRpc, type PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings, type SettingsState } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { AVATAR_ROLES, AvatarSettings, DEFAULT_AVATAR_SETTINGS, MAX_AVATAR_IMAGES, addAvatarImage, avatarPeopleOf, groupByRole, imageInUse, pickAvatar, removeAvatarImage, type AvatarMode, type AvatarPerson } from "../../shared/piggery/avatar.ts";
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
import { RolePeople } from "./avatar-people.tsx";

type Change = (current: AvatarSettings) => AvatarSettings | null;

type Commit = (change: Change) => Promise<AvatarSettings | null | false>;

const MODES: { id: AvatarMode; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "manual", label: "Manual" },
];

const MODE_HINTS: Record<AvatarMode, string> = {
  auto: "Everyone gets a picture from their role's library by itself, each used once per role in a team, and newcomers get a free one. Live teams come first; when a team has more people in a role than pictures, its latest arrivals show their initials.",
  manual: "You pick each person's picture. A role with one picture gives it to everyone; a role with several lists its people under its pictures, and a picture can be shared.",
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

function PasteCard({ theme, image, colours, busy, onAdd, onCancel }: { theme: PluginTheme; image: EncodedAvatar; colours: Record<RoleKey, string>; busy: boolean; onAdd: (role: RoleKey) => void; onCancel: () => void }) {
  const [role, setRole] = useState<RoleKey | null>(null);
  const destination = <RoleChoice theme={theme} role={role} colours={colours} onPick={setRole} />;
  return <Preview theme={theme} image={image} colour={role ? colours[role] : theme.colors.accent} busy={busy} ready={role !== null} destination={destination} onAdd={() => role && onAdd(role)} onCancel={onCancel} />;
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
  const manual = values.mode === "manual";
  const listed = view !== null && !known.error;
  const colours = Object.fromEntries(AVATAR_ROLES.map((role) => [role, palette[role]])) as Record<RoleKey, string>;
  const groupOf = (role: RoleKey) => groups.find((group) => group.role === role)?.people.filter((person) => person.live ?? true) ?? NO_PEOPLE;
  const usersOf = (role: RoleKey, imageId: string) => groupOf(role).filter((person) => settled.avatars.get(person.id) === imageId).map((person) => (person.team ? `${nameOf(person)} (${person.team})` : nameOf(person)));
  const addTo = async (role: RoleKey, image: EncodedAvatar): Promise<string | null> => {
    const stored = await upload(image.data, image.mimeType);
    if (!stored.ok) return stored.error;
    const refusal: { error: string | null } = { error: null };
    const saved = await commit((current) => {
      const added = addAvatarImage(current, role, { id: stored.id });
      refusal.error = added.ok ? null : added.error;
      return added.ok ? added.settings : null;
    });
    if (saved === false) return "Could not save the library. Try again.";
    if (refusal.error) return refusal.error;
    toast.show(`Picture added to ${ROLE_TITLES[role]}`);
    return null;
  };
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
  const pick = (personId: string, imageId: string | null) =>
    void commit((current) => pickAvatar(current, personId, imageId)).then((saved) => saved === false && toast.error("Could not save the pick. Try again."));
  const deleteConsequence = (role: RoleKey) => {
    const left = values.libraries[role].images.length - 1;
    if (!manual) return `They get another free ${ROLE_TITLES[role]} picture, or their initials if none is left.`;
    if (left >= 2) return "They show their initials until you pick another picture for them.";
    return left === 1 ? `They get the remaining ${ROLE_TITLES[role]} picture.` : "They show their initials.";
  };
  const addPasted = async (role: RoleKey) => {
    if (!paste.pasted) return;
    setPasteBusy(true);
    const failed = await addTo(role, paste.pasted);
    setPasteBusy(false);
    setPasteProblem(failed);
    if (!failed) paste.dismiss();
  };
  return (
    <View style={{ gap: SPACING[3] }}>
      <View style={{ marginHorizontal: -SPACING[4] }}>
        <SectionTitle theme={theme} icon="SmilePlus" title="Avatars" />
      </View>
      <TabBar theme={theme} tabs={MODES} active={values.mode} onPick={(mode) => mode !== values.mode && void commit((current) => ({ ...current, mode })).then((saved) => (saved === false ? toast.error("Could not save the avatars. Try again.") : toast.show(mode === "auto" ? "Avatars picked automatically" : "Avatars picked by hand")))} />
      <Text style={text(theme, "meta")}>{MODE_HINTS[values.mode]}</Text>
      <Text style={text(theme, "meta")}>{HINT}</Text>
      <Text style={text(theme, "meta")}>{canEncodeAvatars ? "Add pictures in a role below, drop them onto it, or paste one or several anywhere here and choose their role." : "Upload pictures from Paseo desktop or web. Pictures already in the libraries show here too."}</Text>
      {!listed ? <Text style={text(theme, "meta", known.error ? "statusWarning" : "foregroundMuted")}>{known.error ? `Can't list the team members: ${known.error.message}` : "Reading piggery…"}</Text> : null}
      {paste.busy ? <Text style={text(theme, "meta", "foregroundMuted")}>Preparing the pasted picture…</Text> : null}
      {paste.problem || pasteProblem ? <Text style={text(theme, "meta", "statusDanger")}>{paste.problem ?? pasteProblem}</Text> : null}
      {paste.pasted ? (
        <PasteCard
          theme={theme}
          image={paste.pasted}
          colours={colours}
          busy={pasteBusy}
          onAdd={(role) => void addPasted(role)}
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
        const images = values.libraries[role].images;
        return (
          <RoleLibrary
            key={role}
            theme={theme}
            title={ROLE_TITLES[role]}
            roleName={ROLE_TITLES[role]}
            colour={colours[role]}
            images={images}
            maxImages={MAX_AVATAR_IMAGES}
            people={listed ? members.length : null}
            withoutPicture={members.filter((person) => !settled.avatars.has(person.id)).length}
            usersOf={(imageId) => usersOf(role, imageId)}
            onAdd={(image) => addTo(role, image)}
            onDelete={(imageId) => deleteFrom(role, imageId)}
            deleteConsequence={deleteConsequence(role)}
            batch={batches.progress[role]}
            onBatch={(items) => batches.run(role, items)}
            onDismissBatch={() => batches.dismiss(role)}
          >
            {manual && listed && images.length >= 2 && members.length > 0 ? <RolePeople theme={theme} people={members} images={images} colour={colours[role]} picks={settled.avatars} needsPick={settled.needsPick} onPick={(personId, imageId) => pick(personId, imageId)} onClear={(personId) => pick(personId, null)} /> : null}
          </RoleLibrary>
        );
      })}
    </View>
  );
}
