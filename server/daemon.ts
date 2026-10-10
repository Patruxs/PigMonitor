import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface PaseoDaemonClient {
  setAgentModel(agentId: string, modelId: string | null): Promise<void>;
  setAgentMode(agentId: string, modeId: string): Promise<unknown>;
  setAgentThinkingOption(agentId: string, thinkingOptionId: string | null): Promise<unknown>;
  setAgentFeature(agentId: string, featureId: string, value: unknown): Promise<void>;
  listUsageReports(options?: { agentId?: string; forceRefresh?: boolean }): Promise<unknown>;
  uploadFile(input: { fileName: string; mimeType: string; bytes: Uint8Array }): Promise<unknown>;
  searchForge(options: { cwd: string; query: string; limit?: number }): Promise<unknown>;
  listAgentTimelinePrompts(agentId: string): Promise<unknown>;
  rewindAgent(agentId: string, messageId: string, mode: "conversation" | "files" | "both"): Promise<unknown>;
  searchAgentTimeline(options: { agentId: string; query: string; cursor?: number }): Promise<unknown>;
  getDirectorySuggestions(options: { query: string; limit?: number; cwd?: string; includeFiles?: boolean; includeDirectories?: boolean }): Promise<unknown>;
  getCheckoutStatus(cwd: string): Promise<unknown>;
  getLastServerInfoMessage(): unknown;
  fetchAgents(options: { filter?: { includeArchived?: boolean }; sort?: { key: string; direction: "asc" | "desc" }[]; page?: { limit: number; cursor?: string } }): Promise<unknown>;
  startDictationStream(dictationId: string, format: string): Promise<void>;
  sendDictationStreamChunk(dictationId: string, seq: number, audio: string, format: string): void;
  finishDictationStream(dictationId: string, finalSeq: number): Promise<unknown>;
  cancelDictationStream(dictationId: string): void;
}

export const DAEMON_TIMEOUT_MS = 30000;

export const DAEMON_METHODS = ["setAgentModel", "setAgentMode", "setAgentThinkingOption", "setAgentFeature", "listUsageReports", "uploadFile", "searchForge", "listAgentTimelinePrompts", "rewindAgent", "searchAgentTimeline", "getDirectorySuggestions", "getCheckoutStatus", "getLastServerInfoMessage", "fetchAgents"] as const satisfies readonly (keyof PaseoDaemonClient)[];

export const DICTATION_METHODS = ["startDictationStream", "sendDictationStreamChunk", "finishDictationStream", "cancelDictationStream"] as const satisfies readonly (keyof PaseoDaemonClient)[];

export const CLI_MODULES = { "client.js": "connectToDaemon", "daemon-target.js": "selectDaemonTarget" } as const;

export type DaemonMethod = (typeof DAEMON_METHODS)[number];

export type DaemonReply = { ok: true; value: unknown } | { ok: false; error: string };

const BRIDGE = `
const [utils, method] = process.argv.slice(1);
const input = [];
for await (const chunk of process.stdin) input.push(chunk);
const revive = (v) => Array.isArray(v) ? v.map(revive) : v && typeof v === "object" ? (typeof v.$bytes === "string" ? Buffer.from(v.$bytes, "base64") : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]))) : v;
const args = revive(JSON.parse(Buffer.concat(input).toString("utf8")));
const dictate = async (client, format, chunks) => {
  const dictationId = crypto.randomUUID();
  try {
    await client.startDictationStream(dictationId, format);
    chunks.forEach((audio, seq) => client.sendDictationStreamChunk(dictationId, seq, audio, format));
    return await client.finishDictationStream(dictationId, chunks.length - 1);
  } catch (error) {
    try { client.cancelDictationStream(dictationId); } catch {}
    throw error;
  }
};
const { connectToDaemon } = await import(utils + "/client.js");
const { selectDaemonTarget } = await import(utils + "/daemon-target.js");
const client = await connectToDaemon({ target: selectDaemonTarget({}) });
try {
  const result = method === "dictate" ? await dictate(client, ...args) : await client[method](...args);
  process.stdout.write(JSON.stringify(result ?? null));
} finally {
  await client.close();
}
`;

export function cliUtils(searchPath = process.env.PATH ?? ""): string | null {
  for (const dir of searchPath.split(path.delimiter)) {
    const bin = path.join(dir, "paseo");
    if (!dir || !existsSync(bin)) continue;
    const utils = path.join(path.dirname(realpathSync(bin)), "..", "dist", "utils");
    if (Object.keys(CLI_MODULES).every((file) => existsSync(path.join(utils, file)))) return utils;
  }
  return null;
}

function encoded(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(encoded);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encoded(v)]));
  return value;
}

function run(method: string, args: unknown[], timeoutMs: number): Promise<DaemonReply> {
  const utils = cliUtils();
  if (!utils) return Promise.resolve({ ok: false, error: "The paseo CLI was not found on the daemon's PATH." });
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", BRIDGE, pathToFileURL(utils).href, method], { env: { ...process.env, NO_COLOR: "1" }, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        try {
          return resolve({ ok: true, value: JSON.parse(Buffer.concat(out).toString("utf8")) });
        } catch {
          return resolve({ ok: false, error: `${method} did not print a result.` });
        }
      }
      const stderr = Buffer.concat(err).toString("utf8");
      const said = /^\w*Error: (.+)$/m.exec(stderr)?.[1] ?? stderr.trim();
      resolve({ ok: false, error: said || `exited with ${code ?? "a signal"}` });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(encoded(args)));
  });
}

export function daemonCall<M extends DaemonMethod>(method: M, args: Parameters<PaseoDaemonClient[M]>, timeoutMs = DAEMON_TIMEOUT_MS): Promise<DaemonReply> {
  return run(method, args, timeoutMs);
}

export function daemonDictation(format: string, chunks: string[], timeoutMs: number): Promise<DaemonReply> {
  return run("dictate", [format, chunks], timeoutMs);
}
