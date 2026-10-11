import path from "node:path";
import type { ToolResultBlock } from "./claude-log.ts";
import type { ToolCall } from "../shared/stream/transcript.ts";
import { isRecord } from "../shared/guards.ts";
import { isSpeakToolName, type ToolCallDetail } from "../shared/stream/tool-call.ts";

type Rec = Record<string, unknown>;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isStr = (v: unknown): v is string => typeof v === "string";
const optOf = (o: Rec, keys: string[], ok: (v: unknown) => boolean): boolean => keys.every((k) => o[k] === undefined || ok(o[k]));
const optStr = (o: Rec, ...keys: string[]): boolean => optOf(o, keys, isStr);
const str = (o: Rec | undefined, k: string): string | undefined => (o && isStr(o[k]) ? (o[k] as string) : undefined);

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const firstNonEmpty = (...values: unknown[]): string | undefined => {
  for (const v of values) {
    const s = nonEmptyString(v);
    if (s) return s;
  }
  return undefined;
};

const CODEX_SHELL_ENVELOPE_HEADER_LINES = ["chunk id:", "wall time:", "process exited with code", "original token count:"];

const isCodexShellEnvelopeHeaderLine = (line: string): boolean => CODEX_SHELL_ENVELOPE_HEADER_LINES.some((p) => line.trim().toLowerCase().startsWith(p));

function looksLikeCodexShellEnvelope(lines: string[]): boolean {
  if (!(lines[0]?.trim().toLowerCase() ?? "").startsWith("chunk id:")) return false;
  const head = lines.slice(0, 8).map((l) => l.trim().toLowerCase());
  return head.some((l) => l.startsWith("wall time:")) && head.some((l) => l.startsWith("process exited with code"));
}

function extractCodexShellOutput(value: string | undefined): string | undefined {
  const text = nonEmptyString(value);
  if (!text) return undefined;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (!looksLikeCodexShellEnvelope(lines)) return text;
  const outputLine = lines.findIndex((l) => l.trim() === "Output:");
  if (outputLine >= 0) return nonEmptyString(lines.slice(outputLine + 1).join("\n"));
  const body = lines.findIndex((l, i) => i > 0 && !isCodexShellEnvelopeHeaderLine(l));
  return body === -1 ? undefined : nonEmptyString(lines.slice(body).join("\n"));
}

type Chunk = { text?: string; content?: string; output?: string };
type ReadContent = string | Chunk | Chunk[];

function flattenReadContent(value: ReadContent | undefined): string | undefined {
  if (typeof value === "string") return nonEmptyString(value);
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const parts = value.map((c) => firstNonEmpty(c.text, c.content, c.output)).filter((p): p is string => p !== undefined);
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  return firstNonEmpty(value.text, value.content, value.output);
}

const READ_GUTTER_LINE = /^\s*(\d+)\t(.*)$/;

function stripReadLineNumberGutter(content: string | undefined): { content: string; startLine?: number } | undefined {
  const text = nonEmptyString(content);
  if (!text) return undefined;
  const stripped: string[] = [];
  let nonEmpty = 0;
  let matched = 0;
  let startLine: number | undefined;
  let prev: number | undefined;
  let sequential = true;
  let firstMatched = false;
  let sawNonEmpty = false;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (line.length === 0) {
      stripped.push(line);
      continue;
    }
    nonEmpty += 1;
    const m = line.match(READ_GUTTER_LINE);
    if (!m) {
      if (!sawNonEmpty) return undefined;
      stripped.push(line);
      continue;
    }
    if (!sawNonEmpty) firstMatched = true;
    sawNonEmpty = true;
    matched += 1;
    const n = Number.parseInt(m[1], 10);
    if (startLine === undefined) startLine = n;
    if (prev !== undefined && n !== prev + 1) sequential = false;
    prev = n;
    stripped.push(m[2]);
  }
  if (!firstMatched || !sequential || nonEmpty === 0) return undefined;
  if (matched / nonEmpty < 0.5) return undefined;
  return { content: stripped.join("\n"), startLine };
}

