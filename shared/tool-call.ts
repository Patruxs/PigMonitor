export type ToolCallIconName = "wrench" | "square_terminal" | "eye" | "pencil" | "search" | "bot" | "sparkles" | "brain" | "mic_vocal";

export type ToolCallDetail =
  | { type: "shell"; command: string; cwd?: string; output?: string; exitCode?: number | null }
  | { type: "read"; filePath: string; content?: string; offset?: number; limit?: number }
  | { type: "edit"; filePath: string; oldString?: string; newString?: string; unifiedDiff?: string }
  | { type: "write"; filePath: string; content?: string }
  | {
      type: "search";
      query: string;
      toolName?: "search" | "grep" | "glob" | "web_search";
      content?: string;
      filePaths?: string[];
      webResults?: Array<{ title: string; url: string }>;
      annotations?: string[];
      numFiles?: number;
      numMatches?: number;
      durationMs?: number;
      durationSeconds?: number;
      truncated?: boolean;
      mode?: "content" | "files_with_matches" | "count";
    }
  | { type: "fetch"; url: string; prompt?: string; result?: string; code?: number; codeText?: string; bytes?: number; durationMs?: number }
  | {
      type: "worktree_setup";
      worktreePath: string;
      branchName: string;
      log: string;
      commands: Array<{ index: number; command: string; cwd: string; log: string; status: "running" | "completed" | "failed"; exitCode: number | null; durationMs?: number }>;
      truncated?: boolean;
    }
  | { type: "sub_agent"; subAgentType?: string; description?: string; childSessionId?: string; log: string; actions?: Array<{ index: number; toolName: string; summary?: string }> }
  | { type: "plain_text"; label?: string; text?: string; icon?: ToolCallIconName }
  | { type: "plan"; text: string }
  | { type: "unknown"; input: unknown; output: unknown };

export type ToolCallStatus = "executing" | "running" | "completed" | "failed" | "canceled";

export type ToolCallIcon = ToolCallIconName | "paseo";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

