import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MailFilter, MailMessage, MailPage, MailTeam } from "../shared/mail.ts";
import type { Session } from "../shared/native.ts";

export type MailResult = ({ ok: true } & MailPage) | { ok: false; code: "nodb" | "failed"; error: string };

export function defaultDatabase(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.PIGGERY_HOME?.trim() || path.join(homedir(), ".piggery");
  return path.join(home, "piggery.db");
}

export function pickDatabase(setting: string, env: NodeJS.ProcessEnv = process.env): string {
  return setting.trim() || defaultDatabase(env);
}

interface Raw {
  id: string;
  seq: number;
  team_id: string | null;
  from_id: string;
  to_id: string;
  kind: string | null;
  op: string | null;
  reply_to: string | null;
  reply_seq: number | null;
  body: string;
  created_at: number;
  acked_at: number | null;
  held_reason: string | null;
  from_name: string | null;
  from_role: string | null;
  to_name: string | null;
  to_role: string | null;
}

interface RawTeam {
  id: string;
  name: string;
  root_cwd: string;
  closed_at: number | null;
}

const SELECT = `
SELECT m.id, m.seq, m.team_id, m.from_id, m.to_id, m.kind, m.op, m.reply_to, r.seq AS reply_seq,
       m.body, m.created_at, m.acked_at, m.held_reason,
       pf.name AS from_name, pf.role AS from_role, pt.name AS to_name, pt.role AS to_role
FROM messages m
LEFT JOIN messages r ON r.id = m.reply_to
LEFT JOIN participants pf ON pf.id = m.from_id
LEFT JOIN participants pt ON pt.id = m.to_id`;

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

export function whereOf(filter: MailFilter): { sql: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const scope: string[] = [];
  if (filter.teams && filter.teams.length > 0) {
    scope.push(`m.team_id IN (${placeholders(filter.teams.length)})`);
    params.push(...filter.teams);
  }
  if (filter.participants && filter.participants.length > 0) {
    scope.push(`m.from_id IN (${placeholders(filter.participants.length)})`, `m.to_id IN (${placeholders(filter.participants.length)})`);
    params.push(...filter.participants, ...filter.participants);
  }
  if (scope.length > 0) clauses.push(`(${scope.join(" OR ")})`);
  else if (filter.teams || filter.participants) clauses.push("0");
  if (filter.participant) {
    clauses.push("(m.from_id = ? OR m.to_id = ?)");
    params.push(filter.participant, filter.participant);
  }
  if (filter.held) clauses.push("m.held_reason IS NOT NULL");
  if (filter.before !== undefined) {
    clauses.push("m.seq < ?");
    params.push(filter.before);
  }
  return { sql: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "", params };
}

function toMessage(r: Raw): MailMessage {
  const m: MailMessage = {
    id: r.id,
    seq: r.seq,
    from: r.from_id,
    from_name: r.from_name ?? r.from_id,
    to: r.to_id,
    to_name: r.to_name ?? r.to_id,
    body: r.body,
    created_at: r.created_at,
  };
  if (r.team_id) m.team = r.team_id;
  if (r.from_role) m.from_role = r.from_role;
  if (r.to_role) m.to_role = r.to_role;
  if (r.kind) m.kind = r.kind;
  if (r.op) m.op = r.op;
  if (r.reply_to) m.reply_to = r.reply_to;
  if (r.reply_seq !== null) m.reply_seq = r.reply_seq;
  if (r.acked_at !== null) m.acked_at = r.acked_at;
  if (r.held_reason) m.held = r.held_reason;
  return m;
}

export interface Participant {
  id: string;
  name: string;
  role: string | null;
  harness: string | null;
  transcript: string | null;
  team_id: string | null;
}

export class MailReader {
  private db: DatabaseSync | null = null;
  private openedPath = "";

  private open(file: string): DatabaseSync {
    if (this.db && this.openedPath === file) return this.db;
    this.close();
    this.db = new DatabaseSync(file, { readOnly: true });
    this.openedPath = file;
    return this.db;
  }

  close(): void {
    try {
      this.db?.close();
    } catch {}
    this.db = null;
    this.openedPath = "";
  }

  read(file: string, filter: MailFilter): MailResult {
    if (!existsSync(file)) {
      this.close();
      return { ok: false, code: "nodb", error: `piggery's database was not found at "${file}". Set its path in the PigMonitor settings.` };
    }
    try {
      return this.query(this.open(file), filter);
    } catch (first) {
      this.close();
      try {
        return this.query(this.open(file), filter);
      } catch (error) {
        this.close();
        return { ok: false, code: "failed", error: `Could not read piggery's database: ${String((error as Error).message ?? error ?? first)}` };
      }
    }
  }

  participant(file: string, id: string): Participant | null {
    if (!existsSync(file)) return null;
    const row = this.open(file).prepare("SELECT id, name, role, harness, transcript, team_id FROM participants WHERE id = ?").get(id) as unknown as Participant | undefined;
    return row ?? null;
  }

  involving(file: string, id: string): MailMessage[] {
    if (!existsSync(file)) return [];
    const rows = this.open(file).prepare(`${SELECT} WHERE m.from_id = ? OR m.to_id = ? ORDER BY m.seq`).all(id, id) as unknown as Raw[];
    return rows.map(toMessage);
  }

  sessions(file: string, ids: string[]): Session[] {
    if (!existsSync(file) || ids.length === 0) return [];
    const rows = this.open(file)
      .prepare(`SELECT p.id, COALESCE(p.session_ref, p.harness_ref) AS ref, p.harness, p.mode, p.cwd, p.state, t.closed_at IS NOT NULL AS team_closed FROM participants p LEFT JOIN teams t ON t.id = p.team_id WHERE p.id IN (${placeholders(ids.length)})`)
      .all(...ids) as unknown as (Omit<Session, "gone" | "teamClosed"> & { team_closed: number })[];
    return rows.map(({ team_closed, ...r }) => ({ ...r, gone: r.state === "gone", teamClosed: team_closed === 1 }));
  }

  teammates(file: string, teamId: string): Record<string, string> {
    if (!existsSync(file)) return {};
    const rows = this.open(file).prepare("SELECT name, role FROM participants WHERE team_id = ? AND role IS NOT NULL ORDER BY created_at").all(teamId) as unknown as { name: string; role: string }[];
    const out: Record<string, string> = {};
    for (const r of rows) out[r.name] = r.role;
    return out;
  }

  private query(db: DatabaseSync, filter: MailFilter): MailResult {
    const { sql, params } = whereOf(filter);
    const rows = db.prepare(`${SELECT}${sql} ORDER BY m.seq DESC LIMIT ?`).all(...params, filter.limit) as unknown as Raw[];
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM messages m${sql}`).get(...params) as unknown as { n: number }).n;
    const messages = rows.map(toMessage);
    const teamIds = [...new Set(messages.map((m) => m.team).filter((t): t is string => t !== undefined))];
    const teams: Record<string, MailTeam> = {};
    if (teamIds.length > 0) {
      const found = db.prepare(`SELECT id, name, root_cwd, closed_at FROM teams WHERE id IN (${placeholders(teamIds.length)})`).all(...teamIds) as unknown as RawTeam[];
      for (const t of found) teams[t.id] = { id: t.id, name: t.name, dir: t.root_cwd, ...(t.closed_at !== null ? { closed: t.closed_at } : {}) };
    }
    return { ok: true, messages, teams, total };
  }
}
