import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import net from "node:net";
import path from "node:path";
import { PERSON_HARNESS } from "../shared/piggery/view.ts";

export interface Identity {
  id: string;
  token: string;
  run_id: string;
  name: string;
}

export interface SendInput {
  to: string;
  body: string;
  reply_to?: string;
}

export type SendResult = { ok: true; id: string; seq: number; held?: string } | { ok: false; code: "down" | "denied" | "failed"; error: string; gate?: string; gate_name?: string };

export interface DaemonError {
  code?: string;
  message?: string;
  rule_id?: string;
  layer?: string;
  details?: Record<string, unknown>;
}

interface Frame {
  id?: string;
  event?: string;
  result?: unknown;
  error?: DaemonError;
}

const PROTOCOL_VERSION = 1;
const HARNESS_REF = "paseo-plugin";
const CONNECT_TIMEOUT_MS = 4000;
const CALL_TIMEOUT_MS = 8000;

function harness() {
  return { harness: PERSON_HARNESS, mode: "interactive", harness_ref: HARNESS_REF, tool_prefix: "", model: "", thinking: "", capabilities: ["wake"] };
}

export function identityFile(home: string): string {
  return path.join(home, "paseo-person.json");
}

export function socketFile(home: string): string {
  return path.join(home, "piggery.sock");
}

function readIdentity(file: string): Identity | null {
  try {
    if (!existsSync(file)) return null;
    const v = JSON.parse(readFileSync(file, "utf8")) as Partial<Identity>;
    if (typeof v.id === "string" && typeof v.token === "string" && typeof v.run_id === "string") return { id: v.id, token: v.token, run_id: v.run_id, name: typeof v.name === "string" ? v.name : "" };
  } catch {}
  return null;
}

function writeIdentity(file: string, identity: Identity): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(identity, null, 2) + "\n", { mode: 0o600 });
}

function daemonError(e: unknown): DaemonError {
  if (e && typeof e === "object") return e as DaemonError;
  return { code: "failed", message: String(e) };
}

class Socket {
  private sock: net.Socket | null = null;
  private next = 0;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: DaemonError) => void; timer: ReturnType<typeof setTimeout> }>();
  auth: { id: string; token: string } | undefined;
  private readonly file: string;
  private readonly onPush: (frame: Frame) => void;
  private readonly onClose: () => void;

  constructor(file: string, onPush: (frame: Frame) => void, onClose: () => void) {
    this.file = file;
    this.onPush = onPush;
    this.onClose = onClose;
  }

  get open(): boolean {
    return this.sock !== null;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = net.createConnection(this.file);
      let buf = "";
      const timer = setTimeout(() => {
        s.destroy();
        reject({ code: "down", message: "The piggery daemon did not answer on its socket." });
      }, CONNECT_TIMEOUT_MS);
      s.on("connect", () => {
        clearTimeout(timer);
        this.sock = s;
        resolve();
      });
      s.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (line.trim()) this.frame(line);
        }
      });
      s.on("error", (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject({ code: "down", message: err.code === "ENOENT" || err.code === "ECONNREFUSED" ? "The piggery daemon is not running. Any piggery command starts it, e.g. `piggery ps`." : err.message });
      });
      s.on("close", () => {
        if (this.sock === s) this.sock = null;
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject({ code: "down", message: "The piggery daemon connection dropped; try again." });
        }
        this.pending.clear();
        this.onClose();
      });
    });
  }

  close(): void {
    this.sock?.destroy();
    this.sock = null;
  }

  private frame(line: string): void {
    let f: Frame;
    try {
      f = JSON.parse(line) as Frame;
    } catch {
      return;
    }
    if (f.id === undefined || f.id === "") {
      if (f.event) this.onPush(f);
      return;
    }
    const p = this.pending.get(f.id);
    if (!p) return;
    this.pending.delete(f.id);
    clearTimeout(p.timer);
    if (f.error) p.reject(f.error);
    else p.resolve(f.result);
  }

  call<T = unknown>(verb: string, args: unknown): Promise<T> {
    const s = this.sock;
    if (!s) return Promise.reject({ code: "down", message: "The piggery daemon is not connected." });
    const id = String(++this.next);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject({ code: "failed", message: `piggery did not answer ${verb} within ${CALL_TIMEOUT_MS / 1000}s.` });
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      s.write(JSON.stringify({ id, verb, auth: this.auth, args }) + "\n");
    });
  }
}

export class Person {
  private socket: Socket | null = null;
  private identity: Identity | null = null;
  private connecting: Promise<void> | null = null;
  private home = "";
  private stopped = false;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private readonly log: (line: string) => void;

  constructor(log: (line: string) => void = () => {}) {
    this.log = log;
  }

