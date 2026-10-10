import { execFile, spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resumable, type Session } from "../shared/native.ts";
import { UsageReportEntry, type UsageReportEntryData } from "../shared/usage-schema.ts";
import { directoryEntriesOf, type DirectoryEntry } from "../shared/autocomplete.ts";
import { ForgeItem, type ForgeItemData, type UploadedFileData } from "../shared/rpc.ts";

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

export type AgentField = "model" | "mode" | "thinking" | "feature";

export type ProviderNoticeData = { type: "info" | "warning" | "error"; message: string };

const CONFIGURE = `
const [utils, field, agentId, featureId, json] = process.argv.slice(1);
const value = JSON.parse(json);
const { connectToDaemon } = await import(utils + "/client.js");
const { selectDaemonTarget } = await import(utils + "/daemon-target.js");
const client = await connectToDaemon({ target: selectDaemonTarget({}) });
try {
  let notice = null;
  if (field === "model") await client.setAgentModel(agentId, value);
  else if (field === "mode") notice = await client.setAgentMode(agentId, value);
  else if (field === "thinking") notice = await client.setAgentThinkingOption(agentId, value);
  else await client.setAgentFeature(agentId, featureId, value);
  process.stdout.write(JSON.stringify({ notice: notice ?? null }));
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

function runDaemonScript(script: string, args: string[], input?: string): Promise<{ ok: true; out: string } | { ok: false; error: string }> {
  const utils = cliUtils();
  if (!utils) return Promise.resolve({ ok: false, error: "The paseo CLI was not found on the daemon's PATH." });
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, pathToFileURL(utils).href, ...args], { env: { ...process.env, NO_COLOR: "1" }, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ ok: true, out: Buffer.concat(out).toString("utf8") });
      const stderr = Buffer.concat(err).toString("utf8");
      const said = /^\w*Error: (.+)$/m.exec(stderr)?.[1] ?? stderr.trim();
      resolve({ ok: false, error: said || `exited with ${code ?? "a signal"}` });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}

export async function configureAgent(agentId: string, field: AgentField, value: string | boolean | null, featureId?: string): Promise<{ ok: true; notice: ProviderNoticeData | null } | { ok: false; code: "failed"; error: string }> {
  if (!cliUtils()) return { ok: false, code: "failed", error: "The paseo CLI was not found on the daemon's PATH, so the agent's settings cannot be changed from here." };
  if (field === "feature" && !featureId) return { ok: false, code: "failed", error: "No feature was named." };
  const r = await runDaemonScript(CONFIGURE, [field, agentId, featureId ?? "", JSON.stringify(value)]);
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo did not change the ${field}: ${r.error}` };
  try {
    const notice = (JSON.parse(r.out) as { notice?: ProviderNoticeData | null }).notice ?? null;
    return { ok: true, notice };
  } catch {
    return { ok: true, notice: null };
  }
}

const USAGE_REPORTS = `
const [utils, json] = process.argv.slice(1);
const options = JSON.parse(json);
const { connectToDaemon } = await import(utils + "/client.js");
const { selectDaemonTarget } = await import(utils + "/daemon-target.js");
const client = await connectToDaemon({ target: selectDaemonTarget({}) });
try {
  process.stdout.write(JSON.stringify(await client.listUsageReports(options)));
} finally {
  await client.close();
}
`;

export async function listUsageReports(options: { agentId?: string; forceRefresh?: boolean; reportIds?: string[] }): Promise<{ ok: true; reports: UsageReportEntryData[] } | { ok: false; code: "older" | "failed"; error: string }> {
  const r = await runDaemonScript(USAGE_REPORTS, [JSON.stringify(options)]);
  if (!r.ok) return { ok: false, code: /Update the host/.test(r.error) ? "older" : "failed", error: r.error };
  try {
    const reports = ((JSON.parse(r.out) as { reports?: unknown[] }).reports ?? []).flatMap((report) => {
      const parsed = UsageReportEntry.safeParse(report);
      return parsed.success ? [parsed.data] : [];
    });
    return { ok: true, reports };
  } catch {
    return { ok: false, code: "failed", error: "The usage list did not print a result." };
  }
}

