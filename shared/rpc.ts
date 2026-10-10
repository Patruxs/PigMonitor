// The plugin's two RPCs and its one setting, shared by the daemon side and the app. Both RPCs only
// read: they run the piggery CLI with --no-start, so looking never starts a piggery daemon.
import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { TAIL_KINDS } from "./view.ts";
import type { MailPage } from "./mail.ts";
import type { Transcript } from "./transcript.ts";
import type { ToolCallDetail } from "./tool-call.ts";
import { UsageReportEntry } from "./usage-schema.ts";

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

const UnknownValue = z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(z.unknown()), z.object({}).passthrough()]);

const NonNullUnknown: z.ZodType<unknown> = z.union([z.boolean(), z.number(), z.string(), z.array(z.unknown()), z.object({}).passthrough()]);

const ToolCallDetailSchema: z.ZodType<ToolCallDetail, unknown> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("worktree_setup"),
    worktreePath: z.string(),
    branchName: z.string(),
    log: z.string(),
    commands: z.array(z.object({ index: z.number().int().positive(), command: z.string(), cwd: z.string(), log: z.string().optional().default(""), status: z.enum(["running", "completed", "failed"]), exitCode: z.number().nullable(), durationMs: z.number().nonnegative().optional() })),
    truncated: z.boolean().optional(),
  }),
  z.object({ type: z.literal("shell"), command: z.string(), cwd: z.string().optional(), output: z.string().optional(), exitCode: z.number().nullable().optional() }),
  z.object({ type: z.literal("read"), filePath: z.string(), content: z.string().optional(), offset: z.number().optional(), limit: z.number().optional() }),
  z.object({ type: z.literal("edit"), filePath: z.string(), oldString: z.string().optional(), newString: z.string().optional(), unifiedDiff: z.string().optional() }),
  z.object({ type: z.literal("write"), filePath: z.string(), content: z.string().optional() }),
  z.object({
    type: z.literal("search"),
    query: z.string(),
    toolName: z.enum(["search", "grep", "glob", "web_search"]).optional(),
    content: z.string().optional(),
    filePaths: z.array(z.string()).optional(),
    webResults: z.array(z.object({ title: z.string(), url: z.string() })).optional(),
    annotations: z.array(z.string()).optional(),
    numFiles: z.number().optional(),
    numMatches: z.number().optional(),
    durationMs: z.number().optional(),
    durationSeconds: z.number().optional(),
    truncated: z.boolean().optional(),
    mode: z.enum(["content", "files_with_matches", "count"]).optional(),
  }),
  z.object({ type: z.literal("fetch"), url: z.string(), prompt: z.string().optional(), result: z.string().optional(), code: z.number().optional(), codeText: z.string().optional(), bytes: z.number().optional(), durationMs: z.number().optional() }),
  z.object({
    type: z.literal("sub_agent"),
    subAgentType: z.string().optional(),
    description: z.string().optional(),
    childSessionId: z.string().optional(),
    log: z.string(),
    actions: z.array(z.object({ index: z.number().int().positive(), toolName: z.string(), summary: z.string().optional() })).optional(),
  }),
  z.object({ type: z.literal("plain_text"), label: z.string().optional(), text: z.string().optional(), icon: z.enum(["wrench", "square_terminal", "eye", "pencil", "search", "bot", "sparkles", "brain", "mic_vocal"]).optional() }),
  z.object({ type: z.literal("plan"), text: z.string() }),
  z.object({ type: z.literal("unknown"), input: UnknownValue, output: UnknownValue }),
]);

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
  detail: ToolCallDetailSchema.optional(),
  status: z.enum(["running", "completed", "failed", "canceled"]).optional(),
  toolError: NonNullUnknown.optional(),
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

export const UploadedFile = z.object({ type: z.literal("uploaded_file"), id: z.string(), fileName: z.string(), mimeType: z.string(), size: z.number(), path: z.string() });

export type UploadedFileData = z.infer<typeof UploadedFile>;

