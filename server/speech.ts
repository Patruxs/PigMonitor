import { runDaemonScript } from "./paseo.ts";

const TRANSCRIBE_TIMEOUT_MS = 180000;

const DICTATION_STATUS = `
const [utils] = process.argv.slice(1);
const { connectToDaemon } = await import(utils + "/client.js");
const { selectDaemonTarget } = await import(utils + "/daemon-target.js");
const client = await connectToDaemon({ target: selectDaemonTarget({}) });
try {
  process.stdout.write(JSON.stringify(client.getLastServerInfoMessage()?.capabilities?.voice?.dictation ?? null));
} finally {
  await client.close();
}
`;

const TRANSCRIBE = `
const [utils] = process.argv.slice(1);
const input = [];
for await (const chunk of process.stdin) input.push(chunk);
const { format, chunks } = JSON.parse(Buffer.concat(input).toString("utf8"));
const { connectToDaemon } = await import(utils + "/client.js");
const { selectDaemonTarget } = await import(utils + "/daemon-target.js");
const client = await connectToDaemon({ target: selectDaemonTarget({}) });
const dictationId = crypto.randomUUID();
try {
  await client.startDictationStream(dictationId, format);
  chunks.forEach((audio, seq) => client.sendDictationStreamChunk(dictationId, seq, audio, format));
  const result = await client.finishDictationStream(dictationId, chunks.length - 1);
  process.stdout.write(JSON.stringify({ text: result.text ?? "" }));
} catch (error) {
  try { client.cancelDictationStream(dictationId); } catch {}
  throw error;
} finally {
  await client.close();
}
`;

export async function dictationReadiness(): Promise<{ ok: true; enabled: boolean; reason: string } | { ok: false; code: "failed"; error: string }> {
  const r = await runDaemonScript(DICTATION_STATUS, []);
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo did not say whether dictation is available: ${r.error}` };
  try {
    const reported = JSON.parse(r.out) as { enabled?: unknown; reason?: unknown } | null;
    if (!reported) return { ok: true, enabled: true, reason: "" };
    return { ok: true, enabled: reported.enabled === true, reason: typeof reported.reason === "string" ? reported.reason : "" };
  } catch {
    return { ok: false, code: "failed", error: "The dictation status did not print a result." };
  }
}

export async function transcribe(format: string, chunks: string[]): Promise<{ ok: true; text: string } | { ok: false; code: "failed"; error: string }> {
  if (chunks.length === 0) return { ok: true, text: "" };
  const r = await runDaemonScript(TRANSCRIBE, [], JSON.stringify({ format, chunks }), TRANSCRIBE_TIMEOUT_MS);
  if (!r.ok) return { ok: false, code: "failed", error: `Paseo did not transcribe the recording: ${r.error}` };
  try {
    const text = (JSON.parse(r.out) as { text?: unknown }).text;
    return { ok: true, text: typeof text === "string" ? text.trim() : "" };
  } catch {
    return { ok: false, code: "failed", error: "The transcription did not print a result." };
  }
}
