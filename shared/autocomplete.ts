import { compareMatchScores, scoreTextFields, type MatchScore } from "./match.ts";

export interface AgentSlashCommand {
  name: string;
  description: string;
  argumentHint: string;
  kind?: string;
}

export interface SlashCommandRange {
  start: number;
  end: number;
  query: string;
  position: "start" | "inline";
}

export interface FileMentionRange {
  start: number;
  end: number;
  query: string;
}

export function filterAndRankCommands<T extends { name: string; aliases?: readonly string[] }>(commands: readonly T[], query: string): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return [...commands];
  const scored: { command: T; score: MatchScore }[] = [];
  for (const command of commands) {
    const score = scoreTextFields(normalizedQuery, [command.name, ...(command.aliases ?? [])]);
    if (score) scored.push({ command, score });
  }
  scored.sort((a, b) => compareMatchScores(a.score, b.score) || a.command.name.localeCompare(b.command.name));
  return scored.map((entry) => entry.command);
}

export function inlineSkillCommands(commands: readonly AgentSlashCommand[]): AgentSlashCommand[] {
  return commands.filter((command) => command.kind === "skill");
}

const INVALID_SLASH_COMMAND_QUERY_CHARS = /[/\s\n\r\t"']/;

export function findActiveSlashCommand(text: string, cursorIndex: number): SlashCommandRange | null {
  const clampedCursor = Math.max(0, Math.min(cursorIndex, text.length));
  const beforeCursor = text.slice(0, clampedCursor);
  for (let slashIndex = beforeCursor.lastIndexOf("/"); slashIndex >= 0; slashIndex = slashIndex === 0 ? -1 : beforeCursor.lastIndexOf("/", slashIndex - 1)) {
    const previousCharacter = slashIndex > 0 ? text[slashIndex - 1] : "";
    if (previousCharacter && !/\s/.test(previousCharacter)) continue;
    const query = beforeCursor.slice(slashIndex + 1);
    if (INVALID_SLASH_COMMAND_QUERY_CHARS.test(query)) continue;
    return { start: slashIndex, end: clampedCursor, query, position: slashIndex === 0 ? "start" : "inline" };
  }
  return null;
}

export function applySlashCommandReplacement(text: string, command: SlashCommandRange, commandName: string): string {
  const replacement = `${text.slice(0, command.start)}/${commandName}${text.slice(command.end)}`;
  return command.end === text.length ? `${replacement} ` : replacement;
}

const INVALID_MENTION_QUERY_CHARS = /[\s\n\r\t"']/;

export function findActiveFileMention(text: string, cursorIndex: number): FileMentionRange | null {
  const clampedCursor = Math.max(0, Math.min(cursorIndex, text.length));
  const beforeCursor = text.slice(0, clampedCursor);
  for (let atIndex = beforeCursor.lastIndexOf("@"); atIndex >= 0; atIndex = atIndex === 0 ? -1 : beforeCursor.lastIndexOf("@", atIndex - 1)) {
    const query = beforeCursor.slice(atIndex + 1);
    if (INVALID_MENTION_QUERY_CHARS.test(query)) continue;
    return { start: atIndex, end: clampedCursor, query };
  }
  return null;
}

export function applyFileMentionReplacement(text: string, mention: FileMentionRange, relativePath: string): string {
  return `${text.slice(0, mention.start)}"${relativePath.replace(/"/g, '\\"')}"${text.slice(mention.end)}`;
}

export function orderAboveInput<T>(options: readonly T[]): T[] {
  return [...options].reverse();
}

export function fallbackIndex(itemCount: number): number {
  return itemCount <= 0 ? -1 : itemCount - 1;
}

export function nextActiveIndex(currentIndex: number, itemCount: number, key: "ArrowDown" | "ArrowUp"): number {
  if (itemCount <= 0) return -1;
  if (currentIndex < 0) return key === "ArrowDown" ? 0 : itemCount - 1;
  const normalizedCurrent = currentIndex % itemCount;
  return key === "ArrowDown" ? (normalizedCurrent + 1) % itemCount : (normalizedCurrent - 1 + itemCount) % itemCount;
}

export interface DirectoryEntry {
  path: string;
  kind: "file" | "directory";
}

export function directoryEntriesOf(payload: { entries?: { path: string; kind: string }[]; directories?: string[] }): DirectoryEntry[] {
  if (Array.isArray(payload.entries) && payload.entries.length > 0) {
    return payload.entries.flatMap((entry) => (entry && typeof entry.path === "string" && (entry.kind === "file" || entry.kind === "directory") ? [{ path: entry.path, kind: entry.kind }] : []));
  }
  return (payload.directories ?? []).map((path) => ({ path, kind: "directory" as const }));
}