function isSpeakToolName(name: string): boolean {
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

export function isPendingToolCallDetail(params: { detail: ToolCallDetail | undefined; status: ToolCallStatus; error: unknown }): boolean {
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

function resolvePlanOutcome(status: ToolCallStatus, metadata: Record<string, unknown> | undefined): PlanOutcome | undefined {
  if (status === "canceled") return "canceled";
  if (metadata?.approved === false) return "rejected";
  if (metadata?.approved === true) return "approved";
  if (status === "running" || status === "executing") return "pending";
  return undefined;
}

export function buildToolCallPresentation(input: { toolName: string; status: ToolCallStatus; error: unknown; detail?: ToolCallDetail; cwd?: string; metadata?: Record<string, unknown> }): ToolCallPresentation {
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

export interface DiffSegment {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  segments?: DiffSegment[];
}

function splitIntoLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

function splitIntoWords(text: string): string[] {
  const result: string[] = [];
  let current = "";
  let inWord = false;
  for (const char of text) {
    const isWordChar = /\w/.test(char);
    if (isWordChar !== inWord && current) {
      result.push(current);
      current = "";
    }
    inWord = isWordChar;
    current += char;
  }
  if (current) result.push(current);
  return result;
}

function lcsTable<T>(a: T[], b: T[]): number[][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

function buildSegments(words: string[], inLcs: Set<number>): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let currentText = "";
  let currentChanged: boolean | null = null;
  words.forEach((word, index) => {
    const changed = !inLcs.has(index);
    if (currentChanged === null || changed === currentChanged) {
      currentText += word;
      currentChanged = changed;
      return;
    }
    segments.push({ text: currentText, changed: currentChanged });
    currentText = word;
    currentChanged = changed;
  });
  if (currentText) segments.push({ text: currentText, changed: currentChanged ?? false });
  return segments;
}

function computeWordLevelDiff(oldLine: string, newLine: string): { oldSegments: DiffSegment[]; newSegments: DiffSegment[] } {
  const oldWords = splitIntoWords(oldLine);
  const newWords = splitIntoWords(newLine);
  const dp = lcsTable(oldWords, newWords);
  const oldInLcs = new Set<number>();
  const newInLcs = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < oldWords.length && j < newWords.length) {
    if (oldWords[i] === newWords[j]) {
      oldInLcs.add(i);
      newInLcs.add(j);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  return { oldSegments: buildSegments(oldWords, oldInLcs), newSegments: buildSegments(newWords, newInLcs) };
}

export function buildLineDiff(originalText: string, updatedText: string): DiffLine[] {
  const originalLines = splitIntoLines(originalText);
  const updatedLines = splitIntoLines(updatedText);
  if (originalLines.length === 0 && updatedLines.length === 0) return [];
  const dp = lcsTable(originalLines, updatedLines);
  const diff: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < originalLines.length && j < updatedLines.length) {
    if (originalLines[i] === updatedLines[j]) {
      diff.push({ type: "context", content: ` ${originalLines[i]}` });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: "remove", content: `-${originalLines[i]}` });
      i += 1;
    } else {
      diff.push({ type: "add", content: `+${updatedLines[j]}` });
      j += 1;
    }
  }
  for (; i < originalLines.length; i += 1) diff.push({ type: "remove", content: `-${originalLines[i]}` });
  for (; j < updatedLines.length; j += 1) diff.push({ type: "add", content: `+${updatedLines[j]}` });
  for (let index = 0; index < diff.length - 1; index++) {
    const curr = diff[index];
    const next = diff[index + 1];
    if (curr.type === "remove" && next.type === "add") {
      const { oldSegments, newSegments } = computeWordLevelDiff(curr.content.slice(1), next.content.slice(1));
      curr.segments = oldSegments;
      next.segments = newSegments;
    }
  }
  return diff;
}

export function parseUnifiedDiff(diffText?: string): DiffLine[] {
  const diff: DiffLine[] = [];
  for (const line of splitIntoLines(diffText ?? "")) {
    if (!line.length) diff.push({ type: "context", content: line });
    else if (line.startsWith("@@")) diff.push({ type: "header", content: line });
    else if (line.startsWith("+")) {
      if (!line.startsWith("+++")) diff.push({ type: "add", content: line });
    } else if (line.startsWith("-")) {
      if (!line.startsWith("---")) diff.push({ type: "remove", content: line });
    } else if (line.startsWith("diff --git") || line.startsWith("index ")) continue;
    else if (line.startsWith("\\ No newline")) diff.push({ type: "header", content: line });
    else diff.push({ type: "context", content: line });
  }
  return diff;
}

export interface TaskEntry {
  text: string;
  status: "pending" | "in_progress" | "completed";
  completed: boolean;
}

const TASK_STATUSES = new Set(["pending", "in_progress", "completed"]);

function taskStatusOf(value: unknown): TaskEntry["status"] | null {
  return typeof value === "string" && TASK_STATUSES.has(value) ? (value as TaskEntry["status"]) : null;
}

function claudeTodos(input: unknown): TaskEntry[] | null {
  if (!isRecord(input) || !Array.isArray(input.todos)) return null;
  const out: TaskEntry[] = [];
  for (const todo of input.todos) {
    if (!isRecord(todo) || typeof todo.content !== "string") return null;
    const status = taskStatusOf(todo.status);
    if (!status) return null;
    if (todo.activeForm !== undefined && typeof todo.activeForm !== "string") return null;
    const text = (typeof todo.activeForm === "string" ? todo.activeForm.trim() : "") || todo.content.trim();
    out.push({ text: text.length ? text : todo.content, status, completed: status === "completed" });
  }
  return out;
}

function planSteps(input: unknown): TaskEntry[] | null {
  if (!isRecord(input) || !Array.isArray(input.plan)) return null;
  const out: TaskEntry[] = [];
  for (const entry of input.plan) {
    if (!isRecord(entry) || typeof entry.step !== "string") return null;
    const status = taskStatusOf(entry.status) ?? "pending";
    out.push({ text: entry.step.trim(), status, completed: status === "completed" });
  }
  return out.filter((entry) => entry.text.length > 0);
}

export function normalizeTaskToolName(toolName: string): string {
  return toolName.trim().replace(/[.\s-]+/g, "_").toLowerCase();
}

export function extractTaskEntriesFromToolCall(toolName: string, input: unknown): TaskEntry[] | null {
  const normalized = normalizeTaskToolName(toolName);
  if (normalized === "exitplanmode") return null;
  if (normalized === "todowrite" || normalized === "todo_write") return claudeTodos(input);
  if (normalized === "update_plan") return planSteps(input);
  return null;
}