  current(home: string): Identity | null {
    if (home !== this.home || this.identity === null) {
      this.home = home;
      this.identity = readIdentity(identityFile(home));
    }
    return this.identity;
  }

  warm(home: string): void {
    if (this.current(home)) void this.ensure(home).catch((e: DaemonError) => this.log(`piggery person: ${e.message ?? e}`));
  }

  private async ensure(home: string): Promise<Socket> {
    this.current(home);
    if (this.socket?.open && this.identity) return this.socket;
    if (this.connecting) {
      await this.connecting;
      if (this.socket?.open) return this.socket;
    }
    this.connecting = this.connect(home).finally(() => {
      this.connecting = null;
    });
    await this.connecting;
    if (!this.socket?.open) throw { code: "down", message: "The piggery daemon is not connected." };
    return this.socket;
  }

  private async connect(home: string): Promise<void> {
    const sock = new Socket(
      socketFile(home),
      (f) => void this.push(f),
      () => {
        if (this.socket === sock) this.socket = null;
        this.scheduleReconnect(home);
      },
    );
    await sock.connect();
    const saved = this.identity;
    const h = harness();
    type Identified = { participant_id: string; run_id: string; name: string };
    let auth = saved ? { id: saved.id, token: saved.token } : null;
    let identified: Identified | null = null;
    if (auth && saved) {
      sock.auth = auth;
      try {
        identified = await sock.call<Identified>("identify", { new_run: false, run_id: saved.run_id, protocol_version: PROTOCOL_VERSION, ...h });
      } catch (e) {
        this.log(`piggery person: saved identity refused (${daemonError(e).message}); joining anew`);
        sock.auth = undefined;
        auth = null;
      }
    }
    if (!auth || !identified) {
      const joined = await sock.call<{ id: string; token: string; run_id: string }>("join.auto", { cwd: homedir(), ...h });
      auth = { id: joined.id, token: joined.token };
      sock.auth = auth;
      identified = await sock.call<Identified>("identify", { new_run: true, run_id: joined.run_id, protocol_version: PROTOCOL_VERSION, ...h });
    }
    const identity: Identity = { id: auth.id, token: auth.token, run_id: identified.run_id, name: identified.name };
    this.identity = identity;
    writeIdentity(identityFile(home), identity);
    this.socket = sock;
    void this.markInboxRead().catch(() => {});
  }

  private scheduleReconnect(home: string): void {
    if (this.stopped || !this.identity) return;
    clearTimeout(this.reconnect);
    this.reconnect = setTimeout(() => void this.ensure(home).catch(() => {}), 5000);
  }

  private async push(f: Frame): Promise<void> {
    if (f.event === "wake") await this.markInboxRead().catch((e: DaemonError) => this.log(`piggery person: inbox: ${e.message ?? e}`));
    else if (f.event === "retire") {
      this.log(`piggery person: retired by the daemon (${String((f as { reason?: string }).reason ?? "")}); joining anew on the next send`);
      this.identity = null;
      this.socket?.close();
    }
  }

  private async markInboxRead(): Promise<void> {
    const sock = this.socket;
    if (!sock?.open) return;
    const key = randomUUID();
    await sock.call("harness.event", { event: "turn_start", prompt_id: key, wake: true });
    try {
      await sock.call("inbox", {});
    } finally {
      await sock.call("harness.event", { event: "turn_end", prompt_id: key, outcome: "ok" }).catch(() => {});
    }
  }

  async send(home: string, input: SendInput): Promise<SendResult> {
    let sock: Socket;
    try {
      sock = await this.ensure(home);
    } catch (e) {
      const err = daemonError(e);
      return { ok: false, code: err.code === "down" ? "down" : "failed", error: err.message ?? "piggery did not answer." };
    }
    try {
      const r = await sock.call<{ id: string; seq: number; held?: boolean; rule_id?: string; duplicate?: boolean }>("send", { to: input.to, body: input.body, ...(input.reply_to ? { reply_to: input.reply_to } : {}) });
      return { ok: true, id: r.id, seq: r.seq, ...(r.held ? { held: r.rule_id ?? "held" } : {}) };
    } catch (e) {
      const err = daemonError(e);
      if (err.code === "denied" || err.layer === "visibility") {
        const d = err.details ?? {};
        return { ok: false, code: "denied", error: err.message ?? "piggery refused the send.", ...(typeof d.gate_id === "string" ? { gate: d.gate_id } : {}), ...(typeof d.gate === "string" ? { gate_name: d.gate } : {}) };
      }
      return { ok: false, code: err.code === "down" ? "down" : "failed", error: err.message ?? "piggery refused the send." };
    }
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnect);
    this.socket?.close();
    this.socket = null;
  }
}