const UPLOAD = `
const [utils] = process.argv.slice(1);
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { fileName, mimeType, data } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const { connectToDaemon } = await import(utils + "/client.js");
const { selectDaemonTarget } = await import(utils + "/daemon-target.js");
const client = await connectToDaemon({ target: selectDaemonTarget({}) });
try {
  process.stdout.write(JSON.stringify(await client.uploadFile({ fileName, mimeType, bytes: Buffer.from(data, "base64") })));
} finally {
  await client.close();
}
`;

export async function uploadFile(fileName: string, mimeType: string, data: string): Promise<{ ok: true; file: UploadedFileData } | { ok: false; code: "failed"; error: string }> {
  const r = await runDaemonScript(UPLOAD, [], JSON.stringify({ fileName, mimeType, data }));
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo did not take the file: ${r.error}` };
  try {
    const result = JSON.parse(r.out) as { file: UploadedFileData | null; error: string | null };
    if (result.file && !result.error) return { ok: true, file: result.file };
    return { ok: false, code: "failed", error: result.error ?? "Upload failed." };
  } catch {
    return { ok: false, code: "failed", error: "The upload did not print a result." };
  }
}

const FORGE_SEARCH = `
const [utils, cwd, query] = process.argv.slice(1);
const { connectToDaemon } = await import(utils + "/client.js");
const { selectDaemonTarget } = await import(utils + "/daemon-target.js");
const client = await connectToDaemon({ target: selectDaemonTarget({}) });
try {
  process.stdout.write(JSON.stringify(await client.searchForge({ cwd, query, limit: 20 })));
} finally {
  await client.close();
}
`;

export async function searchForge(cwd: string, query: string): Promise<{ ok: true; items: ForgeItemData[]; authState: string; error: string | null } | { ok: false; code: "failed"; error: string }> {
  const r = await runDaemonScript(FORGE_SEARCH, [cwd, query.trim()]);
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo could not search issues and PRs: ${r.error}` };
  try {
    const result = JSON.parse(r.out) as { items?: unknown[]; authState?: string; error?: string | null };
    const items = (result.items ?? []).flatMap((item) => {
      const parsed = ForgeItem.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    return { ok: true, items, authState: result.authState ?? "unauthenticated", error: result.error ?? null };
  } catch {
    return { ok: false, code: "failed", error: "The search did not print a result." };
  }
}

const TIMELINE_PROMPTS = `
const [utils, agentId] = process.argv.slice(1);
const { connectToDaemon } = await import(utils + "/client.js");
const { selectDaemonTarget } = await import(utils + "/daemon-target.js");
const client = await connectToDaemon({ target: selectDaemonTarget({}) });
try {
  process.stdout.write(JSON.stringify(await client.listAgentTimelinePrompts(agentId)));
} finally {
  await client.close();
}
`;

export async function listTimelinePrompts(agentId: string): Promise<{ ok: true; epoch: string; prompts: { seq: number; timestamp: string; preview: string }[] } | { ok: false; code: "failed"; error: string }> {
  const r = await runDaemonScript(TIMELINE_PROMPTS, [agentId]);
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo did not list the prompts: ${r.error}` };
  try {
    const result = JSON.parse(r.out) as { epoch?: string; prompts?: { seq: number; timestamp: string; preview: string }[]; error?: string | null };
    if (result.error || typeof result.epoch !== "string") return { ok: false, code: "failed", error: result.error ?? "No prompt index." };
    return { ok: true, epoch: result.epoch, prompts: result.prompts ?? [] };
  } catch {
    return { ok: false, code: "failed", error: "The prompt list did not print a result." };
  }
}

const REWIND = `
const [utils, agentId, messageId, mode] = process.argv.slice(1);
const { connectToDaemon } = await import(utils + "/client.js");
const { selectDaemonTarget } = await import(utils + "/daemon-target.js");
const client = await connectToDaemon({ target: selectDaemonTarget({}) });
try {
  process.stdout.write(JSON.stringify(await client.rewindAgent(agentId, messageId, mode)));
} finally {
  await client.close();
}
`;

export async function rewindAgent(agentId: string, messageId: string, mode: "conversation" | "files" | "both"): Promise<{ ok: true } | { ok: false; code: "failed"; error: string }> {
  const r = await runDaemonScript(REWIND, [agentId, messageId, mode]);
  if (!r.ok) return { ok: false, code: "failed", error: `Failed to rewind agent: ${r.error}` };
  try {
    const result = JSON.parse(r.out) as { ok?: boolean; error?: string | null };
    return result.ok ? { ok: true } : { ok: false, code: "failed", error: result.error ?? "Failed to rewind agent" };
  } catch {
    return { ok: false, code: "failed", error: "The rewind did not print a result." };
  }
}

const TIMELINE_SEARCH = `
const [utils, agentId, query, cursor] = process.argv.slice(1);
const { connectToDaemon } = await import(utils + "/client.js");
const { selectDaemonTarget } = await import(utils + "/daemon-target.js");
const client = await connectToDaemon({ target: selectDaemonTarget({}) });
try {
  process.stdout.write(JSON.stringify(await client.searchAgentTimeline({ agentId, query, ...(cursor ? { cursor: Number(cursor) } : {}) })));
} finally {
  await client.close();
}
`;

export type TimelineSearchResult = { ok: true; epoch: string; locations: { seq: number; role: "user" | "assistant"; count?: number }[]; nextCursor: number | null } | { ok: false; code: "failed"; error: string };

export async function searchTimeline(agentId: string, query: string, cursor: number | undefined): Promise<TimelineSearchResult> {
  const r = await runDaemonScript(TIMELINE_SEARCH, [agentId, query, cursor === undefined ? "" : String(cursor)]);
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo could not search this chat: ${r.error}` };
  try {
    const result = JSON.parse(r.out) as { epoch?: string; locations?: { seq: number; role: "user" | "assistant"; count?: number }[]; nextCursor?: number | null; error?: string | null };
    if (result.error || typeof result.epoch !== "string") return { ok: false, code: "failed", error: result.error ?? "No search result." };
    return { ok: true, epoch: result.epoch, locations: result.locations ?? [], nextCursor: result.nextCursor ?? null };
  } catch {
    return { ok: false, code: "failed", error: "The search did not print a result." };
  }
}

