import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resumable, type Session } from "../shared/native.ts";

export type Resumed = { ok: true; agentId: string } | { ok: false; code: "failed" | "denied"; error: string };

const TIMEOUT_MS = 30000;

function runPaseo(args: string[]): Promise<{ ok: true; out: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    execFile("paseo", [...args, "--json"], { timeout: TIMEOUT_MS, maxBuffer: 16 << 20, env: { ...process.env, NO_COLOR: "1" } }, (error, stdout, stderr) => {
      if (!error) return resolve({ ok: true, out: stdout });
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return resolve({ ok: false, error: "The paseo CLI was not found on the daemon's PATH." });
      resolve({ ok: false, error: String(stderr).trim() || err.message });
    });
  });
}

export function labelOf(id: string): string {
  return `piggery=${id}`;
}

async function imported(id: string): Promise<string | null> {
  const r = await runPaseo(["ls", "--all", "--global", "--label", labelOf(id)]);
  if (!r.ok) return null;
  try {
    const list = JSON.parse(r.out) as { id?: string }[];
    return list.find((a) => typeof a.id === "string")?.id ?? null;
  } catch {
    return null;
  }
}

export async function resumeInPaseo(session: Session | undefined): Promise<Resumed> {
  if (!session || !resumable(session)) return { ok: false, code: "denied", error: "Only an ended claude session can be resumed in Paseo; a live one is still owned by its process." };
  const before = await imported(session.id);
  if (before) return { ok: true, agentId: before };
  const r = await runPaseo(["import", session.ref as string, "--provider", "claude", "--cwd", session.cwd, "--label", labelOf(session.id)]);
  if (!r.ok) return { ok: false, code: "failed", error: `paseo import failed: ${r.error}` };
  try {
    const agentId = (JSON.parse(r.out) as { agentId?: unknown }).agentId;
    if (typeof agentId === "string") return { ok: true, agentId };
  } catch {}
  return { ok: false, code: "failed", error: "paseo import did not print an agent id." };
}

export async function stopAgent(agentId: string): Promise<{ ok: true } | { ok: false; code: "failed"; error: string }> {
  const r = await runPaseo(["agent", "stop", agentId]);
  return r.ok ? { ok: true } : { ok: false, code: "failed", error: `Paseo did not stop the agent: ${r.error}` };
}

export type AgentField = "model" | "mode" | "thinking";

const CONFIGURE = `
const [utils, field, agentId, value] = process.argv.slice(1);
const { connectToDaemon } = await import(utils + "/client.js");
const { selectDaemonTarget } = await import(utils + "/daemon-target.js");
const client = await connectToDaemon({ target: selectDaemonTarget({}) });
try {
  if (field === "model") await client.setAgentModel(agentId, value || null);
  else if (field === "mode") await client.setAgentMode(agentId, value);
  else await client.setAgentThinkingOption(agentId, value || null);
} finally {
  await client.close();
}
`;

function cliUtils(): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const bin = path.join(dir, "paseo");
    if (!dir || !existsSync(bin)) continue;
    const utils = path.join(path.dirname(realpathSync(bin)), "..", "dist", "utils");
    if (existsSync(path.join(utils, "client.js")) && existsSync(path.join(utils, "daemon-target.js"))) return utils;
  }
  return null;
}

export function configureAgent(agentId: string, field: AgentField, value: string | null): Promise<{ ok: true } | { ok: false; code: "failed"; error: string }> {
  const utils = cliUtils();
  if (!utils) return Promise.resolve({ ok: false, code: "failed", error: "The paseo CLI was not found on the daemon's PATH, so the agent's settings cannot be changed from here." });
  return new Promise((resolve) => {
    execFile(process.execPath, ["--input-type=module", "-e", CONFIGURE, pathToFileURL(utils).href, field, agentId, value ?? ""], { timeout: TIMEOUT_MS, env: { ...process.env, NO_COLOR: "1" } }, (error, _stdout, stderr) => {
      if (!error) return resolve({ ok: true });
      const said = /^\w*Error: (.+)$/m.exec(String(stderr))?.[1] ?? String(stderr).trim();
      resolve({ ok: false, code: "failed", error: `Paseo did not change the ${field}: ${said || error.message}` });
    });
  });
}
