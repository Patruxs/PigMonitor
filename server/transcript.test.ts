import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { PiggeryDb } from "./db.ts";
import { streamOfLog } from "../client/stream/log-stream.ts";
import { withIncrement } from "../shared/stream/transcript.ts";
import { logsDirOf, runLogs, TranscriptReader } from "./transcript.ts";

test("the logs of a participant sit beside the database, one file per run, in run order", () => {
  assert.equal(logsDirOf("/piggery/piggery.db", "P1"), path.join("/piggery", "logs", "P1"));
  assert.deepEqual(runLogs("/nowhere/at/all"), []);
});

function fakePiggery(): string {
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
  const dir = fakePiggery();
  const piggery = new PiggeryDb();
  try {
    const reader = new TranscriptReader(piggery);
    const r = reader.read(path.join(dir, "piggery.db"), "P1", { limit: 10 });
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
    const last = reader.read(path.join(dir, "piggery.db"), "P1", { limit: 1 });
    if (last.ok) assert.deepEqual(last.items.map((i) => i.i), [2]);
    const again = reader.read(path.join(dir, "piggery.db"), "P1", { limit: 10 });
    if (again.ok) assert.equal(again.total, 3);
  } finally {
    piggery.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TranscriptReader reads a session's harness transcript, its tool calls as Paseo details only, and says when there is no log", () => {
  const dir = fakePiggery();
  const piggery = new PiggeryDb();
  try {
    const reader = new TranscriptReader(piggery);
    const r = reader.read(path.join(dir, "piggery.db"), "S1", { limit: 10 });
    assert.ok(r.ok);
    if (r.ok) {
      assert.deepEqual(r.items.map((i) => [i.kind, i.text]), [["user", "hello sup"], ["tool", "Bash"]]);
      const { i, key, kind, text, at, run, ...call } = r.items[1];
      assert.deepEqual(call, { tool: "Bash", error: true, detail: { type: "shell", command: "false" }, status: "failed", toolError: { type: "tool_result", tool_use_id: "t1", is_error: true, content: "Exit code 1" } });
    }
    const none = reader.read(path.join(dir, "piggery.db"), "NOBODY", { limit: 10 });
    assert.equal(none.ok, false);
    if (!none.ok) assert.equal(none.code, "nolog");
  } finally {
    piggery.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a worker's context is the last main-thread usage, out of the window its harness reported for that model, and no window before one is reported", () => {
  const dir = fakePiggery();
  const piggery = new PiggeryDb();
  try {
    const run = readFileSync(path.join(import.meta.dirname, "fixtures", "worker-run.jsonl"), "utf8").split("\n");
    const firstResult = run.findIndex((line) => line.includes('"type":"result"'));
    const log = path.join(dir, "logs", "X1", "RUN1.jsonl");
    mkdirSync(path.dirname(log), { recursive: true });
    const reader = new TranscriptReader(piggery);
    writeFileSync(log, run.slice(0, firstResult).join("\n"));
    const working = reader.read(path.join(dir, "piggery.db"), "X1", { limit: 10 });
    assert.ok(working.ok);
    if (working.ok) assert.deepEqual(working.usage, { contextWindowUsedTokens: 19_609 });
    writeFileSync(log, run.join("\n"));
    const done = reader.read(path.join(dir, "piggery.db"), "X1", { limit: 10 });
    assert.ok(done.ok);
    if (done.ok) assert.deepEqual(done.usage, { contextWindowUsedTokens: 19_781, contextWindowMaxTokens: 1_000_000 });
  } finally {
    piggery.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a poll with the last cursor gets only what is new or changed since, across a half-written line, a tool result and a new run, and adds up to a full read", () => {
  const dir = fakePiggery();
  const piggery = new PiggeryDb();
  try {
    const db = path.join(dir, "piggery.db");
    const runs = path.join(dir, "logs", "P1");
    const reader = new TranscriptReader(piggery);
    const first = reader.read(db, "P1", { limit: 100 });
    assert.ok(first.ok);
    if (!first.ok) return;
    const call = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t9", name: "Bash", input: { command: "ls" } }] } });
    appendFileSync(path.join(runs, "RUN2.jsonl"), call.slice(0, 40));
    const half = reader.read(db, "P1", { limit: 100, since: first });
    assert.ok(half.ok);
    if (!half.ok) return;
    assert.deepEqual([half.from, half.items.length], [3, 0]);
    appendFileSync(path.join(runs, "RUN2.jsonl"), `${call.slice(40)}\n`);
    const running = reader.read(db, "P1", { limit: 100, since: half });
    assert.ok(running.ok);
    if (!running.ok) return;
    assert.deepEqual(running.items.map((i) => [i.i, i.status]), [[3, "running"]]);
    appendFileSync(path.join(runs, "RUN2.jsonl"), `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t9", content: "a b" }] } })}\n`);
    writeFileSync(path.join(runs, "RUN3.jsonl"), `${JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "third run" }] } })}\n`);
    const done = reader.read(db, "P1", { limit: 100, since: running });
    assert.ok(done.ok);
    if (!done.ok) return;
    assert.equal(done.epoch, first.epoch);
    assert.deepEqual(done.items.map((i) => [i.i, i.status ?? i.text, i.run]), [[3, "completed", "RUN2"], [4, "third run", "RUN3"]]);
    const shown = [first, half, running, done].reduce((had, next) => withIncrement(had, next, 100), [] as typeof first.items);
    const full = new TranscriptReader(piggery).read(db, "P1", { limit: 100 });
    assert.ok(full.ok);
    if (full.ok) assert.deepEqual(shown, full.items);
    writeFileSync(path.join(runs, "RUN1.jsonl"), "");
    const restarted = reader.read(db, "P1", { limit: 100, since: done });
    assert.ok(restarted.ok);
    if (restarted.ok) assert.deepEqual([restarted.epoch !== first.epoch, restarted.from, restarted.total], [true, undefined, 4]);
  } finally {
    piggery.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mail that arrives or is read between two polls is sent from where it lands in the merged list", () => {
  const dir = fakePiggery();
  const piggery = new PiggeryDb();
  try {
    const db = path.join(dir, "piggery.db");
    const at = (s: number) => new Date(s * 1000).toISOString();
    const say = (text: string, s: number) => JSON.stringify({ type: "assistant", timestamp: at(s), message: { role: "assistant", content: [{ type: "text", text }] } });
    mkdirSync(path.join(dir, "logs", "X1"), { recursive: true });
    writeFileSync(path.join(dir, "logs", "X1", "RUN1.jsonl"), [say("one", 10), say("two", 20), say("three", 30)].join("\n") + "\n");
    const write = new DatabaseSync(db);
    write.exec("CREATE TABLE messages (id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, team_id TEXT, from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT, reply_to TEXT, op TEXT, body TEXT NOT NULL, created_at INTEGER NOT NULL, acked_at INTEGER, held_reason TEXT)");
    write.exec("INSERT INTO messages VALUES ('m1', 1, 'T', 'ME', 'X1', NULL, NULL, NULL, 'first', 11000, NULL, NULL)");
    const reader = new TranscriptReader(piggery);
    const first = reader.read(db, "X1", { limit: 100, person: "ME" });
    assert.ok(first.ok);
    if (!first.ok) return;
    assert.deepEqual(first.items.map((i) => i.text), ["one", "first", "two", "three"]);
    write.exec("INSERT INTO messages VALUES ('m2', 2, 'T', 'ME', 'X1', NULL, NULL, NULL, 'second', 21000, NULL, NULL)");
    const arrived = reader.read(db, "X1", { limit: 100, person: "ME", since: first });
    assert.ok(arrived.ok);
    if (!arrived.ok) return;
    assert.deepEqual([arrived.from, arrived.items.map((i) => [i.i, i.text])], [3, [[3, "second"], [4, "three"]]]);
    write.exec("UPDATE messages SET acked_at = 12000 WHERE seq = 1");
    write.close();
    const read = reader.read(db, "X1", { limit: 100, person: "ME", since: arrived });
    assert.ok(read.ok);
    if (!read.ok) return;
    assert.deepEqual([read.from, read.items[0].note], [1, "Read"]);
    const shown = [first, arrived, read].reduce((had, next) => withIncrement(had, next, 100), [] as typeof first.items);
    const full = new TranscriptReader(piggery).read(db, "X1", { limit: 100, person: "ME" });
    assert.ok(full.ok);
    if (full.ok) assert.deepEqual(shown, full.items);
  } finally {
    piggery.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a log row keeps its id when mail lands before it, so the row is not remounted", () => {
  const dir = fakePiggery();
  const piggery = new PiggeryDb();
  try {
    const db = path.join(dir, "piggery.db");
    const at = (s: number) => new Date(s * 1000).toISOString();
    const say = (text: string, s: number) => JSON.stringify({ type: "assistant", timestamp: at(s), message: { role: "assistant", content: [{ type: "text", text }] } });
    mkdirSync(path.join(dir, "logs", "X1"), { recursive: true });
    writeFileSync(path.join(dir, "logs", "X1", "RUN1.jsonl"), [say("one", 10), say("two", 20)].join("\n") + "\n");
    const write = new DatabaseSync(db);
    write.exec("CREATE TABLE messages (id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, team_id TEXT, from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT, reply_to TEXT, op TEXT, body TEXT NOT NULL, created_at INTEGER NOT NULL, acked_at INTEGER, held_reason TEXT)");
    const reader = new TranscriptReader(piggery);
    const before = reader.read(db, "X1", { limit: 100, person: "ME" });
    write.exec("INSERT INTO messages VALUES ('m1', 1, 'T', 'ME', 'X1', NULL, NULL, NULL, 'between', 15000, NULL, NULL)");
    write.close();
    const after = reader.read(db, "X1", { limit: 100, person: "ME", since: before.ok ? before : undefined });
    assert.ok(before.ok && after.ok);
    if (!before.ok || !after.ok) return;
    const idOf = (items: typeof before.items, text: string) => streamOfLog(items).find((row) => "text" in row && row.text === text)?.id;
    const shown = withIncrement(before.items, after, 100);
    assert.deepEqual(shown.map((i) => i.text), ["one", "between", "two"]);
    assert.equal(idOf(shown, "two"), idOf(before.items, "two"));
  } finally {
    piggery.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