function truncateDiffText(text: string | undefined, maxChars = 12_000): string | undefined {
  if (typeof text !== "string") return undefined;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

const isCommandValue = (v: unknown): v is string | string[] => isStr(v) || (Array.isArray(v) && v.every(isStr));

function shellInput(v: unknown): { command?: string; cwd?: string } | undefined {
  if (!isRecord(v) || !optStr(v, "cwd", "directory") || !(isCommandValue(v.command) || isCommandValue(v.cmd))) return undefined;
  const raw = "command" in v ? v.command : v.cmd;
  let command: string | undefined;
  if (isStr(raw)) command = nonEmptyString(raw);
  else if (Array.isArray(raw) && raw.every(isStr)) command = raw.map((t) => t.trim()).filter((t) => t.length > 0).join(" ") || undefined;
  return { command, cwd: nonEmptyString(v.cwd) ?? nonEmptyString(v.directory) };
}

const isTextFields = (v: unknown): v is Rec => isRecord(v) && optStr(v, "output", "text", "content");
const isExitCode = (v: unknown) => v === null || isNum(v);

function shellOutput(v: unknown): { command?: string; output?: string; exitCode?: number | null } | undefined {
  if (isStr(v)) return { output: extractCodexShellOutput(v) };
  if (!isRecord(v) || !optStr(v, "command", "output", "text", "content", "aggregated_output", "aggregatedOutput") || !optOf(v, ["exitCode", "exit_code"], isExitCode)) return undefined;
  const metadata = v.metadata as Rec | undefined;
  if (metadata !== undefined && !(isRecord(metadata) && optOf(metadata, ["exitCode", "exit_code"], isExitCode))) return undefined;
  if (!optOf(v, ["structuredContent", "structured_content"], isTextFields)) return undefined;
  const result = v.result as Rec | undefined;
  if (result !== undefined && !(isTextFields(result) && optStr(result, "command"))) return undefined;
  const sc = v.structuredContent as Rec | undefined;
  const sc2 = v.structured_content as Rec | undefined;
  return {
    command: nonEmptyString(v.command) ?? nonEmptyString(result?.command),
    output: extractCodexShellOutput(firstNonEmpty(v.output, v.text, v.content, v.aggregated_output, v.aggregatedOutput, sc?.output, sc?.text, sc?.content, sc2?.output, sc2?.text, sc2?.content, result?.output, result?.text, result?.content)),
    exitCode: ((v.exitCode ?? v.exit_code ?? metadata?.exitCode ?? metadata?.exit_code ?? undefined) as number | null | undefined),
  };
}

function pathOf(v: Rec): string | undefined {
  return str(v, "path") ?? str(v, "file_path") ?? str(v, "filePath");
}

function readInput(v: unknown): { filePath: string; offset?: number; limit?: number } | undefined {
  if (!isRecord(v) || !optOf(v, ["offset", "limit"], isNum)) return undefined;
  const filePath = pathOf(v);
  return filePath === undefined ? undefined : { filePath, offset: v.offset as number | undefined, limit: v.limit as number | undefined };
}

const isChunk = (v: unknown): v is Chunk => isTextFields(v) && (isStr(v.text) || isStr(v.content) || isStr(v.output));
const isReadContent = (v: unknown): v is ReadContent => isStr(v) || isChunk(v) || (Array.isArray(v) && v.every(isChunk));
const isReadPayload = (v: unknown): v is { content?: ReadContent; text?: ReadContent; output?: ReadContent } =>
  isRecord(v) && optOf(v, ["content", "text", "output"], isReadContent) && (v.content !== undefined || v.text !== undefined || v.output !== undefined);

function decodeXmlText(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|amp|lt|gt|quot|apos);/g, (entity, decimal, hex) => {
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" } as Record<string, string>)[entity] ?? entity;
  });
}

function parseXmlReadOutput(value: string): { filePath?: string; content?: string } | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("<path>") || !/<content>/i.test(trimmed)) return undefined;
  const filePath = nonEmptyString(trimmed.match(/<path>([\s\S]*?)<\/path>/i)?.[1]?.trim());
  const content = trimmed.match(/<content>([\s\S]*?)<\/content>/i)?.[1];
  if (!filePath && content === undefined) return undefined;
  return { filePath: filePath ? decodeXmlText(filePath) : undefined, content: content === undefined ? undefined : decodeXmlText(content.replace(/^\r?\n/, "").replace(/\r?\n$/, "")) };
}

