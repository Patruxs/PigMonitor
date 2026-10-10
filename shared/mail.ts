export const MAIL_VERSION = 1;

export const ENGINE_ID = "engine";
export const PSEUDO_IDS = new Set(["notify", "board", ENGINE_ID]);

export interface MailMessage {
  id: string;
  seq: number;
  team?: string;
  from: string;
  from_name: string;
  from_role?: string;
  to: string;
  to_name: string;
  to_role?: string;
  kind?: string;
  op?: string;
  reply_to?: string;
  reply_seq?: number;
  body: string;
  created_at: number;
  acked_at?: number;
  held?: string;
}

export interface MailTeam {
  id: string;
  name: string;
  dir: string;
  closed?: number;
}

export interface MailPage {
  messages: MailMessage[];
  teams: Record<string, MailTeam>;
  total: number;
}

export interface MailFilter {
  teams?: string[];
  participants?: string[];
  participant?: string;
  before?: number;
  limit: number;
}

export type KindTone = "accent" | "success" | "warning" | "danger" | "muted";

const KIND_TONES: Record<string, KindTone> = {
  task: "accent",
  assign: "accent",
  plan: "accent",
  contract: "accent",
  interface: "accent",
  handback: "success",
  accept: "success",
  accepted: "success",
  settled: "success",
  answer: "success",
  report: "success",
  verdict: "success",
  decision: "success",
  fix: "success",
  rework: "warning",
  ask: "warning",
  question: "warning",
  "handback-request": "warning",
  review: "warning",
  urgent: "danger",
  stop: "danger",
};

export function kindTone(kind: string | undefined, op: string | undefined): KindTone {
  if (op === "assign") return "accent";
  if (!kind) return "muted";
  return KIND_TONES[kind] ?? "muted";
}

export function kindLabel(m: Pick<MailMessage, "kind" | "op">): string | undefined {
  if (m.op === "assign") return m.kind ? `${m.op} · ${m.kind}` : m.op;
  return m.kind || undefined;
}

export type RoleTone = "accent" | "success" | "warning" | "muted";

export const HUMAN = "human";

export const ROLE_PALETTE: Record<string, string> = {
  supervisor: "#a78bfa",
  chair: "#a78bfa",
  lead: "#38bdf8",
  peer: "#34d399",
  executor: "#2dd4bf",
  member: "#2dd4bf",
  advisor: "#f472b6",
  oracle: "#f472b6",
  reviewer: "#f472b6",
};

export type Paint = { kind: "hex"; value: string } | { kind: "token"; value: "accent" | "foregroundMuted" };

export function roleColour(role: string | undefined, id: string): Paint {
  if (role === HUMAN) return { kind: "token", value: "accent" };
  if (PSEUDO_IDS.has(id) || !role) return { kind: "token", value: "foregroundMuted" };
  const hex = ROLE_PALETTE[role];
  return hex ? { kind: "hex", value: hex } : { kind: "token", value: "foregroundMuted" };
}

export function roleWord(role: string | undefined, id: string): string {
  if (role === HUMAN) return "Human";
  if (PSEUDO_IDS.has(id)) return id;
  return role ?? "solo";
}

const ROLE_TONES: Record<string, RoleTone> = {
  lead: "accent",
  supervisor: "accent",
  chair: "accent",
  advisor: "warning",
  oracle: "warning",
  reviewer: "warning",
  peer: "success",
  executor: "success",
  member: "success",
};

export function roleTone(role: string | undefined, id: string): RoleTone {
  if (PSEUDO_IDS.has(id)) return "muted";
  if (!role) return "muted";
  return ROLE_TONES[role] ?? "muted";
}

export function isNotice(m: Pick<MailMessage, "from" | "to">): boolean {
  return m.from === ENGINE_ID || m.to === "notify";
}

export function isUnacked(m: Pick<MailMessage, "to" | "acked_at">): boolean {
  return m.acked_at === undefined && !PSEUDO_IDS.has(m.to);
}

export function titleOf(m: Pick<MailMessage, "op" | "body">): string | undefined {
  if (m.op !== "assign") return undefined;
  const first = m.body.split("\n", 1)[0]?.trim();
  return first || undefined;
}

export function bodyOf(m: Pick<MailMessage, "op" | "body">): string {
  if (m.op !== "assign") return m.body.trim();
  const at = m.body.indexOf("\n");
  return at === -1 ? "" : m.body.slice(at + 1).trim();
}

export interface Who {
  id: string;
  name: string;
  role?: string;
  count: number;
}

export function participantsOf(messages: MailMessage[]): Who[] {
  const out = new Map<string, Who>();
  const add = (id: string, name: string, role: string | undefined) => {
    if (PSEUDO_IDS.has(id)) return;
    const had = out.get(id);
    if (had) had.count += 1;
    else out.set(id, { id, name, role, count: 1 });
  };
  for (const m of messages) {
    add(m.from, m.from_name, m.from_role);
    add(m.to, m.to_name, m.to_role);
  }
  return [...out.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export interface Shown {
  participant: string;
  unackedOnly: boolean;
  notices: boolean;
}

export function shownMail(messages: MailMessage[], shown: Shown): MailMessage[] {
  return messages.filter((m) => {
    if (!shown.notices && isNotice(m)) return false;
    if (shown.unackedOnly && !isUnacked(m)) return false;
    if (shown.participant && m.from !== shown.participant && m.to !== shown.participant) return false;
    return true;
  });
}

export function dayLabel(ms: number, now: number): string {
  const t = new Date(ms);
  const today = new Date(now);
  const yesterday = new Date(now - 86400000);
  if (t.toDateString() === today.toDateString()) return "Today";
  if (t.toDateString() === yesterday.toDateString()) return "Yesterday";
  const month = t.toLocaleString("en-US", { month: "short" });
  return t.getFullYear() === today.getFullYear() ? `${month} ${t.getDate()}` : `${month} ${t.getDate()}, ${t.getFullYear()}`;
}

export function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function lineCount(body: string): number {
  return body.split("\n").length;
}

export function teamIdOfKey(key: string): string | undefined {
  const match = /^\u0000team:(.+)$/.exec(key);
  return match ? match[1] : undefined;
}

export const GROUP_MS = 5 * 60 * 1000;
export const LONG_LINES = 8;
export const LONG_CHARS = 700;

export function continues(previous: MailMessage | undefined, m: MailMessage): boolean {
  if (!previous) return false;
  if (previous.from !== m.from || previous.to !== m.to || previous.team !== m.team) return false;
  if (m.op === "assign" || m.reply_to !== undefined || isNotice(m)) return false;
  if (!sameDay(previous.created_at, m.created_at)) return false;
  return Math.abs(m.created_at - previous.created_at) <= GROUP_MS;
}

export function matchesSearch(m: MailMessage, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (q === `#${m.seq}`) return true;
  const hay = [m.body, m.from_name, m.to_name, m.kind ?? "", m.op ?? ""].join("\n").toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

export function byId(messages: MailMessage[]): Map<string, MailMessage> {
  return new Map(messages.map((m) => [m.id, m]));
}

export function previewOf(body: string): string {
  return body.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

export function isLong(body: string): boolean {
  return body.length > LONG_CHARS || lineCount(body) > LONG_LINES;
}
