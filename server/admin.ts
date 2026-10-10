import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { ZodType } from "zod";

const TIMEOUT_MS = 8000;

export type AdminResult<T> = { ok: true; value: T } | { ok: false; code: "down" | "failed"; error: string };

export async function adminCall<T>(dir: string, verb: string, args: unknown, reply: ZodType<T>): Promise<AdminResult<T>> {
  let token: string;
  try {
    token = (await readFile(path.join(dir, "admin.token"), "utf8")).trim();
  } catch {
    return { ok: false, code: "down", error: "piggery's admin token was not found; the piggery daemon has not run here yet." };
  }
  return new Promise((resolve) => {
    const sock = net.createConnection(path.join(dir, "piggery.sock"));
    let buf = "";
    const finish = (result: AdminResult<T>) => {
      clearTimeout(timer);
      sock.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, code: "failed", error: `piggery did not answer ${verb} within ${TIMEOUT_MS / 1000}s.` }), TIMEOUT_MS);
    sock.on("connect", () => sock.write(JSON.stringify({ id: "1", verb, admin_token: token, args }) + "\n"));
    sock.on("error", (err: NodeJS.ErrnoException) => finish({ ok: false, code: "down", error: err.code === "ENOENT" || err.code === "ECONNREFUSED" ? "The piggery daemon is not running." : err.message }));
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const end = buf.indexOf("\n");
      if (end < 0) return;
      try {
        const frame = JSON.parse(buf.slice(0, end)) as { result?: unknown; error?: { message?: string } };
        if (frame.error) return finish({ ok: false, code: "failed", error: frame.error.message ?? `piggery refused ${verb}.` });
        const parsed = reply.safeParse(frame.result);
        finish(parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: "failed", error: `piggery answered ${verb} in a shape this plugin does not read.` });
      } catch {
        finish({ ok: false, code: "failed", error: `piggery's answer to ${verb} was not JSON.` });
      }
    });
  });
}
