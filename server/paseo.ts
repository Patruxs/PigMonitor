import { execFile } from "node:child_process";
import { cliUtils, daemonCall } from "./daemon.ts";
import { resumable, type ParticipantRecord } from "../shared/chat-route.ts";
import { UsageReportEntry, type UsageReportEntryData } from "../shared/usage-schema.ts";
import { directoryEntriesOf, type DirectoryEntry } from "../shared/autocomplete.ts";
import type { AgentTimelineSearchPayload } from "../shared/chat-find.ts";
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

export async function resumeInPaseo(participant: ParticipantRecord | undefined): Promise<Resumed> {
  if (!participant || !resumable(participant)) return { ok: false, code: "denied", error: "Only an ended claude session can be resumed in Paseo; a live one is still owned by its process." };
  const before = await imported(participant.id);
  if (before) return { ok: true, agentId: before };
  const r = await runPaseo(["import", participant.ref as string, "--provider", "claude", "--cwd", participant.cwd, "--label", labelOf(participant.id)]);
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

function agentSetting(agentId: string, field: AgentField, value: string | boolean | null, featureId: string) {
  if (field === "model") return daemonCall("setAgentModel", [agentId, value as string | null]);
  if (field === "mode") return daemonCall("setAgentMode", [agentId, value as string]);
  if (field === "thinking") return daemonCall("setAgentThinkingOption", [agentId, value as string | null]);
  return daemonCall("setAgentFeature", [agentId, featureId, value]);
}

export async function configureAgent(agentId: string, field: AgentField, value: string | boolean | null, featureId?: string): Promise<{ ok: true; notice: ProviderNoticeData | null } | { ok: false; code: "failed"; error: string }> {
  if (!cliUtils()) return { ok: false, code: "failed", error: "The paseo CLI was not found on the daemon's PATH, so the agent's settings cannot be changed from here." };
  if (field === "feature" && !featureId) return { ok: false, code: "failed", error: "No feature was named." };
  const r = await agentSetting(agentId, field, value, featureId ?? "");
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo did not change the ${field}: ${r.error}` };
  return { ok: true, notice: (r.value as ProviderNoticeData | null) ?? null };
}

export async function listUsageReports(options: { agentId?: string; forceRefresh?: boolean }): Promise<{ ok: true; reports: UsageReportEntryData[] } | { ok: false; code: "older" | "failed"; error: string }> {
  const r = await daemonCall("listUsageReports", [options]);
  if (!r.ok) return { ok: false, code: /Update the host/.test(r.error) ? "older" : "failed", error: r.error };
  const reports = ((r.value as { reports?: unknown[] } | null)?.reports ?? []).flatMap((report) => {
    const parsed = UsageReportEntry.safeParse(report);
    return parsed.success ? [parsed.data] : [];
  });
  return { ok: true, reports };
}

export async function uploadFile(fileName: string, mimeType: string, data: string): Promise<{ ok: true; file: UploadedFileData } | { ok: false; code: "failed"; error: string }> {
  const r = await daemonCall("uploadFile", [{ fileName, mimeType, bytes: Buffer.from(data, "base64") }]);
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo did not take the file: ${r.error}` };
  const result = r.value as { file: UploadedFileData | null; error: string | null } | null;
  if (result?.file && !result.error) return { ok: true, file: result.file };
  return { ok: false, code: "failed", error: result?.error ?? "Upload failed." };
}

export async function searchForge(cwd: string, query: string): Promise<{ ok: true; items: ForgeItemData[]; authState: string; error: string | null } | { ok: false; code: "failed"; error: string }> {
  const r = await daemonCall("searchForge", [{ cwd, query: query.trim(), limit: 20 }]);
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo could not search issues and PRs: ${r.error}` };
  const result = (r.value ?? {}) as { items?: unknown[]; authState?: string; error?: string | null };
  const items = (result.items ?? []).flatMap((item) => {
    const parsed = ForgeItem.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  return { ok: true, items, authState: result.authState ?? "unauthenticated", error: result.error ?? null };
}

export async function listTimelinePrompts(agentId: string): Promise<{ ok: true; epoch: string; prompts: { seq: number; timestamp: string; preview: string }[] } | { ok: false; code: "failed"; error: string }> {
  const r = await daemonCall("listAgentTimelinePrompts", [agentId]);
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo did not list the prompts: ${r.error}` };
  const result = (r.value ?? {}) as { epoch?: string; prompts?: { seq: number; timestamp: string; preview: string }[]; error?: string | null };
  if (result.error || typeof result.epoch !== "string") return { ok: false, code: "failed", error: result.error ?? "No prompt index." };
  return { ok: true, epoch: result.epoch, prompts: result.prompts ?? [] };
}

export async function rewindAgent(agentId: string, messageId: string, mode: "conversation" | "files" | "both"): Promise<{ ok: true } | { ok: false; code: "failed"; error: string }> {
  const r = await daemonCall("rewindAgent", [agentId, messageId, mode]);
  if (!r.ok) return { ok: false, code: "failed", error: `Failed to rewind agent: ${r.error}` };
  const result = (r.value ?? {}) as { ok?: boolean; error?: string | null };
  return result.ok ? { ok: true } : { ok: false, code: "failed", error: result.error ?? "Failed to rewind agent" };
}

export type TimelineSearchResult = ({ ok: true } & AgentTimelineSearchPayload) | { ok: false; code: "failed"; error: string };

export async function searchTimeline(agentId: string, query: string, cursor: number | undefined): Promise<TimelineSearchResult> {
  const r = await daemonCall("searchAgentTimeline", [{ agentId, query, ...(cursor === undefined ? {} : { cursor }) }]);
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo could not search this chat: ${r.error}` };
  const result = (r.value ?? {}) as { epoch?: string; locations?: { seq: number; role: "user" | "assistant"; count?: number }[]; nextCursor?: number | null; error?: string | null };
  if (result.error || typeof result.epoch !== "string") return { ok: false, code: "failed", error: result.error ?? "No search result." };
  return { ok: true, epoch: result.epoch, locations: result.locations ?? [], nextCursor: result.nextCursor ?? null };
}

export async function suggestEntries(cwd: string, query: string): Promise<{ ok: true; entries: DirectoryEntry[] } | { ok: false; code: "failed"; error: string }> {
  const r = await daemonCall("getDirectorySuggestions", [{ cwd, query, limit: 50, includeFiles: true, includeDirectories: true }]);
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo could not search the workspace: ${r.error}` };
  const result = (r.value ?? {}) as { entries?: { path: string; kind: string }[]; directories?: string[]; error?: string | null };
  if (result.error) return { ok: false, code: "failed", error: result.error };
  return { ok: true, entries: directoryEntriesOf(result) };
}

export async function checkoutRemoteUrl(cwd: string): Promise<{ ok: true; remoteUrl: string | null } | { ok: false; code: "failed"; error: string }> {
  const r = await daemonCall("getCheckoutStatus", [cwd]);
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo could not read the checkout: ${r.error}` };
  const result = (r.value ?? {}) as { remoteUrl?: string | null };
  return { ok: true, remoteUrl: typeof result.remoteUrl === "string" ? result.remoteUrl : null };
}