const DIR_SUGGEST = `
const [utils, cwd, query] = process.argv.slice(1);
const { connectToDaemon } = await import(utils + "/client.js");
const { selectDaemonTarget } = await import(utils + "/daemon-target.js");
const client = await connectToDaemon({ target: selectDaemonTarget({}) });
try {
  process.stdout.write(JSON.stringify(await client.getDirectorySuggestions({ cwd, query, limit: 50, includeFiles: true, includeDirectories: true })));
} finally {
  await client.close();
}
`;

export async function suggestEntries(cwd: string, query: string): Promise<{ ok: true; entries: DirectoryEntry[] } | { ok: false; code: "failed"; error: string }> {
  const r = await runDaemonScript(DIR_SUGGEST, [cwd, query]);
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo could not search the workspace: ${r.error}` };
  try {
    const result = JSON.parse(r.out) as { entries?: { path: string; kind: string }[]; directories?: string[]; error?: string | null };
    if (result.error) return { ok: false, code: "failed", error: result.error };
    return { ok: true, entries: directoryEntriesOf(result) };
  } catch {
    return { ok: false, code: "failed", error: "The workspace search did not print a result." };
  }
}

const CHECKOUT_REMOTE = `
const [utils, cwd] = process.argv.slice(1);
const { connectToDaemon } = await import(utils + "/client.js");
const { selectDaemonTarget } = await import(utils + "/daemon-target.js");
const client = await connectToDaemon({ target: selectDaemonTarget({}) });
try {
  process.stdout.write(JSON.stringify(await client.getCheckoutStatus(cwd)));
} finally {
  await client.close();
}
`;

export async function checkoutRemoteUrl(cwd: string): Promise<{ ok: true; remoteUrl: string | null } | { ok: false; code: "failed"; error: string }> {
  const r = await runDaemonScript(CHECKOUT_REMOTE, [cwd]);
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo could not read the checkout: ${r.error}` };
  try {
    const result = JSON.parse(r.out) as { remoteUrl?: string | null };
    return { ok: true, remoteUrl: typeof result.remoteUrl === "string" ? result.remoteUrl : null };
  } catch {
    return { ok: false, code: "failed", error: "The checkout status did not print a result." };
  }
}