export const ForgeItem = z.object({
  forge: z.string().optional(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  body: z.string().nullable(),
  labels: z.array(z.string()),
  projectPath: z.string().optional(),
  baseRefName: z.string().nullable().optional(),
  headRefName: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
  kind: z.enum(["change_request", "issue"]),
});

export type ForgeItemData = z.infer<typeof ForgeItem>;

const ForgeChangeRequest = z.object({
  type: z.literal("forge_change_request"),
  mimeType: z.literal("application/paseo-forge-change-request"),
  forge: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  body: z.string().nullable().optional(),
  projectPath: z.string().optional(),
  baseRefName: z.string().nullable().optional(),
  headRefName: z.string().nullable().optional(),
});

const ForgeIssue = z.object({
  type: z.literal("forge_issue"),
  mimeType: z.literal("application/paseo-forge-issue"),
  forge: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  body: z.string().nullable().optional(),
  projectPath: z.string().optional(),
});

export const Attachment = z.discriminatedUnion("type", [UploadedFile, ForgeChangeRequest, ForgeIssue]);

export type AttachmentData = z.infer<typeof Attachment>;

export const sendMail = defineRpc({
  name: "pigmonitor.send",
  input: z.object({ to: z.string().min(1), body: z.string(), reply_to: z.string().optional(), images: z.array(Image).max(MAX_IMAGES).optional(), attachments: z.array(Attachment).optional() }),
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

export const ProviderNotice = z.object({ type: z.enum(["info", "warning", "error"]), message: z.string() });

export const agentConfig = defineRpc({
  name: "pigmonitor.agent-config",
  input: z.object({ agentId: z.string().min(1), field: z.enum(["model", "mode", "thinking", "feature"]), featureId: z.string().min(1).optional(), value: z.union([z.string(), z.boolean()]).nullable() }),
  output: z.union([z.object({ ok: z.literal(true), notice: ProviderNotice.nullable().optional() }), Failure]),
});

export const usageReports = defineRpc({
  name: "pigmonitor.usage-reports",
  input: z.object({ agentId: z.string().min(1).optional(), forceRefresh: z.boolean().optional(), reportIds: z.array(z.string()).optional() }),
  output: z.union([z.object({ ok: z.literal(true), reports: z.array(UsageReportEntry) }), Failure]),
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

export const upload = defineRpc({
  name: "pigmonitor.upload",
  input: z.object({ fileName: z.string().min(1), mimeType: z.string(), data: z.string() }),
  output: z.union([z.object({ ok: z.literal(true), file: UploadedFile }), Failure]),
});

export const forgeSearch = defineRpc({
  name: "pigmonitor.forge-search",
  input: z.object({ cwd: z.string().min(1), query: z.string() }),
  output: z.union([z.object({ ok: z.literal(true), items: z.array(ForgeItem), authState: z.string(), error: z.string().nullable() }), Failure]),
});

export const timelinePrompts = defineRpc({
  name: "pigmonitor.timeline-prompts",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.union([z.object({ ok: z.literal(true), epoch: z.string(), prompts: z.array(z.object({ seq: z.number().int().nonnegative(), timestamp: z.string(), preview: z.string() })) }), Failure]),
});

export const rewind = defineRpc({
  name: "pigmonitor.rewind",
  input: z.object({ agentId: z.string().min(1), messageId: z.string().min(1), mode: z.enum(["conversation", "files", "both"]) }),
  output: z.union([z.object({ ok: z.literal(true) }), Failure]),
});

export const timelineSearch = defineRpc({
  name: "pigmonitor.timeline-search",
  input: z.object({ agentId: z.string().min(1), query: z.string().min(1), cursor: z.number().int().nonnegative().optional() }),
  output: z.union([z.object({ ok: z.literal(true), epoch: z.string(), locations: z.array(z.object({ seq: z.number().int().nonnegative(), role: z.enum(["user", "assistant"]), count: z.number().int().positive().optional() })), nextCursor: z.number().int().nonnegative().nullable() }), Failure]),
});

export const dirSuggest = defineRpc({
  name: "pigmonitor.dir-suggest",
  input: z.object({ cwd: z.string().min(1), query: z.string() }),
  output: z.union([z.object({ ok: z.literal(true), entries: z.array(z.object({ path: z.string(), kind: z.enum(["file", "directory"]) })) }), Failure]),
});

export const checkoutRemote = defineRpc({
  name: "pigmonitor.checkout-remote",
  input: z.object({ cwd: z.string().min(1) }),
  output: z.union([z.object({ ok: z.literal(true), remoteUrl: z.string().nullable() }), Failure]),
});

export const RPC_NAMES = [snapshot.name, tail.name, mail.name, transcript.name, person.name, sendMail.name, sessions.name, resume.name, agentConfig.name, usageReports.name, stop.name, imageFile.name, upload.name, forgeSearch.name, timelinePrompts.name, rewind.name, timelineSearch.name, dirSuggest.name, checkoutRemote.name];

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
