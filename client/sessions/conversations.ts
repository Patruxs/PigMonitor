import { basenameOf } from "../../shared/events.ts";
import { taskWords, URGENCY, type Dir, type Row, type View } from "../../shared/view.ts";

export interface ListedDir {
  path: string;
  label: string;
}

export interface Conversation {
  row: Row;
  teamKey: string;
  teamName: string | undefined;
  template: string | undefined;
  dir: ListedDir;
  preview: string;
  at: number | undefined;
}

export interface Group {
  key: string;
  label: string;
  icon: string;
  items: Conversation[];
}

export interface Project {
  path: string;
  name: string;
  label: string;
  groups: Group[];
}

export type Filter = "all" | "live" | "waiting" | "gone";

export const SOLO_KEY = "";

function previewOf(view: Pick<View, "details">, row: Row): string {
  const task = view.details[row.id]?.task?.title;
  if (task) return taskWords(task);
  return `${row.harness ?? "agent"} session`;
}

export function conversationsOf(view: Pick<View, "details" | "tabs">, dirs: Dir[]): Conversation[] {
  const teamName = (id: string | undefined) => view.tabs.find((t) => t.key === id)?.label;
  const out: Conversation[] = [];
  for (const d of dirs) {
    for (const b of d.blocks) {
      for (const r of b.rows) {
        if (r.kind !== "member" && r.kind !== "solo") continue;
        out.push({ row: r, teamKey: r.team ?? SOLO_KEY, teamName: teamName(r.team), template: b.head?.template, dir: { path: d.path, label: d.label }, preview: previewOf(view, r), at: r.last_turn_end ?? r.state_since ?? r.created_at });
      }
    }
  }
  return out;
}

const byUrgency = (a: Conversation, b: Conversation) => URGENCY[a.row.status] - URGENCY[b.row.status] || (b.at ?? 0) - (a.at ?? 0);

export function mostPressing(items: Conversation[]): Conversation | undefined {
  return [...items].sort(byUrgency)[0];
}

export function matches(c: Conversation, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [c.row.name, c.row.role, c.teamName, c.preview, c.row.harness].some((s) => s?.toLowerCase().includes(q));
}

export function passes(c: Conversation, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "live":
      return c.row.status !== "gone";
    case "waiting":
      return c.row.status === "waiting";
    case "gone":
      return c.row.status === "gone";
  }
}

const weightOf = (items: Conversation[]) => Math.min(...items.map((c) => URGENCY[c.row.status]));
const latestOf = (items: Conversation[]) => Math.max(...items.map((c) => c.at ?? 0));

export function groupsOf(items: Conversation[]): Group[] {
  const byKey = new Map<string, Group>();
  for (const c of items) {
    const existing = byKey.get(c.teamKey);
    if (existing) existing.items.push(c);
    else byKey.set(c.teamKey, { key: c.teamKey, label: c.teamKey === SOLO_KEY ? "Solo sessions" : (c.teamName ?? "Team"), icon: c.teamKey === SOLO_KEY ? "User" : "Users", items: [c] });
  }
  const solos = byKey.get(SOLO_KEY);
  if (solos) solos.items.sort(byUrgency);
  return [...byKey.values()].sort((a, b) => weightOf(a.items) - weightOf(b.items) || latestOf(b.items) - latestOf(a.items));
}

export function projectsOf(items: Conversation[]): Project[] {
  const byPath = new Map<string, Conversation[]>();
  for (const c of items) {
    const list = byPath.get(c.dir.path);
    if (list) list.push(c);
    else byPath.set(c.dir.path, [c]);
  }
  return [...byPath.entries()]
    .sort(([, a], [, b]) => weightOf(a) - weightOf(b) || latestOf(b) - latestOf(a))
    .map(([path, list]) => ({ path, name: basenameOf(path), label: list[0].dir.label, groups: groupsOf(list) }));
}
