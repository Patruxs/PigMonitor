import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const TIMEOUT_MS = 8000;

export type AdminResult<T> = { ok: true; value: T } | { ok: false; code: "down" | "failed"; error: string };

export async function adminCall<T>(dir: string, verb: string, args: unknown): Promise<AdminResult<T>> {
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
        const reply = JSON.parse(buf.slice(0, end)) as { ok?: boolean; result?: T; error?: { message?: string } };
        if (reply.error) return finish({ ok: false, code: "failed", error: reply.error.message ?? `piggery refused ${verb}.` });
        finish({ ok: true, value: reply.result as T });
      } catch {
        finish({ ok: false, code: "failed", error: `piggery's answer to ${verb} was not JSON.` });
      }
    });
  });
}
