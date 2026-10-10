import { z } from "zod";
import { isRecord } from "./guards.ts";

export type ToolCallIconName = "wrench" | "square_terminal" | "eye" | "pencil" | "search" | "bot" | "sparkles" | "brain" | "mic_vocal";

const UnknownValue: z.ZodType<unknown> = z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(z.unknown()), z.object({}).passthrough()]);

export const ToolError: z.ZodType<unknown> = z.union([z.boolean(), z.number(), z.string(), z.array(z.unknown()), z.object({}).passthrough()]);

export const ToolCallDetail = z.discriminatedUnion("type", [
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

export type ToolCallDetail = z.infer<typeof ToolCallDetail>;

export const TOOL_CALL_STATUSES = ["running", "completed", "failed", "canceled"] as const;

export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

export type ToolCallDisplayStatus = ToolCallStatus | "executing";

export type ToolCallIcon = ToolCallIconName | "paseo";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

export function isSpeakToolName(name: string): boolean {
  const tokens = normalizeToolName(name).match(/[a-z0-9]+/g) ?? [];
  return tokens[tokens.length - 1] === "speak";
}

function paseoSegments(normalized: string): string[] | null {
  if (normalized.includes("__")) {
    const segments = normalized.split("__").filter((s) => s.length > 0);
    return segments.length >= 3 && segments[0] === "mcp" && (segments[1] === "paseo" || segments[1].startsWith("paseo_")) ? [segments.slice(2).join("__")] : null;
  }
  if (normalized.includes(".")) {
    const first = normalized.split(".")[0];
    return first === "paseo" || first.startsWith("paseo_") ? [normalized.split(".").slice(1).join(".")] : null;
  }
  return null;
}

export function isPaseoToolName(name: string): boolean {
  const normalized = normalizeToolName(name);
  if (isSpeakToolName(normalized)) return false;
  return paseoSegments(normalized) !== null;
}

function getPaseoToolLeafName(name: string): string | null {
  return paseoSegments(normalizeToolName(name))?.[0] ?? null;
}

export function stripCwdPrefix(filePath: string, cwd?: string): string {
  if (!cwd || !filePath) return filePath;
  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = filePath.replace(/\\/g, "/");
  const prefix = `${normalizedCwd}/`;
  if (normalizedPath.startsWith(prefix)) return normalizedPath.slice(prefix.length);
  if (normalizedPath === normalizedCwd) return ".";
  return filePath;
}

function humanizeToolName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return name;
  if (isPaseoToolName(trimmed)) {
    const leaf = getPaseoToolLeafName(trimmed);
    if (leaf) return humanizeToolName(leaf);
  }
  if (/[:./]/.test(trimmed) || trimmed.includes("__")) return trimmed;
  return trimmed
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter((segment) => segment.length > 0)
    .join(" ")
    .toLowerCase()
    .replace(/^./, (character) => character.toUpperCase());
}

function formatErrorText(error: unknown): string | undefined {
  if (error === null || error === undefined) return undefined;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.content === "string") return error.content;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

type DetailDisplay = { displayName?: string; summary?: string };

function canonicalDetailDisplay(detail: ToolCallDetail, cwd: string | undefined): DetailDisplay {
  switch (detail.type) {
    case "shell":
      return { displayName: "Shell", summary: detail.command };
    case "read":
      return { displayName: "Read", summary: stripCwdPrefix(detail.filePath, cwd) };
    case "edit":
      return { displayName: "Edit", summary: stripCwdPrefix(detail.filePath, cwd) };
    case "write":
      return { displayName: "Write", summary: stripCwdPrefix(detail.filePath, cwd) };
    case "search":
      return { displayName: "Search", summary: detail.query };
    case "fetch":
      return { displayName: "Fetch", summary: detail.url };
    case "worktree_setup":
      return { displayName: "Worktree setup", summary: detail.branchName };
    case "sub_agent":
      return { displayName: readString(detail.subAgentType) ?? "Task", summary: readString(detail.description) };
    case "plain_text":
      return { summary: detail.label };
    case "plan":
      return { displayName: "Plan" };
    case "unknown":
      return {};
  }
}

function unknownDetailOverride(name: string, detail: ToolCallDetail, metadata: Record<string, unknown> | undefined): DetailDisplay {
  const lowerName = name.trim().toLowerCase();
  if (detail.type === "unknown" && lowerName === "task") return { displayName: "Task", summary: isRecord(metadata) ? readString(metadata.subAgentActivity) : undefined };
  if (detail.type === "unknown" && lowerName === "thinking") return { displayName: "Thinking" };
  if (lowerName === "terminal") return { displayName: "Terminal", summary: detail.type === "plain_text" ? readString(detail.label) : undefined };
  return {};
}

export interface ToolCallDisplayModel {
  displayName: string;
  summary?: string;
  errorText?: string;
}

export function buildToolCallDisplayModel(input: { name: string; status: "running" | "completed" | "failed" | "canceled"; error: unknown; detail: ToolCallDetail; metadata?: Record<string, unknown>; cwd?: string }): ToolCallDisplayModel {
  const canonical = canonicalDetailDisplay(input.detail, input.cwd);
  const override = unknownDetailOverride(input.name, input.detail, input.metadata);
  const displayName = override.displayName ?? canonical.displayName ?? humanizeToolName(input.name);
  const summary = override.summary ?? canonical.summary;
  const errorText = input.status === "failed" ? formatErrorText(input.error) : undefined;
  return { displayName, ...(summary ? { summary } : {}), ...(errorText ? { errorText } : {}) };
}

const TOOL_DETAIL_ICON_NAMES: Record<ToolCallDetail["type"], ToolCallIcon> = {
  shell: "square_terminal",
  read: "eye",
  edit: "pencil",
  write: "pencil",
  search: "search",
  fetch: "search",
  worktree_setup: "square_terminal",
  sub_agent: "bot",
  plain_text: "wrench",
  plan: "brain",
  unknown: "wrench",
};

export function resolveToolCallIconName(toolName: string, detail?: ToolCallDetail): ToolCallIcon {
  const lowerName = toolName.trim().toLowerCase();
  if (detail?.type === "plain_text" && detail.icon) return detail.icon;
  if (lowerName === "thinking" && (!detail || detail.type === "unknown")) return "brain";
  if (lowerName === "speak") return "mic_vocal";
  if (isPaseoToolName(lowerName)) return "paseo";
  if (lowerName === "task") return "bot";
  if (detail) return TOOL_DETAIL_ICON_NAMES[detail.type];
  return "wrench";
}

function hasMeaningfulUnknownValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulUnknownValue);
  if (typeof value === "object") return Object.values(value).some(hasMeaningfulUnknownValue);
  return true;
}

