import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { MailReader, pickDatabase, whereOf } from "./mail.ts";

test("the database is the setting, else PIGGERY_HOME's, else ~/.piggery's", () => {
  assert.equal(pickDatabase(" /x/piggery.db ", {}), "/x/piggery.db");
  assert.equal(pickDatabase("", { PIGGERY_HOME: "/farm" }), path.join("/farm", "piggery.db"));
  assert.ok(pickDatabase("", {}).endsWith(path.join(".piggery", "piggery.db")));
});

test("whereOf builds the scope, the participant and the page", () => {
  assert.deepEqual(whereOf({ limit: 10 }), { sql: "", params: [] });
  assert.deepEqual(whereOf({ limit: 10, teams: ["t1", "t2"] }), { sql: " WHERE (m.team_id IN (?, ?))", params: ["t1", "t2"] });
  assert.deepEqual(whereOf({ limit: 10, teams: ["t1"], participants: ["p1"] }), { sql: " WHERE (m.team_id IN (?) OR m.from_id IN (?) OR m.to_id IN (?))", params: ["t1", "p1", "p1"] });
  assert.deepEqual(whereOf({ limit: 10, teams: [] }), { sql: " WHERE 0", params: [] });
  assert.deepEqual(whereOf({ limit: 10, participant: "p", before: 50 }), { sql: " WHERE (m.from_id = ? OR m.to_id = ?) AND m.seq < ?", params: ["p", "p", 50] });
  assert.deepEqual(whereOf({ limit: 10, participant: "p", held: true }), { sql: " WHERE (m.from_id = ? OR m.to_id = ?) AND m.held_reason IS NOT NULL", params: ["p", "p"] });
});

function farm(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "piggery-mail-"));
  const file = path.join(dir, "piggery.db");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_cwd TEXT NOT NULL, closed_at INTEGER);
    CREATE TABLE participants (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT, team_id TEXT);
    CREATE TABLE messages (id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, team_id TEXT, from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT, reply_to TEXT, op TEXT, body TEXT NOT NULL, created_at INTEGER NOT NULL, acked_at INTEGER, held_reason TEXT);
    INSERT INTO teams VALUES ('t1', 'utils', '/p/utils', NULL), ('t2', 'other', '/p/other', 1000);
    INSERT INTO participants VALUES ('lead', 'lead', 'lead', 't1'), ('peer', 'ci', 'peer', 't1'), ('solo', 'goblin', NULL, NULL);
    INSERT INTO messages VALUES ('m1', 1, 't1', 'lead', 'peer', NULL, NULL, 'assign', 'Fix CI\nDetails', 100, 150, NULL);
    INSERT INTO messages VALUES ('m2', 2, 't1', 'peer', 'lead', 'handback', 'm1', NULL, 'Done', 200, NULL, NULL);
    INSERT INTO messages VALUES ('m3', 3, 't2', 'lead', 'peer', NULL, NULL, NULL, 'Elsewhere', 300, NULL, 'limit');
    INSERT INTO messages VALUES ('m4', 4, NULL, 'engine', 'notify', 'reply', NULL, NULL, 'goblin finished a turn', 400, 400, NULL);
    INSERT INTO messages VALUES ('m5', 5, NULL, 'solo', 'lead', NULL, NULL, NULL, 'Hi from a solo', 500, NULL, NULL);
  `);
  db.close();
  return { dir, file };
}

test("MailReader reads mail newest first with names, reply seqs and the teams it mentions", () => {
  const { dir, file } = farm();
  const reader = new MailReader();
  try {
    const r = reader.read(file, { limit: 10 });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.total, 5);
    assert.deepEqual(r.messages.map((m) => m.seq), [5, 4, 3, 2, 1]);
    const handback = r.messages.find((m) => m.seq === 2);
    assert.deepEqual(handback, { id: "m2", seq: 2, team: "t1", from: "peer", from_name: "ci", from_role: "peer", to: "lead", to_name: "lead", to_role: "lead", kind: "handback", reply_to: "m1", reply_seq: 1, body: "Done", created_at: 200 });
    const engine = r.messages.find((m) => m.seq === 4);
    assert.equal(engine?.from_name, "engine");
    assert.equal(engine?.to_name, "notify");
    assert.equal(r.messages.find((m) => m.seq === 3)?.held, "limit");
    assert.deepEqual(Object.keys(r.teams).sort(), ["t1", "t2"]);
    assert.deepEqual(r.teams.t2, { id: "t2", name: "other", dir: "/p/other", closed: 1000 });
  } finally {
    reader.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MailReader scopes by teams and solos, by one participant, and pages by seq", () => {
  const { dir, file } = farm();
  const reader = new MailReader();
  try {
    const scoped = reader.read(file, { limit: 10, teams: ["t1"], participants: ["solo"] });
    assert.ok(scoped.ok);
    if (scoped.ok) assert.deepEqual(scoped.messages.map((m) => m.seq), [5, 2, 1]);
    const one = reader.read(file, { limit: 10, participant: "peer" });
    assert.ok(one.ok);
    if (one.ok) assert.deepEqual(one.messages.map((m) => m.seq), [3, 2, 1]);
    const page = reader.read(file, { limit: 2, before: 4 });
    assert.ok(page.ok);
    if (page.ok) {
      assert.deepEqual(page.messages.map((m) => m.seq), [3, 2]);
      assert.equal(page.total, 3);
    }
  } finally {
    reader.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing database is said, not thrown", () => {
  const reader = new MailReader();
  const r = reader.read("/nowhere/piggery.db", { limit: 10 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "nodb");
});
