import { useSettings } from "@getpaseo/plugin/client";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { assignAvatars, avatarPeopleOf, DEFAULT_AVATAR_SETTINGS, type AvatarPerson, type AvatarRef, type AvatarSettlement } from "../../shared/piggery/avatar.ts";
import type { View as PigView } from "../../shared/piggery/view.ts";
import { avatarSettings } from "../../shared/rpc.ts";

const NO_AVATARS: ReadonlyMap<string, AvatarRef> = new Map();

const SAVE_DELAY_MS = 1000;

const AvatarsContext = createContext<ReadonlyMap<string, AvatarRef>>(NO_AVATARS);

export function useSettledAvatars(people: readonly AvatarPerson[]): AvatarSettlement {
  const stored = useSettings(avatarSettings);
  const revision = stored.status === "ready" ? stored.revision : null;
  const settings = stored.status === "ready" ? stored.values : DEFAULT_AVATAR_SETTINGS;
  const settled = useMemo(() => assignAvatars(people, settings), [people, settings]);
  const latest = useRef(stored);
  latest.current = stored;
  const tried = useRef("");
  const attempt = revision !== null && people.length > 0 && settled.changed ? `${revision}:${JSON.stringify(settled.settings.assigned)}` : "";
  useEffect(() => {
    if (attempt === "" || revision === null || tried.current === attempt) return;
    const timer = setTimeout(async () => {
      tried.current = attempt;
      if (!(await latest.current.save(settled.settings, revision))) await latest.current.reload();
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [attempt]);
  return settled;
}

export function StoredAvatars({ view, children }: { view: PigView | null; children: ReactNode }) {
  const people = useMemo(() => (view ? avatarPeopleOf(view) : []), [view]);
  const settled = useSettledAvatars(people);
  return <AvatarsContext.Provider value={view ? settled.avatars : NO_AVATARS}>{children}</AvatarsContext.Provider>;
}

export function useAvatarRef(id: string): AvatarRef | undefined {
  return useContext(AvatarsContext).get(id);
}
