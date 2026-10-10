import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { identityFile, Person } from "./person.ts";

type Request = { id: string; verb: string; args: Record<string, unknown> };

async function fakeDaemon(home: string, answer: (req: Request) => { result?: unknown; error?: unknown }) {
  const verbs: string[] = [];
  const server = net.createServer((sock) => {
    sock.on("error", () => {});
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let end: number;
      while ((end = buf.indexOf("\n")) >= 0) {
        const req = JSON.parse(buf.slice(0, end)) as Request;
        buf = buf.slice(end + 1);
        verbs.push(req.verb);
        sock.write(JSON.stringify({ id: req.id, ...answer(req) }) + "\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(path.join(home, "piggery.sock"), resolve));
  return { verbs, close: () => server.close() };
}

test("the person joins on its first send, keeps its identity in piggery's home, and is told which gate to write to when refused", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "person-home-"));
  const daemon = await fakeDaemon(home, (req) => {
    if (req.verb === "join.auto") return { result: { id: "P1", token: "T1", run_id: "R1" } };
    if (req.verb === "identify") return { result: { participant_id: "P1", run_id: "R1", name: "otter" } };
    if (req.verb === "send" && req.args.to === "lead") return { result: { id: "m1", seq: 7 } };
    if (req.verb === "send") return { error: { code: "denied", message: "write to the gate", details: { gate_id: "G1", gate: "ilya" } } };
    return { result: {} };
  });
  const me = new Person();
  try {
    assert.deepEqual(await me.send(home, { to: "lead", body: "hi" }), { ok: true, id: "m1", seq: 7 });
    assert.deepEqual([daemon.verbs.slice(0, 2), daemon.verbs.includes("send")], [["join.auto", "identify"], true]);
    assert.ok(existsSync(identityFile(home)));
    assert.deepEqual(me.current(home)?.name, "otter");
    assert.deepEqual(await me.send(home, { to: "peer", body: "hi" }), { ok: false, code: "denied", error: "write to the gate", gate: "G1", gate_name: "ilya" });
  } finally {
    me.stop();
    daemon.close();
    rmSync(home, { recursive: true, force: true });
  }
});