export function hasMeaningfulToolCallDetail(detail: ToolCallDetail | undefined): boolean {
  if (!detail) return false;
  switch (detail.type) {
    case "shell":
      return true;
    case "read":
    case "write":
      return Boolean(detail.filePath || detail.content);
    case "edit":
      return Boolean(detail.filePath || detail.unifiedDiff || detail.oldString || detail.newString);
    case "search":
      return detail.query.trim().length > 0 || Boolean(detail.content) || (detail.filePaths?.length ?? 0) > 0 || (detail.webResults?.length ?? 0) > 0 || (detail.annotations?.length ?? 0) > 0;
    case "fetch":
      return Boolean(detail.url || detail.result || detail.codeText);
    case "worktree_setup":
      return Boolean(detail.branchName || detail.worktreePath || detail.log);
    case "sub_agent":
      return Boolean(detail.subAgentType || detail.description || detail.log);
    case "plain_text":
      return Boolean(detail.label || detail.text);
    case "plan":
      return detail.text.trim().length > 0;
    case "unknown":
      return hasMeaningfulUnknownValue(detail.input) || hasMeaningfulUnknownValue(detail.output);
  }
}

export function isPendingToolCallDetail(params: { detail: ToolCallDetail | undefined; status: ToolCallDisplayStatus; error: unknown }): boolean {
  const isRunning = params.status === "running" || params.status === "executing";
  return isRunning && params.error == null && !hasMeaningfulToolCallDetail(params.detail);
}

