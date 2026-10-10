import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createLinker, forkParentOf, type Link, type StoredLinks } from "./links.ts";

function claudeProject(): { dir: string; done: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "claude-project-"));
  const image = "A".repeat(200_000);
  writeFileSync(path.join(dir, "c0af857a.jsonl"), `${JSON.stringify({ type: "user", sessionId: "c0af857a", message: { content: [{ type: "image", data: image }] }, forkedFrom: { sessionId: "ac2c96a6", messageUuid: "m1" } })}\n${JSON.stringify({ type: "assistant", sessionId: "c0af857a" })}\n`);
  writeFileSync(path.join(dir, "ac2c96a6.jsonl"), `${JSON.stringify({ type: "user", sessionId: "ac2c96a6" })}\n`);
  writeFileSync(path.join(dir, "11111111.jsonl"), `${JSON.stringify({ type: "user", sessionId: "11111111", forkedFrom: { sessionId: "ac2c96a6", messageUuid: "m0" } })}\n`);
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

function memoryStore(links: Link[] = []) {
  let saved: StoredLinks = { links, previous: [] };
  return { load: () => saved, save: (state: StoredLinks) => void (saved = state), saved: () => saved };
}

test("a Paseo agent whose Claude session forked from a piggery session is linked to that participant with no earlier match, and a reloaded linker checks the link once", () => {
  const project = claudeProject();
  try {
    const store = memoryStore();
    const tundra = { id: "tundra", ref: "ac2c96a6", transcript: path.join(project.dir, "ac2c96a6.jsonl") };
    const agents = [{ agentId: "fe6455cd", sessionId: "c0af857a", archived: false }];
    assert.equal(forkParentOf(path.join(project.dir, "c0af857a.jsonl")), "ac2c96a6");
    assert.deepEqual(createLinker({ store }).links(agents, [tundra]).links, [{ participantId: "tundra", agentId: "fe6455cd" }]);
    const reads: string[] = [];
    const reloaded = createLinker({ store, readParent: (file) => (reads.push(file), forkParentOf(file)) });
    assert.deepEqual(reloaded.links(agents, [tundra]).links, [{ participantId: "tundra", agentId: "fe6455cd" }]);
    assert.deepEqual(reloaded.links(agents, [tundra]).links, [{ participantId: "tundra", agentId: "fe6455cd" }]);
    assert.equal(reads.length, 1);
  } finally {
    project.done();
  }
});

test("an agent that another participant exact-matches is never linked by the fork walk, and a link is never overwritten", () => {
  const project = claudeProject();
  try {
    const tundra = { id: "tundra", ref: "ac2c96a6", transcript: path.join(project.dir, "ac2c96a6.jsonl") };
    const tern = { id: "tern", ref: "c0af857a", transcript: null };
    assert.deepEqual(createLinker({ store: memoryStore() }).links([{ agentId: "fe6455cd", sessionId: "c0af857a", archived: false }], [tundra, tern]).links, [{ participantId: "tern", agentId: "fe6455cd" }]);
    const kept = createLinker({ store: memoryStore([{ participantId: "tundra", agentId: "first" }]) }).links([{ agentId: "first", sessionId: "11111111", archived: false }, { agentId: "fe6455cd", sessionId: "c0af857a", archived: false }], [tundra]).links;
    assert.deepEqual(kept, [{ participantId: "tundra", agentId: "first" }]);
  } finally {
    project.done();
  }
});

test("linking reads each new agent session once, only in the folders of piggery's own sessions, and not at all when every session matches", () => {
  const project = claudeProject();
  try {
    const reads: string[] = [];
    const readParent = (file: string) => (reads.push(file), forkParentOf(file));
    const linker = createLinker({ store: memoryStore(), readParent });
    const tundra = { id: "tundra", ref: "ac2c96a6", transcript: path.join(project.dir, "ac2c96a6.jsonl") };
    const agents = [
      { agentId: "fe6455cd", sessionId: "c0af857a", archived: false },
      { agentId: "elsewhere", sessionId: "99999999", archived: false },
    ];
    linker.links(agents, [tundra]);
    assert.deepEqual(reads.map((file) => path.relative(project.dir, file)).sort(), ["99999999.jsonl", "c0af857a.jsonl"]);
    reads.length = 0;
    linker.links(agents, [tundra]);
    assert.deepEqual(reads, []);
    createLinker({ store: memoryStore(), readParent }).links([{ agentId: "a", sessionId: "ac2c96a6", archived: false }], [tundra]);
    assert.deepEqual(reads, []);
  } finally {
    project.done();
  }
});

