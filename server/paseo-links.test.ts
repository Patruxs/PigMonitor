import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import contribute from "../index.server.ts";
import { paseoLinks } from "../shared/rpc.ts";

test("the server links sessions from the agent list the client sends and lists no agents through Paseo itself", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "links-home-"));
  const file = path.join(home, "piggery.db");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE participants (id TEXT PRIMARY KEY, harness TEXT, session_ref TEXT, harness_ref TEXT, transcript TEXT); INSERT INTO participants VALUES ('tundra', 'claude', 'ac2c96a6', NULL, NULL);");
  db.close();
  const had = { home: process.env.HOME, path: process.env.PATH, observe: process.env.PIGMONITOR_OBSERVE_ONLY };
  process.env.HOME = home;
  process.env.PATH = home;
  process.env.PIGMONITOR_OBSERVE_ONLY = "1";
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const host = {
    registerSettings: () => ({ read: async () => ({ status: "ready", revision: "1", values: { path: path.join(home, "no-piggery"), database: file } }), subscribe: () => () => {} }),
    handle: (contract: { name: string }, handler: (input: unknown) => Promise<unknown>) => handlers.set(contract.name, handler),
  } as unknown as PluginServerContext;
  const stop = contribute(host) as () => void;
  try {
    const reply = await handlers.get(paseoLinks.name)?.({ agents: [{ agentId: "fe6455cd", sessionId: "ac2c96a6", archived: false }] });
    assert.deepEqual(reply, { ok: true, links: [{ participantId: "tundra", agentId: "fe6455cd" }], formerly: [] });
  } finally {
    stop();
    process.env.HOME = had.home;
    process.env.PATH = had.path;
    if (had.observe === undefined) delete process.env.PIGMONITOR_OBSERVE_ONLY;
    else process.env.PIGMONITOR_OBSERVE_ONLY = had.observe;
    rmSync(home, { recursive: true, force: true });
  }
});