function readOutput(v: unknown): { filePath?: string; content?: string } | undefined {
  if (isStr(v)) return parseXmlReadOutput(v) ?? { content: nonEmptyString(v) };
  if (isChunk(v) || (Array.isArray(v) && v.every(isChunk))) return { content: flattenReadContent(v) };
  const payload = isReadPayload(v) ? v : isRecord(v) ? [v.data, v.structuredContent, v.structured_content].find(isReadPayload) : undefined;
  if (!payload) return undefined;
  return { content: flattenReadContent(payload.content) ?? flattenReadContent(payload.text) ?? flattenReadContent(payload.output) };
}

function withPath(v: unknown, fields: (o: Rec) => boolean): { filePath: string; fields: Rec } | undefined {
  if (!isRecord(v) || !fields(v)) return undefined;
  const filePath = pathOf(v);
  if (filePath === undefined || (v.filePath !== undefined && v.filePath !== filePath)) return undefined;
  return { filePath, fields: v };
}

const isWriteFields = (o: Rec) => optStr(o, "content", "new_content", "newContent");
const writeContent = (o: Rec) => firstNonEmpty(o.content, o.new_content, o.newContent);

function writeInput(v: unknown): { filePath: string; content?: string } | undefined {
  const p = withPath(v, isWriteFields);
  return p && { filePath: p.filePath, content: writeContent(p.fields) };
}

function writeOutput(v: unknown): { filePath?: string; content?: string } | undefined {
  if (isStr(v)) return {};
  const p = withPath(v, isWriteFields);
  if (p) return { filePath: p.filePath, content: writeContent(p.fields) };
  return isRecord(v) && isWriteFields(v) ? { content: writeContent(v) } : undefined;
}

const EDIT_TEXT_KEYS = ["old_string", "old_str", "oldContent", "old_content", "new_string", "new_str", "newContent", "new_content", "content", "patch", "diff", "unified_diff", "unifiedDiff"];
const isEditFields = (o: Rec) => optStr(o, ...EDIT_TEXT_KEYS);
const diffOf = (o: Rec) => truncateDiffText(firstNonEmpty(o.patch, o.diff, o.unified_diff, o.unifiedDiff));

function editInput(v: unknown): { filePath: string; oldString?: string; newString?: string; unifiedDiff?: string } | undefined {
  const p = withPath(v, isEditFields);
  if (!p) return undefined;
  const o = p.fields;
  return { filePath: p.filePath, oldString: firstNonEmpty(o.old_string, o.old_str, o.oldContent, o.old_content), newString: firstNonEmpty(o.new_string, o.new_str, o.newContent, o.new_content, o.content), unifiedDiff: diffOf(o) };
}

function editOutput(v: unknown): { filePath?: string; newString?: string; unifiedDiff?: string } | undefined {
  const p = withPath(v, isEditFields);
  if (p) return { filePath: p.filePath, newString: firstNonEmpty(p.fields.newContent, p.fields.new_content, p.fields.content), unifiedDiff: diffOf(p.fields) };
  if (isRecord(v) && Array.isArray(v.files) && v.files.length > 0) {
    const files = v.files.map((f) => (isRecord(f) && optStr(f, "patch", "diff", "unified_diff", "unifiedDiff") ? pathOf(f) : undefined));
    if (files.every((f) => f !== undefined)) return { filePath: files[0], unifiedDiff: diffOf(v.files[0] as Rec) };
  }
  return isRecord(v) && isEditFields(v) ? { newString: firstNonEmpty(v.newContent, v.new_content, v.content), unifiedDiff: diffOf(v) } : undefined;
}

function searchInput(v: unknown): { query: string } | undefined {
  if (!isRecord(v)) return undefined;
  const query = str(v, "query") ?? str(v, "q") ?? str(v, "pattern");
  return query === undefined ? undefined : { query };
}

