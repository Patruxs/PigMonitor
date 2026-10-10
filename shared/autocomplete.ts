export interface MatchScore {
  tier: number;
  offset: number;
  spread?: number;
}

const TIER_EXACT = 0;
const TIER_WHOLE_WORD = 1;
const TIER_PREFIX = 2;
const TIER_WORD_START = 3;
const TIER_SUBSTRING = 4;
const TIER_SUBSEQUENCE = 5;

function isWordBoundaryChar(ch: string | undefined): boolean {
  if (ch === undefined) return true;
  return !/[a-z0-9]/.test(ch);
}

function scoreSubstringMatch(query: string, text: string): MatchScore | null {
  let best: MatchScore | null = null;
  let pos = 0;
  while (pos <= text.length - query.length) {
    const found = text.indexOf(query, pos);
    if (found === -1) break;
    const before = found > 0 ? text[found - 1] : undefined;
    const after = text[found + query.length];
    const startsAtBoundary = found === 0 || isWordBoundaryChar(before);
    const endsAtBoundary = after === undefined || isWordBoundaryChar(after);
    let tier: number;
    if (startsAtBoundary && endsAtBoundary) tier = TIER_WHOLE_WORD;
    else if (found === 0) tier = TIER_PREFIX;
    else if (startsAtBoundary) tier = TIER_WORD_START;
    else tier = TIER_SUBSTRING;
    if (!best || tier < best.tier || (tier === best.tier && found < best.offset)) best = { tier, offset: found };
    pos = found + 1;
  }
  return best;
}

function scoreSubsequenceMatch(query: string, text: string): MatchScore | null {
  let queryIndex = 0;
  let firstIndex = -1;
  let lastIndex = -1;
  for (let textIndex = 0; textIndex < text.length && queryIndex < query.length; textIndex += 1) {
    if (/\s/u.test(text[textIndex])) {
      queryIndex = 0;
      firstIndex = -1;
      lastIndex = -1;
      continue;
    }
    if (text[textIndex] !== query[queryIndex]) continue;
    if (firstIndex === -1) firstIndex = textIndex;
    lastIndex = textIndex;
    queryIndex += 1;
  }
  if (queryIndex !== query.length || firstIndex === -1) return null;
  return { tier: TIER_SUBSEQUENCE, offset: firstIndex, spread: lastIndex - firstIndex + 1 };
}

function scoreMatch(query: string, text: string): MatchScore | null {
  if (!query) return { tier: TIER_EXACT, offset: 0 };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return { tier: TIER_EXACT, offset: 0 };
  return scoreSubstringMatch(q, t) ?? scoreSubsequenceMatch(q, t);
}

export function compareMatchScores(a: MatchScore, b: MatchScore): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.offset !== b.offset) return a.offset - b.offset;
  return (a.spread ?? 0) - (b.spread ?? 0);
}

function tokenizeQuery(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

export function scoreTextFields(query: string, fields: string[]): MatchScore | null {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return { tier: TIER_EXACT, offset: 0, spread: 0 };
  const aggregate: MatchScore = { tier: TIER_EXACT, offset: 0, spread: 0 };
  for (const token of tokens) {
    let best: MatchScore | null = null;
    for (const field of fields) {
      const score = scoreMatch(token, field);
      if (score && (!best || compareMatchScores(score, best) < 0)) best = score;
    }
    if (!best) return null;
    aggregate.tier += best.tier;
    aggregate.offset += best.offset;
    aggregate.spread = (aggregate.spread ?? 0) + (best.spread ?? token.length);
  }
  return aggregate;
}

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
