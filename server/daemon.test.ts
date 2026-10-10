import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CLI_MODULES, cliUtils, DAEMON_METHODS, daemonCall, DICTATION_METHODS } from "./daemon.ts";

function fakeCli(client: string): { dir: string; restore: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "fake-paseo-"));
  mkdirSync(path.join(dir, "bin"));
  mkdirSync(path.join(dir, "dist", "utils"), { recursive: true });
  writeFileSync(path.join(dir, "bin", "paseo"), "");
  writeFileSync(path.join(dir, "dist", "utils", "client.js"), `export async function connectToDaemon() { return ${client}; }\n`);
  writeFileSync(path.join(dir, "dist", "utils", "daemon-target.js"), "export function selectDaemonTarget() { return {}; }\n");
  const had = process.env.PATH;
  process.env.PATH = path.join(dir, "bin");
  return { dir, restore: () => ((process.env.PATH = had), rmSync(dir, { recursive: true, force: true })) };
}

test("a daemon call runs the method on Paseo's client with its arguments, bytes intact, and reports the client's error", async () => {
  const cli = fakeCli(`{
    uploadFile: async ({ fileName, bytes }) => ({ fileName, size: bytes.length, isBuffer: Buffer.isBuffer(bytes) }),
    rewindAgent: async () => { throw new Error("no such message"); },
    close: async () => {},
  }`);
  try {
    assert.deepEqual(await daemonCall("uploadFile", [{ fileName: "a.bin", mimeType: "application/octet-stream", bytes: Buffer.from([1, 2, 3]) }]), { ok: true, value: { fileName: "a.bin", size: 3, isBuffer: true } });
    assert.deepEqual(await daemonCall("rewindAgent", ["A", "M", "both"]), { ok: false, error: "no such message" });
    process.env.PATH = path.join(cli.dir, "dist");
    assert.deepEqual(await daemonCall("getCheckoutStatus", ["/nowhere"]), { ok: false, error: "The paseo CLI was not found on the daemon's PATH." });
  } finally {
    cli.restore();
  }
});

test("the installed paseo CLI still has the internal modules and client methods the bridge calls", { skip: cliUtils() === null && "no paseo CLI on PATH" }, () => {
  const utils = cliUtils() as string;
  for (const [file, name] of Object.entries(CLI_MODULES)) assert.match(readFileSync(path.join(utils, file.replace(/\.js$/, ".d.ts")), "utf8"), new RegExp(`export declare function ${name}\\b`), `${file} no longer exports ${name}`);
  const declarations = createRequire(path.join(utils, "client.js")).resolve("@getpaseo/client/internal/daemon-client").replace(/\.js$/, ".d.ts");
  assert.ok(existsSync(declarations));
  const client = readFileSync(declarations, "utf8");
  for (const method of [...DAEMON_METHODS, ...DICTATION_METHODS, "close"]) assert.match(client, new RegExp(`^\\s+${method}\\(`, "m"), `DaemonClient no longer has ${method}`);
});
