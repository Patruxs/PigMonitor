import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { listModels, pickBin, runPiggery, stepInArgs, tailView } from "./piggery.ts";

function fakeBin(script: string): { bin: string; done: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "fake-piggery-"));
  const bin = path.join(dir, "piggery");
  writeFileSync(bin, `#!/bin/sh\n${script}\n`);
  chmodSync(bin, 0o755);
  return { bin, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the binary is the user's setting, else the piggery that installed the plugin, else piggery on PATH", () => {
  assert.deepEqual([pickBin(" /opt/p ", "/i/p"), pickBin("", "/i/p"), pickBin("", "")], ["/opt/p", "/i/p", "piggery"]);
});

test("piggery runs without a shell and always with --no-start, so a read never starts its daemon", async () => {
  const fake = fakeBin('printf "%s|" "$@"');
  try {
    assert.deepEqual(await runPiggery(fake.bin, ["tail", "a;b $(x)"]), { ok: true, out: "tail|a;b $(x)|--no-start|" });
  } finally {
    fake.done();
  }
});

test("piggery's failures are told apart: not installed, daemon down, too old for a flag, too slow, anything else", async () => {
  const down = fakeBin('echo "Error: the piggery daemon is not running" >&2; exit 1');
  const old = fakeBin('echo "flag provided but not defined: -view" >&2; exit 2');
  const slow = fakeBin("sleep 2");
  const other = fakeBin('echo "boom" >&2; exit 3');
  try {
    const codes = [await runPiggery("/nowhere/piggery", ["ps"]), await runPiggery(down.bin, ["ps"]), await runPiggery(old.bin, ["ps", "--view"]), await runPiggery(slow.bin, ["ps"], 200), await runPiggery(other.bin, ["ps"])].map((r) => (r.ok ? "ok" : r.code));
    assert.deepEqual(codes, ["missing", "down", "older", "failed", "failed"]);
  } finally {
    for (const f of [down, old, slow, other]) f.done();
  }
});

test("tail --view is read only at the version this plugin speaks", async () => {
  const at = (doc: string) => fakeBin(`echo '${doc}'`);
  const fakes = [at('{"version":0,"lines":[]}'), at('{"version":2,"lines":[]}'), at('{"version":1,"lines":[{"kind":"text","text":"hi"}]}'), at("not json"), at('{"version":1,"lines":[{"kind":"shout","text":"hi"}]}')];
  try {
    const results = await Promise.all(fakes.map((f) => tailView(f.bin, "w1", 5)));
    assert.deepEqual(results.map((r) => (r.ok ? r.lines : r.code)), ["older", "newer", [{ kind: "text", text: "hi" }], "failed", "failed"]);
  } finally {
    for (const f of fakes) f.done();
  }
});

test("a step-in becomes piggery's own verb; a model change needs a model or a thinking level", () => {
  assert.deepEqual(stepInArgs({ verb: "kill", id: "w1" }), ["kill", "w1"]);
  assert.deepEqual(stepInArgs({ verb: "model", id: "w1", model: "HP/k3", thinking: "high" }), ["model", "w1", "HP/k3", "--thinking", "high"]);
  assert.deepEqual(stepInArgs({ verb: "model", id: "w1", thinking: "low" }), ["model", "w1", "--thinking", "low"]);
  assert.equal(stepInArgs({ verb: "model", id: "w1" }), null);
});

test("models are asked over piggery's admin socket with its admin token, and an answer in another shape is refused", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "fake-home-"));
  writeFileSync(path.join(home, "admin.token"), "secret\n");
  let asked: unknown;
  let answer: unknown = { models: ["a/b", "c/d"] };
  const daemon = net.createServer((sock) => sock.on("data", (chunk) => {
    asked = JSON.parse(chunk.toString("utf8"));
    sock.write(JSON.stringify({ id: "1", ok: true, result: answer }) + "\n");
  }));
  await new Promise<void>((resolve) => daemon.listen(path.join(home, "piggery.sock"), resolve));
  try {
    assert.deepEqual(await listModels(home, "w1"), { ok: true, models: ["a/b", "c/d"] });
    assert.deepEqual(asked, { id: "1", verb: "models", admin_token: "secret", args: { target: "w1" } });
    answer = { models: "a/b" };
    assert.equal((await listModels(home, "w1")).ok, false);
    const none = mkdtempSync(path.join(tmpdir(), "fake-home-"));
    assert.equal((await listModels(none, "w1")).ok, false);
    rmSync(none, { recursive: true, force: true });
  } finally {
    daemon.close();
    rmSync(home, { recursive: true, force: true });
  }
});