const isGlobOutput = (v: unknown): v is Rec & { durationMs: number; numFiles: number; filenames: string[]; truncated: boolean } =>
  isRecord(v) && isNum(v.durationMs) && isCount(v.numFiles) && Array.isArray(v.filenames) && v.filenames.every(isStr) && typeof v.truncated === "boolean";

const GREP_MODES = ["content", "files_with_matches", "count"];

const isGrepOutput = (v: unknown): v is Rec & { numFiles: number; filenames: string[] } =>
  isRecord(v) &&
  (v.mode === undefined || GREP_MODES.includes(v.mode as string)) &&
  isCount(v.numFiles) &&
  Array.isArray(v.filenames) &&
  v.filenames.every(isStr) &&
  optStr(v, "content") &&
  optOf(v, ["numLines", "numMatches", "appliedLimit", "appliedOffset"], isCount);

function claudeGrepOutput(v: unknown): Rec | undefined {
  if (isGrepOutput(v)) return v;
  return isRecord(v) && isStr(v.output) ? { numFiles: 0, filenames: [], content: v.output } : undefined;
}

const isWebHit = (v: unknown) => isRecord(v) && isStr(v.title) && isStr(v.url);

const isWebSearchOutput = (v: unknown): v is Rec =>
  isRecord(v) && isStr(v.query) && isNum(v.durationSeconds) && Array.isArray(v.results) && v.results.every((e) => isStr(e) || (isRecord(e) && isStr(e.tool_use_id) && Array.isArray(e.content) && e.content.every(isWebHit)));

function webFetchInput(v: unknown): { url: string; prompt: string } | undefined {
  return isRecord(v) && isStr(v.url) && isStr(v.prompt) ? { url: v.url, prompt: v.prompt } : undefined;
}

const isWebFetchOutput = (v: unknown): v is Rec & { bytes: number; code: number; codeText: string; result: string; durationMs: number; url: string } =>
  isRecord(v) && isCount(v.bytes) && Number.isSafeInteger(v.code) && isStr(v.codeText) && isStr(v.result) && isNum(v.durationMs) && isStr(v.url);

function searchOutputFields(output: Rec | null | undefined): Rec {
  if (output && "filenames" in output && !("truncated" in output)) {
    const filenames = output.filenames as string[];
    return {
      ...(output.content ? { content: output.content } : {}),
      ...(filenames.length > 0 ? { filePaths: filenames } : {}),
      numFiles: output.numFiles,
      ...(output.numMatches !== undefined ? { numMatches: output.numMatches } : {}),
      ...(output.mode ? { mode: output.mode } : {}),
    };
  }
  if (output && "truncated" in output) {
    const filenames = output.filenames as string[];
    return { ...(filenames.length > 0 ? { filePaths: filenames } : {}), numFiles: output.numFiles, durationMs: output.durationMs, truncated: output.truncated };
  }
  if (output && "results" in output) {
    const results = output.results as Array<string | { content: Array<{ title: string; url: string }> }>;
    const webResults = results.flatMap((e) => (typeof e === "string" ? [] : e.content));
    const annotations = results.filter((e): e is string => typeof e === "string");
    return { ...(webResults.length > 0 ? { webResults } : {}), ...(annotations.length > 0 ? { annotations } : {}), durationSeconds: output.durationSeconds };
  }
  return {};
}

type SearchToolName = "search" | "grep" | "glob" | "web_search";

function toSearchDetail(input: { query: string } | null, toolName: SearchToolName, output?: Rec | null): ToolCallDetail | undefined {
  if (!input?.query) return undefined;
  return { type: "search", query: input.query, toolName, ...searchOutputFields(output) } as ToolCallDetail;
}

const trimmedPath = (p: string | undefined): string | undefined => (typeof p === "string" && p.trim() ? p.trim() : undefined);

function branch<I, O>(input: unknown, output: unknown, parseIn: (v: unknown) => I | undefined, parseOut: (v: unknown) => O | undefined, map: (i: I | null, o: O | null) => ToolCallDetail | undefined): ToolCallDetail | undefined {
  const i = input === null ? null : parseIn(input);
  const o = output === null ? null : parseOut(output);
  if (i === undefined || o === undefined) return undefined;
  return map(i, o);
}

const anything = (v: unknown) => v;

