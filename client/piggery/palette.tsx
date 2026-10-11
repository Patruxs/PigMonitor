import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings } from "@getpaseo/plugin/client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { roleColour } from "../../shared/piggery/mail.ts";
import { hueFor, isThemeToken, mergePalette, teamHuesOf, type ColourKey, type PaletteOverrides } from "../../shared/piggery/palette.ts";
import { colourSettings } from "../../shared/rpc.ts";
import type { Status } from "../../shared/piggery/view.ts";

export type Palette = Record<ColourKey, string> & { teamHues: string[]; human: string; muted: string };

const NO_OVERRIDES: PaletteOverrides = {};

const PaletteOverridesContext = createContext<PaletteOverrides>(NO_OVERRIDES);

export function resolveColour(theme: PluginTheme, value: string): string {
  return isThemeToken(value) ? theme.colors[value] : value;
}

export function resolvePalette(theme: PluginTheme, overrides: PaletteOverrides): Palette {
  const values = mergePalette(overrides);
  const colour = (key: ColourKey) => resolveColour(theme, values[key]);
  return {
    working: colour("working"),
    waiting: colour("waiting"),
    idle: colour("idle"),
    gone: colour("gone"),
    supervisor: colour("supervisor"),
    lead: colour("lead"),
    peer: colour("peer"),
    executor: colour("executor"),
    advisor: colour("advisor"),
    mail: colour("mail"),
    mailHeld: colour("mailHeld"),
    team: colour("team"),
    teamHues: teamHuesOf(values),
    human: theme.colors.accent,
    muted: theme.colors.foregroundMuted,
  };
}

export function useStoredPalette(): PaletteOverrides {
  const stored = useSettings(colourSettings);
  return stored.status === "ready" ? stored.values : NO_OVERRIDES;
}

export function PaletteProvider({ overrides, children }: { overrides: PaletteOverrides; children: ReactNode }) {
  return <PaletteOverridesContext.Provider value={overrides}>{children}</PaletteOverridesContext.Provider>;
}

export function StoredPalette({ children }: { children: ReactNode }) {
  return <PaletteProvider overrides={useStoredPalette()}>{children}</PaletteProvider>;
}

export function usePalette(theme: PluginTheme): Palette {
  const overrides = useContext(PaletteOverridesContext);
  return useMemo(() => resolvePalette(theme, overrides), [theme, overrides]);
}

export function statusColour(palette: Palette, status: Status, dim?: boolean): string {
  return dim ? palette.muted : palette[status];
}

export function paint(palette: Palette, role: string | undefined, id: string): string {
  const p = roleColour(role, id);
  if (p.kind === "role") return palette[p.value];
  return p.value === "accent" ? palette.human : palette.muted;
}

export function teamColour(palette: Palette, key: string): string {
  return hueFor(key, palette.teamHues);
}
