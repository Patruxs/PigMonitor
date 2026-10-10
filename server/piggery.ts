import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { TAIL_KINDS, TAIL_VERSION } from "../shared/view.ts";
import { adminCall, type AdminResult } from "./admin.ts";

export type Result = { ok: true; out: string } | { ok: false; code: "missing" | "down" | "older" | "failed"; error: string };

const TIMEOUT_MS = 5000;

export function pickBin(setting: string, installedByPiggery: string): string {
  return setting.trim() || installedByPiggery.trim() || "piggery";
}

export function piggeryHome(): string {
  return path.join(homedir(), ".piggery");
}

export function runPiggery(bin: string, args: string[], timeoutMs = TIMEOUT_MS): Promise<Result> {
  return new Promise((resolve) => {
    execFile(bin, [...args, "--no-start"], { timeout: timeoutMs, maxBuffer: 16 << 20, env: { ...process.env, NO_COLOR: "1" } }, (error, stdout, stderr) => {
      if (!error) return resolve({ ok: true, out: stdout });
      const err = error as NodeJS.ErrnoException & { killed?: boolean };
      const said = String(stderr).trim();
      if (err.code === "ENOENT") {
        return resolve({ ok: false, code: "missing", error: `piggery was not found at "${bin}". Set its full path in the PigMonitor settings.` });
      }
      if (said.includes("the piggery daemon is not running")) {
        return resolve({ ok: false, code: "down", error: "The piggery daemon is not running. Any piggery command starts it, e.g. `piggery ps`." });
      }
      const flag = /flag provided but not defined: -(no-start|view)/.exec(said)?.[1];
      if (flag) {
        return resolve({ ok: false, code: "older", error: `The piggery at "${bin}" is older than this plugin (it has no --${flag}). Update piggery, or point the PigMonitor setting at a newer one.` });
      }
      if (err.killed) return resolve({ ok: false, code: "failed", error: `piggery did not answer within ${timeoutMs / 1000}s.` });
      resolve({ ok: false, code: "failed", error: said || err.message });
    });
  });
}

export async function realDir(dir: string): Promise<string> {
  try {
    return await realpath(dir);
  } catch {
    return dir;
  }
}

const STEP_IN_TIMEOUT_MS = 30000;

type Failed = { ok: false; code: "missing" | "down" | "older" | "newer" | "failed"; error: string };

const TailLine = z.object({ kind: z.enum(TAIL_KINDS), text: z.string(), rest: z.string().optional() });

export type TailLine = z.infer<typeof TailLine>;

const TailDoc = z.object({ version: z.number(), lines: z.array(TailLine) });

const PsView = z.record(z.string(), z.unknown());

const Models = z.object({ models: z.array(z.string()).optional() }).nullable().optional();

export async function psView(bin: string): Promise<Result> {
  const r = await runPiggery(bin, ["ps", "--view"]);
  if (!r.ok) return r;
  return PsView.safeParse(parsedJson(r.out)).success ? r : { ok: false, code: "failed", error: "piggery ps --view did not print JSON." };
}

export async function psViewDoc(bin: string): Promise<{ ok: true; view: Record<string, unknown> } | Failed> {
  const r = await psView(bin);
  if (!r.ok) return r;
  return { ok: true, view: PsView.parse(parsedJson(r.out)) };
}

export async function tailView(bin: string, id: string, lines: number): Promise<{ ok: true; lines: TailLine[] } | Failed> {
  const r = await runPiggery(bin, ["tail", id, "-n", String(lines), "--view"]);
  if (!r.ok) return r;
  const doc = parsedJson(r.out);
  const version = z.object({ version: z.number() }).safeParse(doc);
  if (version.success && version.data.version < TAIL_VERSION) return { ok: false, code: "older", error: `piggery speaks tail --view version ${version.data.version}; this plugin reads ${TAIL_VERSION}. Update piggery.` };
  if (version.success && version.data.version > TAIL_VERSION) return { ok: false, code: "newer", error: `piggery speaks tail --view version ${version.data.version}; this plugin reads ${TAIL_VERSION}. Run piggery setup paseo to update the plugin, then reload the Paseo app.` };
  const tail = TailDoc.safeParse(doc);
  return tail.success ? { ok: true, lines: tail.data.lines } : { ok: false, code: "failed", error: "piggery tail --view did not print JSON." };
}

export async function abort(bin: string, id: string): Promise<{ ok: true } | Failed> {
  const r = await runPiggery(bin, ["abort", id]);
  return r.ok ? { ok: true } : r;
}

export type StepIn = { verb: "kill" | "resume" | "release"; id: string } | { verb: "model"; id: string; model?: string; thinking?: string };

export function stepInArgs(input: StepIn): string[] | null {
  if (input.verb !== "model") return [input.verb, input.id];
  if (!input.model && !input.thinking) return null;
  return ["model", input.id, ...(input.model ? [input.model] : []), ...(input.thinking ? ["--thinking", input.thinking] : [])];
}

export async function runStepIn(bin: string, input: StepIn): Promise<{ ok: true; said: string } | Failed> {
  const args = stepInArgs(input);
  if (!args) return { ok: false, code: "failed", error: "Choose a model or a thinking level." };
  const r = await runPiggery(bin, args, STEP_IN_TIMEOUT_MS);
  return r.ok ? { ok: true, said: r.out.trim() } : r;
}

export async function listModels(home: string, id: string): Promise<{ ok: true; models: string[] } | Exclude<AdminResult<unknown>, { ok: true }>> {
  const r = await adminCall(home, "models", { target: id }, Models);
  return r.ok ? { ok: true, models: r.value?.models ?? [] } : r;
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