function shellDetail(input: unknown, output: unknown) {
  return branch(input, output, shellInput, shellOutput, (i, o) => {
    const command = i?.command ?? o?.command;
    if (!command) return undefined;
    return { type: "shell", command, ...(i?.cwd ? { cwd: i.cwd } : {}), ...(o?.output ? { output: o.output } : {}), ...(o?.exitCode !== undefined ? { exitCode: o.exitCode } : {}) };
  });
}

function readDetail(input: unknown, output: unknown) {
  return branch(input, output, readInput, anything, (i, raw) => {
    const o = raw === null ? undefined : readOutput(raw);
    const filePath = trimmedPath(i?.filePath ?? o?.filePath);
    if (!filePath) return undefined;
    const stripped = o?.content ? stripReadLineNumberGutter(o.content) : undefined;
    const content = stripped?.content ?? o?.content;
    const offset = i?.offset ?? stripped?.startLine;
    return { type: "read", filePath, ...(content ? { content } : {}), ...(offset !== undefined ? { offset } : {}), ...(i?.limit !== undefined ? { limit: i.limit } : {}) };
  });
}

function writeDetail(input: unknown, output: unknown) {
  return branch(input, output, writeInput, writeOutput, (i, o) => {
    const filePath = trimmedPath(i?.filePath ?? o?.filePath);
    if (!filePath) return undefined;
    const content = i?.content ?? o?.content;
    return { type: "write", filePath, ...(content ? { content } : {}) };
  });
}

function editDetail(input: unknown, output: unknown) {
  return branch(input, output, editInput, editOutput, (i, o) => {
    const filePath = trimmedPath(i?.filePath ?? o?.filePath);
    if (!filePath) return undefined;
    const newString = i?.newString ?? o?.newString;
    const unifiedDiff = i?.unifiedDiff ?? o?.unifiedDiff;
    return { type: "edit", filePath, ...(i?.oldString ? { oldString: i.oldString } : {}), ...(newString ? { newString } : {}), ...(unifiedDiff ? { unifiedDiff } : {}) };
  });
}

function fetchDetail(input: unknown, output: unknown) {
  return branch(input, output, webFetchInput, (v) => (isWebFetchOutput(v) ? v : undefined), (i, o) => {
    const url = i?.url ?? o?.url;
    if (!url) return undefined;
    return {
      type: "fetch",
      url,
      ...(i?.prompt ? { prompt: i.prompt } : {}),
      ...(o?.result ? { result: o.result } : {}),
      ...(o?.code !== undefined ? { code: o.code } : {}),
      ...(o?.codeText ? { codeText: o.codeText } : {}),
      ...(o?.bytes !== undefined ? { bytes: o.bytes } : {}),
      ...(o?.durationMs !== undefined ? { durationMs: o.durationMs } : {}),
    };
  });
}

function skillDetail(input: unknown, output: unknown) {
  const skillOutput = (v: unknown) => (isStr(v) ? v : isRecord(v) && isStr(v.output) ? v.output : undefined);
  return branch(input, output, (v) => (isRecord(v) && isStr(v.skill) ? v : undefined), skillOutput, (i, o) => {
    const label = i?.skill as string | undefined;
    if (!label) return undefined;
    return { type: "plain_text", label, icon: "sparkles", ...(o ? { text: o } : {}) };
  });
}

function speakDetail(input: unknown, output: unknown) {
  const speakInput = (v: unknown) => (isStr(v) ? { text: v } : isRecord(v) && isStr(v.text) ? { text: v.text } : undefined);
  return branch(input, output, speakInput, anything, (i) => {
    const text = i?.text.trim() ?? "";
    return text ? { type: "unknown", input: text, output: null } : undefined;
  });
}

const SHELL_NAMES = new Set(["Bash", "bash", "shell", "exec_command"]);
const READ_NAMES = new Set(["Read", "read", "read_file", "view_file"]);
const WRITE_NAMES = new Set(["Write", "write", "write_file", "create_file"]);
const EDIT_NAMES = new Set(["Edit", "MultiEdit", "multi_edit", "edit", "apply_patch", "apply_diff", "str_replace_editor"]);
const FETCH_NAMES = new Set(["WebFetch", "web_fetch", "WebFetchTool", "web_fetch_tool", "webfetch"]);
const SEARCH_TOOL: Record<string, SearchToolName> = { WebSearch: "web_search", web_search: "web_search", search: "search", Grep: "grep", grep: "grep", Glob: "glob", glob: "glob" };

