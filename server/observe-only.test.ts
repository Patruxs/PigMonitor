import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import contribute, { OBSERVE_ONLY_REFUSAL } from "../index.server.ts";
import * as rpc from "../shared/rpc.ts";

const CHANGES = ["pigmonitor.send", "pigmonitor.stop", "pigmonitor.step-in", "pigmonitor.rewind", "pigmonitor.agent-config", "pigmonitor.resume", "pigmonitor.upload"];
const LOOKS = ["pigmonitor.snapshot", "pigmonitor.tail", "pigmonitor.mail", "pigmonitor.transcript", "pigmonitor.image", "pigmonitor.prompt-images", "pigmonitor.person", "pigmonitor.sessions", "pigmonitor.forge-search", "pigmonitor.dir-suggest", "pigmonitor.checkout-remote", "pigmonitor.dictation-status", "pigmonitor.transcribe", "pigmonitor.notify-status", "pigmonitor.timeline-prompts", "pigmonitor.timeline-search", "pigmonitor.usage-reports", "pigmonitor.models"];

test("an observe-only daemon refuses every RPC that changes something and never joins piggery as the person", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "observe-home-"));
  const piggery = path.join(home, ".piggery");
  mkdirSync(piggery);
  writeFileSync(path.join(piggery, "paseo-person.json"), JSON.stringify({ id: "P", token: "T", run_id: "R", name: "me" }));
  let connections = 0;
  const daemon = net.createServer((sock) => {
    connections++;
    sock.destroy();
  });
  await new Promise<void>((resolve) => daemon.listen(path.join(piggery, "piggery.sock"), resolve));
  const had = { home: process.env.HOME, path: process.env.PATH, observe: process.env.PIGMONITOR_OBSERVE_ONLY };
  process.env.HOME = home;
  process.env.PATH = home;
  process.env.PIGMONITOR_OBSERVE_ONLY = "1";
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const host = {
    registerSettings: () => ({ read: async () => ({ status: "ready", revision: "1", values: { path: path.join(home, "no-piggery"), database: path.join(home, "no.db") } }), subscribe: () => () => {} }),
    handle: (contract: { name: string }, handler: (input: unknown) => Promise<unknown>) => handlers.set(contract.name, handler),
  } as unknown as PluginServerContext;
  const stop = contribute(host) as () => void;
  try {
    const contracts = Object.values(rpc).flatMap((value) => (value && typeof value === "object" && "name" in value && "input" in value && "output" in value && typeof value.name === "string" ? [value.name] : []));
    assert.deepEqual([...handlers.keys()].sort(), [...contracts].sort());
    assert.deepEqual([...contracts].sort(), [...CHANGES, ...LOOKS].sort());
    for (const name of CHANGES) assert.deepEqual(await handlers.get(name)?.({}), OBSERVE_ONLY_REFUSAL, name);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(connections, 0);
  } finally {
    stop();
    daemon.close();
    process.env.HOME = had.home;
    process.env.PATH = had.path;
    if (had.observe === undefined) delete process.env.PIGMONITOR_OBSERVE_ONLY;
    else process.env.PIGMONITOR_OBSERVE_ONLY = had.observe;
    rmSync(home, { recursive: true, force: true });
  }
});
