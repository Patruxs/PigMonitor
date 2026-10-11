import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { TAIL_KINDS } from "./piggery/view.ts";
import { AgentTimelineSearchPayload } from "./chat/chat-find.ts";
import { MailFilter, MailPage } from "./piggery/mail.ts";
import { ParticipantRecord } from "./chat/chat-route.ts";
import { Transcript } from "./stream/transcript.ts";
import { UsageReportEntry } from "./stream/usage-schema.ts";
import { DICTATION_FORMAT, MAX_DICTATION_CHUNKS } from "./chat/speech.ts";
import { PALETTE_KEYS, type PaletteKey } from "./piggery/palette.ts";
import { AVATAR_SETTINGS_VERSION, AvatarSettings, migrateAvatarSettings } from "./piggery/avatar.ts";

const Failure = z.object({ ok: z.literal(false), code: z.enum(["missing", "down", "older", "newer", "failed", "nodb", "nolog", "denied"]), error: z.string() });

const StateSegment = z.object({ state: z.enum(["working", "idle", "waiting", "gone"]), start: z.number(), end: z.number().nullable() });

export const snapshot = defineRpc({
  name: "pigmonitor.snapshot",
  input: z.object({ dir: z.string().optional() }),
  output: z.union([z.object({ ok: z.literal(true), view: z.record(z.string(), z.unknown()), segments: z.record(z.string(), z.array(StateSegment)).optional(), dir: z.string().optional() }), Failure]),
});

export const tail = defineRpc({
  name: "pigmonitor.tail",
  input: z.object({ id: z.string().min(1), lines: z.number().int().min(1).max(200).default(20) }),
  output: z.union([z.object({ ok: z.literal(true), lines: z.array(z.object({ kind: z.enum(TAIL_KINDS), text: z.string(), rest: z.string().optional() })) }), Failure]),
});

export const mail = defineRpc({
  name: "pigmonitor.mail",
  input: MailFilter,
  output: z.union([MailPage.extend({ ok: z.literal(true) }), Failure]),
});

export const transcript = defineRpc({
  name: "pigmonitor.transcript",
  input: z.object({ id: z.string().min(1), limit: z.number().int().min(1).max(200000).default(20000), since: z.object({ epoch: z.string(), rev: z.number().int() }).optional() }),
  output: z.union([Transcript.extend({ ok: z.literal(true) }), Failure]),
});

export const person = defineRpc({
  name: "pigmonitor.person",
  input: z.object({}),
  output: z.union([z.object({ ok: z.literal(true), person: z.object({ id: z.string(), name: z.string() }).nullable() }), Failure]),
});

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

export const sessions = defineRpc({
  name: "pigmonitor.sessions",
  input: z.object({ ids: z.array(z.string()).max(1000) }),
  output: z.union([z.object({ ok: z.literal(true), sessions: z.array(ParticipantRecord) }), Failure]),
});

export const paseoLinks = defineRpc({
  name: "pigmonitor.paseo-links",
  input: z.object({ agents: z.array(z.object({ agentId: z.string(), sessionId: z.string(), archived: z.boolean() })).max(2000), missing: z.array(z.string()).max(2000) }),
  output: z.union([z.object({ ok: z.literal(true), links: z.array(z.object({ participantId: z.string(), agentId: z.string() })), formerly: z.array(z.object({ participantId: z.string(), heldBy: z.string() })) }), Failure]),
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
  input: z.object({ agentId: z.string().min(1).optional(), forceRefresh: z.boolean().optional() }),
  output: z.union([z.object({ ok: z.literal(true), reports: z.array(UsageReportEntry) }), Failure]),
});

export const stop = defineRpc({
  name: "pigmonitor.stop",
  input: z.object({ id: z.string().min(1), agentId: z.string().min(1).optional() }),
  output: z.union([z.object({ ok: z.literal(true) }), Failure]),
});

export const promptImages = defineRpc({
  name: "pigmonitor.prompt-images",
  input: z.object({ id: z.string().min(1) }),
  output: z.union([z.object({ ok: z.literal(true), prompts: z.array(z.object({ uuid: z.string(), keys: z.array(z.string()), images: z.array(z.object({ path: z.string(), mimeType: z.string() })) })) }), Failure]),
});