function searchDetail(toolName: SearchToolName, input: unknown, output: unknown) {
  if (toolName === "search") return branch(input, output, searchInput, anything, (i) => toSearchDetail(i, "search"));
  if (toolName === "grep") return branch(input, output, searchInput, claudeGrepOutput, (i, o) => toSearchDetail(i, "grep", o));
  if (toolName === "glob") return branch(input, output, searchInput, (v) => (isGlobOutput(v) ? v : undefined), (i, o) => toSearchDetail(i, "glob", o));
  return branch(input, output, searchInput, (v) => (isWebSearchOutput(v) ? v : undefined), (i, o) => toSearchDetail(i, "web_search", o));
}

function deriveClaudeToolDetail(name: string, input: unknown, output: unknown): ToolCallDetail {
  const unknown: ToolCallDetail = { type: "unknown", input: input ?? null, output: output ?? null };
  if (!name) return unknown;
  let detail: ToolCallDetail | undefined;
  if (SHELL_NAMES.has(name)) detail = shellDetail(input ?? null, output ?? null);
  else if (READ_NAMES.has(name)) detail = readDetail(input ?? null, output ?? null);
  else if (WRITE_NAMES.has(name)) detail = writeDetail(input ?? null, output ?? null);
  else if (EDIT_NAMES.has(name)) detail = editDetail(input ?? null, output ?? null);
  else if (name in SEARCH_TOOL) detail = searchDetail(SEARCH_TOOL[name], input ?? null, output ?? null);
  else if (FETCH_NAMES.has(name)) detail = fetchDetail(input ?? null, output ?? null);
  else if (name === "Skill") detail = skillDetail(input ?? null, output ?? null);
  else if (name === "speak") detail = speakDetail(input ?? null, output ?? null);
  return detail ?? unknown;
}

function detailName(name: string): string {
  if (SHELL_NAMES.has(name)) return "shell";
  if (READ_NAMES.has(name)) return "read_file";
  if (WRITE_NAMES.has(name)) return "write_file";
  if (EDIT_NAMES.has(name)) return "apply_patch";
  if (name in SEARCH_TOOL || FETCH_NAMES.has(name)) return name;
  if (isSpeakToolName(name)) return "speak";
  return name;
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortedJson(value[k])]));
  return value;
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content) && content.every((b) => isRecord(b) && b.type === "text" && isStr(b.text))) return content.map((b) => (b as { text: string }).text).join("");
  if (content === undefined) return "";
  const normalized = sortedJson(content);
  return typeof normalized === "string" ? normalized : JSON.stringify(normalized);
}

function withoutImages(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((b) => (isRecord(b) && b.type === "image" && isRecord(b.source) && b.source.type === "base64" && isStr(b.source.data) ? { type: "text", text: "[image]" } : b));
}

const isCommandName = (lower: string, words: string[]) => words.some((w) => lower.includes(w));
const hasCommand = (input: Rec | null) => Boolean(input && (isStr(input.command) || Array.isArray(input.command)));

function commandText(input: Rec): string | undefined {
  if (isStr(input.command) && input.command.length > 0) return input.command;
  if (Array.isArray(input.command)) {
    const tokens = input.command.filter(isStr);
    if (tokens.length > 0) return tokens.join(" ");
  }
  return nonEmptyString(input.description);
}

function patchFiles(patch: string): Array<{ path: string; kind: string }> {
  const files: Array<{ path: string; kind: string }> = [];
  const seen = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const m = line.trim().match(/^\*\*\* (Add|Delete|Update) File:(.*)$/);
    const file = m?.[2].trim();
    if (!m || !file) continue;
    const kind = m[1].toLowerCase();
    if (seen.has(`${kind}:${file}`)) continue;
    seen.add(`${kind}:${file}`);
    files.push({ path: file, kind });
  }
  return files;
}

