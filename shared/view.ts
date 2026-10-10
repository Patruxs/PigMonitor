// What `piggery ps --view` prints (internal/view, Go): the rows, their order, groups, words, counts,
// default folds, tabs and the actions allowed on each. The plugin reads it and draws it; nothing here
// decides what to show. Only the types of that document, the check of its version, and pure helpers
// for drawing (a path match for a workspace, `piggery tail` text, clock times). No imports, so the app,
// the daemon and `node --test` all load it as is.

import { ageLong, clock24 } from "./format.ts";

export const VIEW_VERSION = 1;

export type Status = "working" | "idle" | "waiting" | "gone";

export type UnixMs = number;
export type Tone = "muted" | "warning" | "danger";
export type Kind = "member" | "solo" | "team" | "gone";

export interface Summary {
  teams: number;
  working: number;
  idle: number;
  /** Participants that wait on a permission or are queued: what needs the user. */
  waiting?: number;
  held: number;
  unacked: number;
}

export interface Tab {
  /** "" is All, else a team id or the Closed key; opaque. */
  key: string;
  label: string;
  count: number;
}

export interface Actions {
  pick?: boolean;
  kill?: boolean;
  tail?: boolean;
}

export interface Row {
  kind: Kind;
  /** Opaque (a team line's and a gone line's begin with a NUL): never parsed. */
  id: string;
  team?: string;
  depth: number;
  prefix?: string;
  name: string;
  role?: string;
  gate?: boolean;
  closed?: string;
  state: string;
  state_text: string;
  status: Status;
  dim?: boolean;
  /** A team line's or gone line's default fold: whether its members are listed. */
  open?: boolean;
  /** Listed only when the team's gone line is open. */
  folded?: boolean;
  harness?: string;
  model?: string;
  ctx?: string;
  turns?: string;
  unacked: number;
  age?: string;
  created_at?: UnixMs;
  state_since?: UnixMs;
  last_turn_end?: UnixMs;
  since?: string;
  cwd?: string;
  actions?: Actions;
  tabs?: string[];
}

export interface Head {
  id: string;
  /** The key of this team's detail in `details`. */
  detail: string;
  name: string;
  template?: string;
  line: boolean;
  open: boolean;
  flags?: string[];
  counts?: string[];
  tabs?: string[];
}

export interface Block {
  head?: Head;
  rows: Row[];
  no_members?: boolean;
}

export interface Dir {
  path: string;
  label: string;
  /** Where it sorts: live, sleeping, gone (every unit all gone) or closed (only closed teams). */
  bucket?: "live" | "sleeping" | "gone" | "closed";
  /** A client that folds starts this directory folded (gone and closed ones). Only `board.dirs` carries it. */
  folded?: boolean;
  blocks: Block[];
}

export interface List {
  dirs: Dir[];
  any_cwd?: boolean;
}

/** A Board column: a status and the word that titles it (not the state text of one of its rows). */
export interface Column {
  status: Status;
  word: string;
}

/** What the Board draws from: its columns in order, and every directory (open teams, every closed team, solos) in one list. */
export interface BoardView {
  columns: Column[];
  dirs: Dir[];
}

export interface EventRow {
  time: string;
  who: string;
  type: string;
  target?: string;
  tone: Tone;
}

export interface Fact {
  label: string;
  value: string;
  note?: string;
  muted?: boolean;
  pick?: boolean;
}

export interface Task {
  title: string;
  from: string;
  chain?: string;
  mail?: { head: string; title: string; tail: string };
}

export interface Detail {
  kind: "team" | "participant";
  id?: string;
  title: string;
  sub?: string;
  state?: string;
  task?: Task;
  facts: Fact[];
  hint?: string;
}

export interface Daemon {
  pid: number;
  started_at: number;
  age: string;
  version?: string;
  version_notes?: string[];
  version_mismatch?: boolean;
  /** The notice top shows for installs that need `piggery setup --outdated`; "" or absent when none. */
  outdated?: string;
}

export interface View {
  version: number;
  generated_at: number;
  summary: Summary;
  tabs: Tab[];
  all: List;
  closed: List;
  board: BoardView;
  events: EventRow[];
  details: Record<string, Detail>;
  daemon?: Daemon;
}

export type ReadView = { ok: true; view: View } | { ok: false; code: "older" | "newer" | "failed"; error: string };

/** The document as `ps --view` printed it, when it is the version this plugin reads. */
export function readView(doc: Record<string, unknown> | null | undefined): ReadView {
  const version = doc?.version;
  if (typeof version !== "number") {
    return { ok: false, code: "older", error: "This piggery's ps --view says no version. Update piggery (piggery setup paseo installs a plugin that matches it)." };
  }
  if (version < VIEW_VERSION) {
    return { ok: false, code: "older", error: `piggery speaks ps --view version ${version}; this plugin reads ${VIEW_VERSION}. Update piggery.` };
  }
  if (version > VIEW_VERSION) {
    return { ok: false, code: "newer", error: `piggery speaks ps --view version ${version}; this plugin reads ${VIEW_VERSION}. Run piggery setup paseo to update the plugin, then reload the Paseo app.` };
  }
  return { ok: true, view: doc as unknown as View };
}

/** Whether a directory piggery lists is the workspace's, inside it, or around it. */
export function related(path: string, dir: string): boolean {
  const a = path.replace(/\/+$/, "");
  const b = dir.replace(/\/+$/, "");
  return a === b || b.startsWith(a + "/") || a.startsWith(b + "/");
}

/**
 * `piggery tail --view`: one JSON document, a version then `lines` as top shows them. A line's `text`
 * reads as top draws it, glyphs included; `rest` (tool lines only) is the arguments, drawn muted after it.
 */
export const TAIL_VERSION = 1;
export const TAIL_KINDS = ["text", "tool", "result", "error", "warning", "rule", "user"] as const;
export type TailKind = (typeof TAIL_KINDS)[number];

export const agoText = ageLong;

export const clockText = clock24;

export const URGENCY: Record<Status, number> = { waiting: 0, working: 1, idle: 2, gone: 3 };

export function taskWords(title: string): string {
  return title.replace(/^#\d+\s*/, "").trim();
}