export const imageFile = defineRpc({
  name: "pigmonitor.image",
  input: z.object({ path: z.string().min(1) }),
  output: z.union([z.object({ ok: z.literal(true), data: z.string(), mimeType: z.string() }), Failure]),
});

export const avatarUpload = defineRpc({
  name: "pigmonitor.avatar-upload",
  input: z.object({ data: z.string(), mimeType: z.string() }),
  output: z.union([z.object({ ok: z.literal(true), id: z.string() }), Failure]),
});

export const avatarImage = defineRpc({
  name: "pigmonitor.avatar-image",
  input: z.object({ id: z.string() }),
  output: z.union([z.object({ ok: z.literal(true), data: z.string(), mimeType: z.string() }), Failure]),
});

export const avatarDelete = defineRpc({
  name: "pigmonitor.avatar-delete",
  input: z.object({ id: z.string() }),
  output: z.union([z.object({ ok: z.literal(true) }), Failure]),
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
  output: z.union([AgentTimelineSearchPayload.extend({ ok: z.literal(true) }), Failure]),
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

export const dictationStatus = defineRpc({
  name: "pigmonitor.dictation-status",
  input: z.object({}),
  output: z.union([z.object({ ok: z.literal(true), enabled: z.boolean(), reason: z.string() }), Failure]),
});

export const transcribe = defineRpc({
  name: "pigmonitor.transcribe",
  input: z.object({ format: z.literal(DICTATION_FORMAT), chunks: z.array(z.string()).max(MAX_DICTATION_CHUNKS) }),
  output: z.union([z.object({ ok: z.literal(true), text: z.string() }), Failure]),
});

export const notifyStatus = defineRpc({
  name: "pigmonitor.notify-status",
  input: z.object({}),
  output: z.union([z.object({ ok: z.literal(true), set: z.boolean() }), Failure]),
});

export const THINKING_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

export const stepIn = defineRpc({
  name: "pigmonitor.step-in",
  input: z.discriminatedUnion("verb", [
    z.object({ verb: z.literal("kill"), id: z.string().min(1) }),
    z.object({ verb: z.literal("resume"), id: z.string().min(1) }),
    z.object({ verb: z.literal("model"), id: z.string().min(1), model: z.string().min(1).optional(), thinking: z.enum(THINKING_LEVELS).optional() }),
    z.object({ verb: z.literal("release"), id: z.string().min(1) }),
  ]),
  output: z.union([z.object({ ok: z.literal(true), said: z.string() }), Failure]),
});

export const models = defineRpc({
  name: "pigmonitor.models",
  input: z.object({ id: z.string().min(1) }),
  output: z.union([z.object({ ok: z.literal(true), models: z.array(z.string()) }), Failure]),
});


export const viewSettings = defineSettings({
  id: "pigmonitor-view",
  scope: "host",
  version: 1,
  schema: z.object({ teams: z.record(z.string(), z.boolean()).default({}), gone: z.record(z.string(), z.boolean()).default({}), tab: z.enum(["overview", "graph", "board", "mail", "sessions"]).default("overview"), listWidth: z.number().optional(), hidden: z.record(z.string(), z.boolean()).default({}) }),
});

export const colourSettings = defineSettings({
  id: "pigmonitor-colours",
  scope: "host",
  version: 1,
  schema: z.object(Object.fromEntries(PALETTE_KEYS.map((key) => [key, z.string().optional()])) as Record<PaletteKey, z.ZodOptional<z.ZodString>>),
});

export const avatarSettings = defineSettings({
  id: "pigmonitor-avatars",
  scope: "host",
  version: AVATAR_SETTINGS_VERSION,
  schema: AvatarSettings,
  migrate: migrateAvatarSettings,
});

export const settings = defineSettings({
  id: "pigmonitor",
  scope: "host",
  version: 1,
  schema: z.object({ path: z.string().default(""), database: z.string().default("") }),
});