export type FileExists = (file: string) => boolean;

function fileChanges(input: Rec, cwd: string | undefined, fileExists: FileExists): Array<{ path: string; kind: string }> | undefined {
  const fileKind = (file: string) => (fileExists(file) ? "update" : "add");
  const relative = (target: string) => (cwd && target.startsWith(cwd) ? path.relative(cwd, target) || path.basename(target) : target);
  if (isStr(input.file_path) && input.file_path.length > 0) return [{ path: relative(input.file_path), kind: fileKind(input.file_path) }];
  if (isStr(input.patch) && input.patch.length > 0) {
    const files = patchFiles(input.patch);
    if (files.length > 0) return files.map((f) => ({ path: relative(f.path), kind: f.kind }));
  }
  if (Array.isArray(input.files)) {
    const files = input.files.filter((f): f is string => isStr(f) && f.length > 0).map((f) => ({ path: relative(f), kind: fileKind(f) }));
    if (files.length > 0) return files;
  }
  return undefined;
}

function structuredOutput(name: string, output: string, input: Rec | null): Rec | undefined {
  const lower = name.toLowerCase();
  if (isCommandName(lower, ["bash", "shell", "command"]) || hasCommand(input)) {
    return { type: "command", command: commandText(input ?? {}) ?? "command", output, cwd: isStr(input?.cwd) ? input.cwd : undefined };
  }
  const filePath = str(input ?? undefined, "file_path");
  if (filePath === undefined) return undefined;
  if (lower.includes("write")) return { type: "file_write", filePath, oldContent: "", newContent: isStr(input?.content) ? input.content : output };
  if (lower.includes("edit") || lower.includes("patch")) {
    return { type: "file_edit", filePath, diff: str(input!, "patch") ?? str(input!, "diff"), oldContent: str(input!, "old_str") ?? str(input!, "old_string"), newContent: str(input!, "new_str") ?? str(input!, "new_string") };
  }
  if (lower.includes("read")) return { type: "file_read", filePath, content: output };
  return undefined;
}

function toolOutput(name: string, input: Rec | null, content: unknown, cwd: string | undefined, fileExists: FileExists): Rec | undefined {
  const text = resultText(content);
  const structured = structuredOutput(name, text, input);
  if (structured) return structured;
  const out: Rec = {};
  if (text.length > 0) {
    try {
      out.output = JSON.parse(text);
    } catch {
      out.output = text;
    }
  }
  const files = input && !(isCommandName(name.toLowerCase(), ["bash", "shell", "terminal", "command"]) || hasCommand(input)) ? fileChanges(input, cwd, fileExists) : undefined;
  if (files?.length) out.files = files;
  return Object.keys(out).length > 0 ? out : undefined;
}

function subAgentDetail(input: Rec | null, answer: string): ToolCallDetail {
  const subAgentType = nonEmptyString(input?.name) ?? nonEmptyString(input?.subagent_type);
  const description = nonEmptyString(input?.description);
  return { type: "sub_agent", ...(subAgentType ? { subAgentType } : {}), ...(description ? { description } : {}), log: answer, actions: [] };
}

export function claudeToolCall(rawName: string, rawInput: unknown, result: ToolResultBlock | undefined, cwd: string | undefined, fileExists: FileExists = () => true): ToolCall {
  const input = typeof rawInput === "object" && rawInput !== null ? (rawInput as Rec) : null;
  const content = withoutImages(result?.content);
  const failed = result?.is_error === true;
  const status = !result ? "running" : failed ? "failed" : "completed";
  const name = rawName.trim();
  if (name === "ExitPlanMode" && isRecord(input) && isStr(input.plan)) return { detail: { type: "plan", text: input.plan }, status: failed ? "completed" : status };
  const output = result && !failed ? toolOutput(rawName, input, content, cwd, fileExists) : undefined;
  const detail = rawName === "Task" || rawName === "Agent" ? subAgentDetail(input, result && !failed ? resultText(content) : "") : deriveClaudeToolDetail(detailName(isSpeakToolName(name) ? "speak" : name), input, output ?? null);
  return failed ? { detail, status, toolError: { ...result, content } } : { detail, status };
}
