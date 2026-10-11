import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { MailFilter, MailMessage, MailPage, MailTeam } from "../shared/piggery/mail.ts";
import type { ParticipantRecord } from "../shared/chat/chat-route.ts";
import type { KnownSession } from "./links.ts";
import { piggeryHome } from "./piggery.ts";
import { messageOf } from "../shared/errors.ts";

export type MailResult = ({ ok: true } & MailPage) | { ok: false; code: "nodb" | "failed"; error: string };

export function pickDatabase(setting: string): string {
  return setting.trim() || path.join(piggeryHome(), "piggery.db");
}

const text = z.string();
const maybeText = z.string().nullable();
const maybeNumber = z.number().nullable();

const RawRow = z.object({ id: text, seq: z.number(), team_id: maybeText, from_id: text, to_id: text, kind: maybeText, op: maybeText, reply_to: maybeText, reply_seq: maybeNumber, body: text, created_at: z.number(), acked_at: maybeNumber, held_reason: maybeText, from_name: maybeText, from_role: maybeText, to_name: maybeText, to_role: maybeText });
type Raw = z.infer<typeof RawRow>;

const RawTeamRow = z.object({ id: text, name: text, root_cwd: text, closed_at: maybeNumber });

const ParticipantRow = z.object({ id: text, name: text, role: maybeText, harness: maybeText, transcript: maybeText, team_id: maybeText });

const SessionRow = z.object({ id: text, ref: maybeText, harness: maybeText, mode: maybeText, cwd: text, state: text, team_closed: z.number() });

const TeammateRow = z.object({ id: text, name: text, role: text });

const KnownSessionRow = z.object({ id: text, ref: maybeText, transcript: maybeText });
const PlaceRow = z.object({ dir: text });

function rowsOf<T>(schema: z.ZodType<T>, rows: unknown[]): T[] {
  return rows.map((row) => schema.parse(row));
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
  if (filter.participants && filter.participants.length > 0) {
    clauses.push(`(m.from_id IN (${placeholders(filter.participants.length)}) OR m.to_id IN (${placeholders(filter.participants.length)}))`);
    params.push(...filter.participants, ...filter.participants);
  } else if (filter.participants) clauses.push("0");
  if (filter.participant) {
    clauses.push("(m.from_id = ? OR m.to_id = ?)");
    params.push(filter.participant, filter.participant);
  }
  if (filter.held) clauses.push("m.held_reason IS NOT NULL");
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

export type Participant = z.infer<typeof ParticipantRow>;

export class PiggeryDb {
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
        return { ok: false, code: "failed", error: `Could not read piggery's database: ${messageOf(error ?? first)}` };
      }
    }
  }

  participant(file: string, id: string): Participant | null {
    if (!existsSync(file)) return null;
    const row = this.open(file).prepare("SELECT id, name, role, harness, transcript, team_id FROM participants WHERE id = ?").get(id);
    return row === undefined ? null : ParticipantRow.parse(row);
  }

  involving(file: string, id: string): MailMessage[] {
    if (!existsSync(file)) return [];
    return rowsOf(RawRow, this.open(file).prepare(`${SELECT} WHERE m.from_id = ? OR m.to_id = ? ORDER BY m.seq`).all(id, id)).map(toMessage);
  }

  sessions(file: string, ids: string[]): ParticipantRecord[] {
    if (!existsSync(file) || ids.length === 0) return [];
    const rows = this.open(file)
      .prepare(`SELECT p.id, COALESCE(p.session_ref, p.harness_ref) AS ref, p.harness, p.mode, p.cwd, p.state, t.closed_at IS NOT NULL AS team_closed FROM participants p LEFT JOIN teams t ON t.id = p.team_id WHERE p.id IN (${placeholders(ids.length)})`)
      .all(...ids);
    return rowsOf(SessionRow, rows).map(({ team_closed, ...r }) => ({ ...r, gone: r.state === "gone", teamClosed: team_closed === 1 }));
  }

  claudeSessions(file: string): KnownSession[] {
    if (!existsSync(file)) return [];
    return rowsOf(KnownSessionRow, this.open(file).prepare("SELECT id, COALESCE(session_ref, harness_ref) AS ref, transcript FROM participants WHERE harness = 'claude' AND COALESCE(session_ref, harness_ref) IS NOT NULL").all());
  }

  places(file: string): string[] {
    if (!existsSync(file)) return [];
    return rowsOf(PlaceRow, this.open(file).prepare("SELECT cwd AS dir FROM participants UNION SELECT root_cwd AS dir FROM teams").all()).map((row) => row.dir);
  }

  teammates(file: string, teamId: string): { roles: Record<string, string>; ids: Record<string, string> } {
    const roles: Record<string, string> = {};
    const ids: Record<string, string> = {};
    if (!existsSync(file)) return { roles, ids };
    const rows = rowsOf(TeammateRow, this.open(file).prepare("SELECT id, name, role FROM participants WHERE team_id = ? AND role IS NOT NULL ORDER BY created_at").all(teamId));
    for (const r of rows) {
      roles[r.name] = r.role;
      ids[r.name] = r.id;
    }
    return { roles, ids };
  }

  private query(db: DatabaseSync, filter: MailFilter): MailResult {
    const { sql, params } = whereOf(filter);
    const rows = rowsOf(RawRow, db.prepare(`${SELECT}${sql} ORDER BY m.seq DESC LIMIT ?`).all(...params, filter.limit));
    const messages = rows.map(toMessage);
    const teamIds = [...new Set(messages.map((m) => m.team).filter((t): t is string => t !== undefined))];
    const teams: Record<string, MailTeam> = {};
    if (teamIds.length > 0) {
      const found = db.prepare(`SELECT id, name, root_cwd, closed_at FROM teams WHERE id IN (${placeholders(teamIds.length)})`).all(...teamIds);
      const teamRows = rowsOf(RawTeamRow, found);
      for (const t of teamRows) teams[t.id] = { id: t.id, name: t.name, dir: t.root_cwd, ...(t.closed_at !== null ? { closed: t.closed_at } : {}) };
    }
    return { ok: true, messages, teams };
  }
}
