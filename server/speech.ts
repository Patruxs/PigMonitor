import { daemonCall, daemonDictation } from "./daemon.ts";

const TRANSCRIBE_TIMEOUT_MS = 180000;

export async function dictationReadiness(): Promise<{ ok: true; enabled: boolean; reason: string } | { ok: false; code: "failed"; error: string }> {
  const r = await daemonCall("getLastServerInfoMessage", []);
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo did not say whether dictation is available: ${r.error}` };
  const reported = (r.value as { capabilities?: { voice?: { dictation?: { enabled?: unknown; reason?: unknown } } } } | null)?.capabilities?.voice?.dictation;
  if (!reported) return { ok: true, enabled: true, reason: "" };
  return { ok: true, enabled: reported.enabled === true, reason: typeof reported.reason === "string" ? reported.reason : "" };
}

export async function transcribe(format: string, chunks: string[]): Promise<{ ok: true; text: string } | { ok: false; code: "failed"; error: string }> {
  if (chunks.length === 0) return { ok: true, text: "" };
  const r = await daemonDictation(format, chunks, TRANSCRIBE_TIMEOUT_MS);
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo did not transcribe the recording: ${r.error}` };
  const text = (r.value as { text?: unknown } | null)?.text;
  return { ok: true, text: typeof text === "string" ? text.trim() : "" };
}
