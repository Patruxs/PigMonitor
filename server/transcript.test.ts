import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const bash = { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "false" } }] } };
  const failed = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "Exit code 1" }] } };
  writeFileSync(path.join(dir, "session.jsonl"), [{ type: "user", message: { role: "user", content: "hello sup" } }, bash, failed].map((e) => `${JSON.stringify(e)}\n`).join(""));
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

test("TranscriptReader reads a session's harness transcript, its tool calls as Paseo details only, and says when there is no log", () => {
  const dir = farm();
  const mail = new MailReader();
  try {
    const reader = new TranscriptReader(mail);
    const r = reader.read(path.join(dir, "piggery.db"), "S1", undefined, 10);
    assert.ok(r.ok);
    if (r.ok) {
      assert.deepEqual(r.items.map((i) => [i.kind, i.text]), [["user", "hello sup"], ["tool", "Bash"]]);
      const { i, kind, text, at, run, ...call } = r.items[1];
      assert.deepEqual(call, { tool: "Bash", error: true, detail: { type: "shell", command: "false" }, status: "failed", toolError: { type: "tool_result", tool_use_id: "t1", is_error: true, content: "Exit code 1" } });
    }
    const none = reader.read(path.join(dir, "piggery.db"), "NOBODY", undefined, 10);
    assert.equal(none.ok, false);
    if (!none.ok) assert.equal(none.code, "nolog");
  } finally {
    mail.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a worker's context is the last main-thread usage, out of the window its harness reported for that model, and no window before one is reported", () => {
  const dir = farm();
  const mail = new MailReader();
  try {
    const run = readFileSync(path.join(import.meta.dirname, "fixtures", "worker-run.jsonl"), "utf8").split("\n");
    const firstResult = run.findIndex((line) => line.includes('"type":"result"'));
    const log = path.join(dir, "logs", "X1", "RUN1.jsonl");
    mkdirSync(path.dirname(log), { recursive: true });
    const reader = new TranscriptReader(mail);
    writeFileSync(log, run.slice(0, firstResult).join("\n"));
    const working = reader.read(path.join(dir, "piggery.db"), "X1", undefined, 10);
    assert.ok(working.ok);
    if (working.ok) assert.deepEqual(working.usage, { contextWindowUsedTokens: 19_609 });
    writeFileSync(log, run.join("\n"));
    const done = reader.read(path.join(dir, "piggery.db"), "X1", undefined, 10);
    assert.ok(done.ok);
    if (done.ok) assert.deepEqual(done.usage, { contextWindowUsedTokens: 19_781, contextWindowMaxTokens: 1_000_000 });
  } finally {
    mail.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
