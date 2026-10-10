// The plugin's two RPCs and its one setting, shared by the daemon side and the app. Both RPCs only
// read: they run the piggery CLI with --no-start, so looking never starts a piggery daemon.
import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { TAIL_KINDS } from "./view.ts";
import type { MailPage } from "./mail.ts";
import type { Transcript } from "./transcript.ts";

/**
 * Why piggery gave nothing: not installed at that path, daemon not running, a piggery older (no
 * `ps --view`) or newer (another view version) than this plugin, or another failure.
 */
const Failure = z.object({ ok: z.literal(false), code: z.enum(["missing", "down", "older", "newer", "failed", "nodb", "nolog", "denied"]), error: z.string() });

/**
 * `piggery ps --view`, passed through as piggery wrote it (shared/view.ts checks its version and
 * types it). With a workspace `dir`, also that directory as piggery records paths (symlinks
 * resolved, e.g. macOS's /tmp is a symlink), which only the daemon side can work out.
 */
export const snapshot = defineRpc({
  name: "pigmonitor.snapshot",
  input: z.object({ dir: z.string().optional() }),
  output: z.union([z.object({ ok: z.literal(true), view: z.record(z.string(), z.unknown()), dir: z.string().optional() }), Failure]),
});

/** The last lines of one participant's session, as `piggery tail --view` gives them. */
export const tail = defineRpc({
  name: "pigmonitor.tail",
  input: z.object({ id: z.string().min(1), lines: z.number().int().min(1).max(200).default(20) }),
  output: z.union([z.object({ ok: z.literal(true), lines: z.array(z.object({ kind: z.enum(TAIL_KINDS), text: z.string(), rest: z.string().optional() })) }), Failure]),
});

const MailMessage = z.object({
  id: z.string(),
  seq: z.number().int(),
  team: z.string().optional(),
  from: z.string(),
  from_name: z.string(),
  from_role: z.string().optional(),
  to: z.string(),
  to_name: z.string(),
  to_role: z.string().optional(),
  kind: z.string().optional(),
  op: z.string().optional(),
  reply_to: z.string().optional(),
  reply_seq: z.number().int().optional(),
  body: z.string(),
  created_at: z.number(),
  acked_at: z.number().optional(),
  held: z.string().optional(),
});

const MailTeam = z.object({ id: z.string(), name: z.string(), dir: z.string(), closed: z.number().optional() });

export const mail = defineRpc({
  name: "pigmonitor.mail",
  input: z.object({
    teams: z.array(z.string()).optional(),
    participants: z.array(z.string()).optional(),
    participant: z.string().optional(),
    before: z.number().int().optional(),
    limit: z.number().int().min(1).max(1000).default(100),
  }),
  output: z.union([z.object({ ok: z.literal(true), messages: z.array(MailMessage), teams: z.record(z.string(), MailTeam), total: z.number().int() }), Failure]),
});

export type MailResult = { ok: true } & MailPage;

const Item = z.object({
  i: z.number().int(),
  kind: z.enum(["session", "user", "wake", "assistant", "thinking", "tool", "mail", "turn"]),
  at: z.number().optional(),
  text: z.string(),
  tool: z.string().optional(),
  input: z.string().optional(),
  result: z.string().optional(),
  error: z.boolean().optional(),
  from: z.string().optional(),
  ref: z.string().optional(),
  reply: z.string().optional(),
  run: z.string().optional(),
});

export const transcript = defineRpc({
  name: "pigmonitor.transcript",
  input: z.object({ id: z.string().min(1), before: z.number().int().optional(), limit: z.number().int().min(1).max(200000).default(20000) }),
  output: z.union([z.object({ ok: z.literal(true), items: z.array(Item), total: z.number().int(), name: z.string(), role: z.string().optional(), files: z.number().int(), roles: z.record(z.string(), z.string()).optional() }), Failure]),
});

export type TranscriptResult = { ok: true } & Transcript;

/** The person behind Paseo as a piggery participant (server/person.ts): who it is, once it has joined; null before the first send. */
export const person = defineRpc({
  name: "pigmonitor.person",
  input: z.object({}),
  output: z.union([z.object({ ok: z.literal(true), person: z.object({ id: z.string(), name: z.string() }).nullable() }), Failure]),
});

/**
 * Mail from the person to a participant (by id), as the daemon's own send verb: its gate rules apply,
 * so a member of a team that is not its gate is refused with the gate to write to instead.
 */
export const MAX_IMAGES = 8;

export const Image = z.object({ data: z.string().min(1), mimeType: z.string().regex(/^image\//) });

export type ImageData = z.infer<typeof Image>;

export const sendMail = defineRpc({
  name: "pigmonitor.send",
  input: z.object({ to: z.string().min(1), body: z.string(), reply_to: z.string().optional(), images: z.array(Image).max(MAX_IMAGES).optional() }),
  output: z.union([
    z.object({ ok: z.literal(true), id: z.string(), seq: z.number().int(), held: z.string().optional() }),
    z.object({ ok: z.literal(false), code: z.enum(["down", "denied", "failed"]), error: z.string(), gate: z.string().optional(), gate_name: z.string().optional() }),
  ]),
});

const SessionRef = z.object({ id: z.string(), ref: z.string().nullable(), harness: z.string().nullable(), mode: z.string().nullable(), cwd: z.string(), gone: z.boolean() });

export const sessions = defineRpc({
  name: "pigmonitor.sessions",
  input: z.object({ ids: z.array(z.string()).max(1000) }),
  output: z.union([z.object({ ok: z.literal(true), sessions: z.array(SessionRef) }), Failure]),
});

export const resume = defineRpc({
  name: "pigmonitor.resume",
  input: z.object({ id: z.string().min(1) }),
  output: z.union([z.object({ ok: z.literal(true), agentId: z.string() }), Failure]),
});

export const agentConfig = defineRpc({
  name: "pigmonitor.agent-config",
  input: z.object({ agentId: z.string().min(1), field: z.enum(["model", "mode", "thinking"]), value: z.string().nullable() }),
  output: z.union([z.object({ ok: z.literal(true) }), Failure]),
});

export const stop = defineRpc({
  name: "pigmonitor.stop",
  input: z.object({ id: z.string().min(1), agentId: z.string().min(1).optional() }),
  output: z.union([z.object({ ok: z.literal(true) }), Failure]),
});

export const imageFile = defineRpc({
  name: "pigmonitor.image",
  input: z.object({ path: z.string().min(1) }),
  output: z.union([z.object({ ok: z.literal(true), data: z.string(), mimeType: z.string() }), Failure]),
});

export const RPC_NAMES = [snapshot.name, tail.name, mail.name, transcript.name, person.name, sendMail.name, sessions.name, resume.name, agentConfig.name, stop.name, imageFile.name];

/** What the user folded, the tab they chose (shared/folds.ts) and the Sessions list width: kept per Paseo host, saved by the app after a change. */
export const viewSettings = defineSettings({
  id: "pigmonitor-view",
  scope: "host",
  version: 1,
  schema: z.object({ teams: z.record(z.string(), z.boolean()).default({}), gone: z.record(z.string(), z.boolean()).default({}), tab: z.enum(["overview", "graph", "board", "mail", "sessions"]).default("overview"), listWidth: z.number().optional(), hidden: z.record(z.string(), z.boolean()).default({}) }),
});

/** A piggery binary the user chose; empty uses the one that installed the plugin, else PATH. */
export const settings = defineSettings({
  id: "pigmonitor",
  scope: "host",
  version: 1,
  schema: z.object({ path: z.string().default(""), database: z.string().default("") }),
});
