import { useSettings } from "@getpaseo/plugin/client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { assignAvatars, avatarPeopleOf, DEFAULT_AVATAR_SETTINGS, type AvatarIcon } from "../../shared/piggery/avatar.ts";
import type { View as PigView } from "../../shared/piggery/view.ts";
import { avatarSettings } from "../../shared/rpc.ts";

const NO_AVATARS: ReadonlyMap<string, AvatarIcon> = new Map();

const AvatarsContext = createContext<ReadonlyMap<string, AvatarIcon>>(NO_AVATARS);

export function StoredAvatars({ view, children }: { view: PigView | null; children: ReactNode }) {
  const stored = useSettings(avatarSettings);
  const settings = stored.status === "ready" ? stored.values : DEFAULT_AVATAR_SETTINGS;
  const assigned = useMemo(() => (view && settings.mode !== "off" ? assignAvatars(avatarPeopleOf(view), settings) : NO_AVATARS), [view, settings]);
  return <AvatarsContext.Provider value={assigned}>{children}</AvatarsContext.Provider>;
}

export function useAvatarIcon(id: string): AvatarIcon | undefined {
  return useContext(AvatarsContext).get(id);
}