test("a link learned while the session ids match holds after a conversation rewind forks the session, and a participant whose agent another session takes is remembered as formerly linked", () => {
  const store = memoryStore();
  const readParent = (file: string) => (path.basename(file) === "c0af857a.jsonl" ? "ac2c96a6" : null);
  const linker = createLinker({ store, readParent });
  const tundra = { id: "tundra", ref: "ac2c96a6", transcript: "/p/ac2c96a6.jsonl" };
  assert.deepEqual(linker.links([{ agentId: "fe6455cd", sessionId: "ac2c96a6", archived: false }], [tundra]), { links: [{ participantId: "tundra", agentId: "fe6455cd" }], formerly: [] });
  assert.deepEqual(createLinker({ store, readParent }).links([{ agentId: "fe6455cd", sessionId: "c0af857a", archived: false }], [tundra]), { links: [{ participantId: "tundra", agentId: "fe6455cd" }], formerly: [] });
  assert.deepEqual(createLinker({ store, readParent }).links([], [tundra]).links, [{ participantId: "tundra", agentId: "fe6455cd" }]);
  const tern = { id: "tern", ref: "c0af857a", transcript: null };
  assert.deepEqual(createLinker({ store, readParent }).links([{ agentId: "fe6455cd", sessionId: "c0af857a", archived: false }], [tundra, tern]), { links: [{ participantId: "tern", agentId: "fe6455cd" }], formerly: [{ participantId: "tundra", heldBy: "tern" }] });
});

test("the fork parent is found past a first line of any size, and quoted text that mentions forkedFrom is not mistaken for it", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "claude-project-"));
  try {
    const file = path.join(dir, "big.jsonl");
    const quoted = JSON.stringify({ text: 'a note: "forkedFrom":{"sessionId":"not-this"}' });
    writeFileSync(file, `${JSON.stringify({ type: "user", sessionId: "big", note: quoted, message: { content: [{ type: "image", data: "A".repeat(5 << 20) }] }, forkedFrom: { sessionId: "ac2c96a6", messageUuid: "m1" } })}\n`);
    assert.equal(forkParentOf(file), "ac2c96a6");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a link to an agent Paseo no longer has is dropped, and the participant is not left formerly linked", () => {
  const linker = createLinker({ store: memoryStore(), readParent: () => null });
  const tundra = { id: "tundra", ref: "ac2c96a6", transcript: null };
  linker.links([{ agentId: "fe6455cd", sessionId: "ac2c96a6", archived: false }], [tundra]);
  assert.deepEqual(linker.links([], [tundra], []).links, [{ participantId: "tundra", agentId: "fe6455cd" }]);
  assert.deepEqual(linker.links([], [tundra], ["fe6455cd"]), { links: [], formerly: [] });
});

test("a participant stays formerly linked only while another session holds its last agent", () => {
  const store = memoryStore();
  const tundra = { id: "tundra", ref: "ac2c96a6", transcript: null };
  const tern = { id: "tern", ref: "c0af857a", transcript: null };
  createLinker({ store, readParent: () => null }).links([{ agentId: "fe6455cd", sessionId: "ac2c96a6", archived: false }], [tundra]);
  const linker = createLinker({ store, readParent: () => null });
  assert.deepEqual(linker.links([{ agentId: "fe6455cd", sessionId: "c0af857a", archived: false }], [tundra, tern]).formerly, [{ participantId: "tundra", heldBy: "tern" }]);
  assert.deepEqual(linker.links([{ agentId: "fe6455cd", sessionId: "99999999", archived: false }], [tundra, { ...tern, ref: "77777777" }]).formerly, []);
});

test("a remembered link ends when its agent moves to a session that does not descend from the participant's", () => {
  const linker = createLinker({ store: memoryStore(), readParent: () => null });
  const tundra = { id: "tundra", ref: "ac2c96a6", transcript: "/p/ac2c96a6.jsonl" };
  linker.links([{ agentId: "fe6455cd", sessionId: "ac2c96a6", archived: false }], [tundra]);
  assert.deepEqual(linker.links([{ agentId: "fe6455cd", sessionId: "unrelated", archived: false }], [tundra]), { links: [], formerly: [] });
});
