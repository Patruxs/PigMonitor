import { clock24 } from "../format.ts";

export const VIEW_VERSION = 1;

export const PERSON_HARNESS = "paseo";

export type Status = "working" | "idle" | "waiting" | "gone";

export type UnixMs = number;
export type Tone = "muted" | "warning" | "danger";
export type Kind = "member" | "solo" | "team" | "gone";

export interface Summary {
  teams: number;
  working: number;
  idle: number;
  waiting?: number;
  held: number;
  unacked: number;
}

export interface Tab {
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
  open?: boolean;
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

interface Head {
  id: string;
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
  bucket?: "live" | "sleeping" | "gone" | "closed";
  folded?: boolean;
  blocks: Block[];
}

export interface List {
  dirs: Dir[];
  any_cwd?: boolean;
}

export interface Column {
  status: Status;
  word: string;
}

export interface BoardView {
  columns: Column[];
  dirs: Dir[];
}

export interface EventRow {
  time: string;
  at?: UnixMs;
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

export function related(path: string, dir: string): boolean {
  const a = path.replace(/\/+$/, "");
  const b = dir.replace(/\/+$/, "");
  return a === b || b.startsWith(a + "/") || a.startsWith(b + "/");
}

export const TAIL_VERSION = 1;
export const TAIL_KINDS = ["text", "tool", "result", "error", "warning", "rule", "user"] as const;
export type TailKind = (typeof TAIL_KINDS)[number];

export const clockText = clock24;

export const URGENCY: Record<Status, number> = { waiting: 0, working: 1, idle: 2, gone: 3 };

export function taskWords(title: string): string {
  return title.replace(/^#\d+\s*/, "").trim();
}
