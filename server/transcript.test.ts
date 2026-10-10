import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { MailReader } from "./mail.ts";
import { logsDirOf, page, runLogs, TranscriptReader } from "./transcript.ts";

test("page takes the last `limit` items, or the `limit` before an index", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ i, kind: "user" as const, text: String(i) }));
  assert.deepEqual(page(items, undefined, 2).map((x) => x.i), [3, 4]);
  assert.deepEqual(page(items, 3, 2).map((x) => x.i), [1, 2]);
  assert.deepEqual(page(items, 1, 5).map((x) => x.i), [0]);
  assert.deepEqual(page(items, 99, 2).map((x) => x.i), [3, 4]);
});

test("the logs of a participant sit beside the database, one file per run, in run order", () => {
  assert.equal(logsDirOf("/farm/piggery.db", "P1"), path.join("/farm", "logs", "P1"));
  assert.deepEqual(runLogs("/nowhere/at/all"), []);
});

function farm(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "piggery-transcript-"));
  const db = new DatabaseSync(path.join(dir, "piggery.db"));
  db.exec(`
    CREATE TABLE participants (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT, harness TEXT, transcript TEXT, team_id TEXT, created_at INTEGER);
    INSERT INTO participants VALUES ('P1', 'lead', 'lead', 'claude', NULL, 'T', 1), ('S1', 'gates', 'supervisor', 'claude', '${path.join(dir, "session.jsonl").replace(/\\/g, "\\\\")}', 'T', 0), ('X1', 'ci', 'peer', 'claude', NULL, 'T', 2);
  `);
  db.close();
  mkdirSync(path.join(dir, "logs", "P1"), { recursive: true });
  const say = (text: string) => JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
  writeFileSync(path.join(dir, "logs", "P1", "RUN1.jsonl"), `${say("first run")}\n`);
  writeFileSync(path.join(dir, "logs", "P1", "RUN2.jsonl"), `${say("second run")}\n${say("still second")}\n`);
  writeFileSync(path.join(dir, "session.jsonl"), `${JSON.stringify({ type: "user", message: { role: "user", content: "hello sup" } })}\n`);
  return dir;
}

test("TranscriptReader joins a worker's runs in order and names it from the database", () => {
  const dir = farm();
  const mail = new MailReader();
  try {
    const reader = new TranscriptReader(mail);
    const r = reader.read(path.join(dir, "piggery.db"), "P1", undefined, 10);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.name, "lead");
    assert.equal(r.role, "lead");
    assert.equal(r.files, 2);
    assert.deepEqual(r.roles, { gates: "supervisor", lead: "lead", ci: "peer" });
    assert.equal(r.total, 3);
    assert.deepEqual(r.items.map((i) => [i.i, i.text, i.run]), [
      [0, "first run", "RUN1"],
      [1, "second run", "RUN2"],
      [2, "still second", "RUN2"],
    ]);
    const last = reader.read(path.join(dir, "piggery.db"), "P1", undefined, 1);
    if (last.ok) assert.deepEqual(last.items.map((i) => i.i), [2]);
    const again = reader.read(path.join(dir, "piggery.db"), "P1", undefined, 10);
    if (again.ok) assert.equal(again.total, 3);
  } finally {
    mail.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TranscriptReader reads a session's harness transcript, and says when there is no log", () => {
  const dir = farm();
  const mail = new MailReader();
  try {
    const reader = new TranscriptReader(mail);
    const r = reader.read(path.join(dir, "piggery.db"), "S1", undefined, 10);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.items.map((i) => [i.kind, i.text]), [["user", "hello sup"]]);
    const none = reader.read(path.join(dir, "piggery.db"), "NOBODY", undefined, 10);
    assert.equal(none.ok, false);
    if (!none.ok) assert.equal(none.code, "nolog");
  } finally {
    mail.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