const SHELL_FILE_COMMANDS = new Set(["cat", "bat", "less", "more", "head", "tail", "wc", "nl", "tac", "od", "xxd", "file", "stat", "column", "md5", "md5sum", "sha1sum", "sha256sum", "shasum"]);

function extractFromShellCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed || /[|><&;`$()]/.test(trimmed)) return null;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 2 || !SHELL_FILE_COMMANDS.has(tokens[0])) return null;
  const last = tokens[tokens.length - 1];
  if (last.startsWith("-")) return null;
  if (tokens.length > 2) {
    const prev = tokens[tokens.length - 2];
    if (!prev.startsWith("-")) {
      const prevPrev = tokens[tokens.length - 3];
      if (!prevPrev || !/^-[a-zA-Z]$/.test(prevPrev)) return null;
    }
  }
  return last;
}

export function extractToolCallFilePath(detail: ToolCallDetail | undefined): string | null {
  if (!detail) return null;
  switch (detail.type) {
    case "read":
    case "edit":
    case "write":
      return detail.filePath || null;
    case "shell":
      return extractFromShellCommand(detail.command);
    default:
      return null;
  }
}

export interface ToolCallPresentation {
  displayName: string;
  summary?: string;
  errorText?: string;
  icon: ToolCallIcon;
  isLoadingDetails: boolean;
  hasDetails: boolean;
  canOpenDetails: boolean;
  openFilePath: string | null;
  isPlan: boolean;
  planOutcome?: PlanOutcome;
}

export type PlanOutcome = "pending" | "approved" | "rejected" | "canceled";

function resolvePlanOutcome(status: ToolCallDisplayStatus, metadata: Record<string, unknown> | undefined): PlanOutcome | undefined {
  if (status === "canceled") return "canceled";
  if (metadata?.approved === false) return "rejected";
  if (metadata?.approved === true) return "approved";
  if (status === "running" || status === "executing") return "pending";
  return undefined;
}

export function buildToolCallPresentation(input: { toolName: string; status: ToolCallDisplayStatus; error: unknown; detail?: ToolCallDetail; cwd?: string; metadata?: Record<string, unknown> }): ToolCallPresentation {
  const model = buildToolCallDisplayModel({
    name: input.toolName,
    status: input.status === "executing" ? "running" : input.status,
    error: input.error ?? null,
    detail: input.detail ?? { type: "unknown", input: null, output: null },
    metadata: input.metadata,
    cwd: input.cwd,
  });
  const isLoadingDetails = isPendingToolCallDetail({ detail: input.detail, status: input.status, error: input.error });
  const hasDetails = Boolean(input.error) || hasMeaningfulToolCallDetail(input.detail);
  return {
    displayName: model.displayName,
    summary: model.summary,
    errorText: model.errorText,
    icon: resolveToolCallIconName(input.toolName, input.detail),
    isLoadingDetails,
    hasDetails,
    canOpenDetails: hasDetails || isLoadingDetails,
    openFilePath: extractToolCallFilePath(input.detail),
    isPlan: input.detail?.type === "plan",
    planOutcome: input.detail?.type === "plan" ? resolvePlanOutcome(input.status, input.metadata) : undefined,
  };
}

export type PaseoToolDetailSection = { kind: "prose"; title: string; text: string } | { kind: "fields"; title: string; fields: { label: string; value: string }[] };

const WORKSPACE_FIELDS = ["title", "workspaceId", "projectId", "isolation", "path", "mode", "worktreeSlug", "branchName", "baseBranch", "branch", "prNumber", "forge"];
const AGENT_FIELDS = ["title", "agentId", "provider", "workspaceId", "cwd", "sessionMode", "modeId", "background", "notifyOnFinish", "settings", "labels"];
const AUTOMATION_FIELDS = ["name", "id", "cron", "timezone", "provider", "cwd", "isolation", "maxRuns", "expiresIn", "clearExpires"];
const BROWSER_FIELDS = ["browserId", "url", "ref", "sourceRef", "targetRef", "value", "text", "key", "button", "doubleClick", "modifiers", "filePaths", "fullPage", "maxEntries", "timeoutMs", "deltaX", "deltaY", "width", "height", "function"];
const BROWSER_TOOLS = ["browser_new_tab", "browser_snapshot", "browser_click", "browser_fill", "browser_wait", "browser_type", "browser_keypress", "browser_navigate", "browser_back", "browser_forward", "browser_reload", "browser_screenshot", "browser_upload", "browser_hover", "browser_select", "browser_drag", "browser_logs", "browser_evaluate", "browser_scroll", "browser_resize", "browser_close_tab"];

const TOOL_SPECS: Record<string, { promptField?: string; inputOrder?: string[]; outputFields?: string[] }> = {
  create_workspace: { inputOrder: WORKSPACE_FIELDS, outputFields: ["workspaceId", "projectId"] },
  list_workspaces: {},
  archive_workspace: { inputOrder: ["workspaceId"], outputFields: ["workspaceId", "archivedAgentIds", "removedDirectory"] },
  rename_workspace: { inputOrder: ["title", "workspaceId"] },
  create_agent: { promptField: "initialPrompt", inputOrder: AGENT_FIELDS, outputFields: ["agentId", "status", "currentModeId", "cwd"] },
  send_agent_prompt: { promptField: "prompt", inputOrder: AGENT_FIELDS, outputFields: ["status", "lastMessage", "permission"] },
  get_agent_status: { inputOrder: ["agentId"] },
  list_agents: { inputOrder: ["cwd", "statuses", "sinceHours", "limit", "includeArchived"] },
  cancel_agent: { inputOrder: ["agentId"] },
  archive_agent: { inputOrder: ["agentId"] },
  kill_agent: { inputOrder: ["agentId"] },
  update_agent: { inputOrder: AGENT_FIELDS },
  get_agent_activity: { inputOrder: ["agentId", "limit"] },
  set_agent_mode: { inputOrder: ["agentId", "modeId"] },
  list_workspace_scripts: { inputOrder: ["workspaceId"] },
  start_workspace_script: { inputOrder: ["workspaceId", "scriptName"] },
  stop_workspace_script: { inputOrder: ["workspaceId", "scriptName"] },
  list_terminals: { inputOrder: ["cwd", "all"] },
  create_terminal: { inputOrder: ["cwd", "workspaceId", "name", "command"] },
  kill_terminal: { inputOrder: ["terminalId"] },
  capture_terminal: { inputOrder: ["terminalId", "lines"] },
  send_terminal_keys: { inputOrder: ["terminalId", "keys", "literal"] },
  create_schedule: { promptField: "prompt", inputOrder: AUTOMATION_FIELDS, outputFields: ["id", "status", "nextRunAt", "expiresAt"] },
  create_heartbeat: { promptField: "prompt", inputOrder: AUTOMATION_FIELDS, outputFields: ["id", "status", "nextRunAt", "expiresAt"] },
  delete_heartbeat: { inputOrder: ["id"] },
  list_schedules: {},
  inspect_schedule: { inputOrder: ["id"] },
  pause_schedule: { inputOrder: ["id"] },
  resume_schedule: { inputOrder: ["id"] },
  delete_schedule: { inputOrder: ["id"] },
  update_schedule: { promptField: "prompt", inputOrder: AUTOMATION_FIELDS },
  schedule_logs: { inputOrder: ["id"] },
  run_schedule_once: { inputOrder: ["id"] },
  list_providers: {},
  list_models: { inputOrder: ["provider"] },
  list_profiles: {},
  inspect_provider: { inputOrder: ["provider", "cwd", "settings"] },
  list_pending_permissions: {},
  respond_to_permission: { inputOrder: ["agentId", "requestId", "response"] },
  browser_list_tabs: {},
  ...Object.fromEntries(BROWSER_TOOLS.map((name) => [name, { inputOrder: BROWSER_FIELDS }])),
};

const FIELD_LABELS: Record<string, string> = {
  agentId: "Agent",
  archivedAgentIds: "Archived agents",
  baseBranch: "Base branch",
  branchName: "New branch",
  browserId: "Browser tab",
  clearExpires: "Clear expiry",
  currentModeId: "Current mode",
  cwd: "Working directory",
  deltaX: "Horizontal delta",
  deltaY: "Vertical delta",
  doubleClick: "Double click",
  expiresIn: "Expires in",
  expiresAt: "Expires",
  filePaths: "Files",
  fullPage: "Full page",
  initialPrompt: "Prompt",
  id: "ID",
  lastMessage: "Last message",
  maxEntries: "Maximum entries",
  maxRuns: "Maximum runs",
  modeId: "Mode",
  newMode: "New mode",
  nextRunAt: "Next run",
  notifyOnFinish: "Notify on finish",
  prNumber: "Change request",
  projectId: "Project",
  removedDirectory: "Removed directory",
  requestId: "Request",
  scriptName: "Script",
  sessionMode: "Session mode",
  sinceHours: "Since (hours)",
  sourceRef: "Source",
  targetRef: "Target",
  terminalId: "Terminal",
  thinkingOptionId: "Thinking",
  timeoutMs: "Timeout (ms)",
  updateCount: "Updates",
  workspaceId: "Workspace",
  worktreeSlug: "Worktree",
};

function humanizeKey(key: string): string {
  const known = FIELD_LABELS[key];
  if (known) return known;
  const sentence = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[._-]+/g, " ").split(" ").filter(Boolean).join(" ").toLowerCase();
  return `${sentence[0]?.toUpperCase() ?? ""}${sentence.slice(1)}`;
}

function indentMultiline(value: string, spaces: number): string {
  return value.replace(/\n/g, `\n${" ".repeat(spaces)}`);
}

function formatValue(value: unknown): string {
  if (value === null) return "None";
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "None" : value.map((item) => `• ${indentMultiline(formatValue(item), 2)}`).join("\n");
  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, child]) => child !== undefined);
    if (entries.length === 0) return "None";
    return entries.map(([key, child]) => `${humanizeKey(key)}: ${indentMultiline(formatValue(child), 2)}`).join("\n");
  }
  return String(value);
}

function fieldsFromValue(value: unknown, order: string[] = [], omittedKey?: string, includedKeys?: string[]): { label: string; value: string }[] {
  if (value === null || value === undefined) return [];
  if (!isRecord(value)) {
    const formatted = formatValue(value);
    return formatted ? [{ label: "Value", value: formatted }] : [];
  }
  const included = includedKeys ? new Set(includedKeys) : null;
  const rank = new Map(order.map((key, index) => [key, index]));
  return Object.keys(value)
    .filter((key) => key !== omittedKey && value[key] !== undefined && (!included || included.has(key)))
    .sort((left, right) => (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right))
    .map((key) => ({ label: humanizeKey(key), value: formatValue(value[key]) }));
}

function unwrapMcpResult(output: unknown): unknown {
  if (!isRecord(output)) return output;
  if (output.structuredContent !== undefined) return output.structuredContent;
  if (Array.isArray(output.content) && output.content.length === 1) {
    const item = output.content[0];
    if (isRecord(item) && item.type === "text") {
      if (typeof item.text === "string") {
        try {
          return JSON.parse(item.text) as unknown;
        } catch {
          return item.text;
        }
      }
      return item.text;
    }
  }
  return output;
}

export function buildPaseoToolDetailSections(toolName: string, input: unknown, output: unknown): PaseoToolDetailSection[] | null {
  const leafName = getPaseoToolLeafName(toolName);
  if (!leafName) return null;
  const spec = TOOL_SPECS[leafName] ?? {};
  const sections: PaseoToolDetailSection[] = [];
  if (spec.promptField && isRecord(input)) {
    const prompt = input[spec.promptField];
    if (typeof prompt === "string" && prompt.length > 0) sections.push({ kind: "prose", title: "Prompt", text: prompt });
  }
  const inputFields = fieldsFromValue(input, spec.inputOrder, spec.promptField);
  if (inputFields.length > 0) sections.push({ kind: "fields", title: "Details", fields: inputFields });
  const outputFields = fieldsFromValue(unwrapMcpResult(output), spec.outputFields, undefined, spec.outputFields);
  if (outputFields.length > 0) sections.push({ kind: "fields", title: "Result", fields: outputFields });
  return sections;
}
