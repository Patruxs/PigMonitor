import { markedImage } from "./attach.ts";

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "italic"; children: Inline[] }
  | { kind: "strike"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "image"; path: string; alt: string };

export type Block =
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "heading"; level: number; inlines: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; items: Block[][] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "rule" }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] };

const IMAGE_PATH = /^\/[^\s`"'<>()[\]]*\.(?:png|jpe?g|gif|webp)$/i;
const BARE_IMAGE_PATH = /^\/[^\s`"'<>()[\]]*?\.(?:png|jpe?g|gif|webp)(?=$|[\s.,;:!?)\]"'])/i;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:\s+(.*))?$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

export function isImagePath(text: string): boolean {
  return IMAGE_PATH.test(text);
}

export interface ParseOptions {
  linkify?: boolean;
  streaming?: boolean;
}

let options: ParseOptions = {};

export function parseMarkdown(source: string, with_: ParseOptions = {}): Block[] {
  const previous = options;
  options = with_;
  try {
    const blocks = parseBlocks(source.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"));
    return with_.streaming ? streamTail(blocks) : blocks;
  } finally {
    options = previous;
  }
}

function streamTail(blocks: Block[]): Block[] {
  const last = blocks[blocks.length - 1];
  if (!last) return blocks;
  const head = blocks.slice(0, -1);
  if (last.kind === "paragraph" || last.kind === "heading") return [...head, { ...last, inlines: reparseTail(last.inlines) }];
  if (last.kind === "list" && last.items.length > 0) return [...head, { ...last, items: [...last.items.slice(0, -1), streamTail(last.items[last.items.length - 1])] }];
  if (last.kind === "quote") return [...head, { ...last, blocks: streamTail(last.blocks) }];
  return blocks;
}

const rawOf = new WeakMap<Inline[], string>();

function reparseTail(inlines: Inline[]): Inline[] {
  const raw = rawOf.get(inlines);
  return raw === undefined ? inlines : parseInline(raw, true);
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function blank(line: string): boolean {
  return line.trim() === "";
}

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line);
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at];
    if (blank(line)) {
      at++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const closing = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
      const indent = indentOf(line);
      const body: string[] = [];
      at++;
      while (at < lines.length && !closing.test(lines[at])) {
        body.push(lines[at].slice(Math.min(indent, indentOf(lines[at]))));
        at++;
      }
      at++;
      blocks.push({ kind: "code", lang: fence[2], text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, inlines: parseInline(heading[2]) });
      at++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      at++;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (at < lines.length && !blank(lines[at])) {
        const inner = QUOTE.exec(lines[at]);
        quoted.push(inner ? inner[1] : lines[at]);
        at++;
      }
      blocks.push({ kind: "quote", blocks: parseBlocks(quoted) });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      at = parseList(lines, at, blocks);
      continue;
    }
    if (line.includes("|") && at + 1 < lines.length && TABLE_DIVIDER.test(lines[at + 1]) && lines[at + 1].includes("-")) {
      const head = cellsOf(line);
      at += 2;
      const rows: Inline[][][] = [];
      while (at < lines.length && !blank(lines[at]) && lines[at].includes("|")) {
        rows.push(cellsOf(lines[at]));
        at++;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    const paragraph: string[] = [line.trim()];
    at++;
    while (at < lines.length && !blank(lines[at]) && !startsBlock(lines[at])) {
      paragraph.push(lines[at].trim());
      at++;
    }
    blocks.push({ kind: "paragraph", inlines: parseInline(paragraph.join("\n")) });
  }
  return blocks;
}

function cellsOf(line: string): Inline[][] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => parseInline(cell.trim().replace(/\\\|/g, "|")));
}

function parseList(lines: string[], from: number, blocks: Block[]): number {
  const first = LIST_ITEM.exec(lines[from]) as RegExpExecArray;
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: string[][] = [];
  let current: string[] = [];
  let contentIndent = 0;
  let afterBlank = false;
  let at = from;
  while (at < lines.length) {
    const line = lines[at];
    const marker = LIST_ITEM.exec(line);
    if (marker && marker[1].length <= baseIndent) {
      if (/\d/.test(marker[2]) !== ordered || RULE.test(line)) break;
      current = [marker[3] ?? ""];
      items.push(current);
      contentIndent = marker[1].length + marker[2].length + 1;
      afterBlank = false;
      at++;
      continue;
    }
    if (blank(line)) {
      afterBlank = true;
      current.push("");
      at++;
      continue;
    }
    const indent = indentOf(line);
    if (indent > baseIndent) {
      current.push(line.slice(Math.min(indent, contentIndent)));
    } else if (!afterBlank && !startsBlock(line)) {
      current.push(line.trim());
    } else break;
    afterBlank = false;
    at++;
  }
  blocks.push({ kind: "list", ordered, start: ordered ? Number.parseInt(first[2], 10) : 1, items: items.map(parseBlocks) });
  return at;
}

type Match = { node: Inline; length: number };

const WORD = /[\p{L}\p{N}]/u;

const SPECIAL = new Set(["\\", "`", "!", "[", "*", "_", "/", "~"]);

function closingOf(source: string, marker: string, from: number): number {
  let at = source.indexOf(marker, from);
  while (at !== -1) {
    while (marker.length === 2 && source[at + 2] === marker[0]) at++;
    const doubled = marker.length === 1 && (source[at - 1] === marker || source[at + 1] === marker);
    if (!doubled && !/\s/.test(source[at - 1] ?? "") && (marker[0] !== "_" || !WORD.test(source[at + marker.length] ?? ""))) return at;
    at = source.indexOf(marker, at + 1);
  }
  return -1;
}

function matchEmphasis(rest: string, previous: string): Match | undefined {
  const marker = rest.startsWith("**") || rest.startsWith("__") ? rest.slice(0, 2) : rest[0];
  if (marker[0] === "_" && WORD.test(previous)) return undefined;
  if (/\s/.test(rest[marker.length] ?? " ")) return undefined;
  const end = closingOf(rest, marker, marker.length + 1);
  if (end === -1) return undefined;
  const children = parseInline(rest.slice(marker.length, end));
  return { node: marker.length === 2 ? { kind: "bold", children } : { kind: "italic", children }, length: end + marker.length };
}

function matchInline(rest: string, previous: string): Match | undefined {
  const head = rest[0];
  if (head === "\\" && /[\\`*_[\]()#+\-.!>~|]/.test(rest[1] ?? "")) return { node: { kind: "text", text: rest[1] }, length: 2 };
  if (head === "`") {
    const ticks = /^`+/.exec(rest)![0];
    const end = rest.indexOf(ticks, ticks.length);
    if (end === -1) return { node: { kind: "text", text: ticks }, length: ticks.length };
    const code = rest.slice(ticks.length, end).replace(/^ (.*) $/s, "$1");
    return { node: isImagePath(code.trim()) ? { kind: "image", path: code.trim(), alt: "" } : { kind: "code", text: code }, length: end + ticks.length };
  }
  if (head === "!") {
    const image = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(rest);
    if (image) return { node: isImagePath(image[2]) ? { kind: "image", path: image[2], alt: image[1] } : { kind: "link", href: image[2], children: [{ kind: "text", text: image[1] || image[2] }] }, length: image[0].length };
  }
  if (head === "[") {
    const attached = markedImage(rest);
    if (attached) return { node: { kind: "image", path: attached.path, alt: "" }, length: attached.length };
    const link = /^\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(rest);
    if (link) return { node: isImagePath(link[2]) && link[1] === link[2] ? { kind: "image", path: link[2], alt: "" } : { kind: "link", href: link[2], children: parseInline(link[1]) }, length: link[0].length };
  }
  if (head === "*" || head === "_") return matchEmphasis(rest, previous);
  if (head === "~" && rest.startsWith("~~") && !/\s/.test(rest[2] ?? " ")) {
    const end = rest.indexOf("~~", 3);
    if (end !== -1 && !/\s/.test(rest[end - 1])) return { node: { kind: "strike", children: parseInline(rest.slice(2, end)) }, length: end + 2 };
  }
  if (head === "/" && (previous === "" || /[\s(["']/.test(previous))) {
    const path = BARE_IMAGE_PATH.exec(rest);
    if (path) return { node: { kind: "image", path: path[0], alt: "" }, length: path[0].length };
  }
  return undefined;
}

const URL_START = /^(?:https?:\/\/|www\.)[^\s<]+/i;

function matchUrl(rest: string, previous: string): Match | undefined {
  if (previous && /[\p{L}\p{N}_/]/u.test(previous)) return undefined;
  const found = URL_START.exec(rest);
  if (!found) return undefined;
  let url = found[0];
  while (/[.,;:!?'"*_~]$/.test(url) || (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0))) url = url.slice(0, -1);
  if (url.length < 5) return undefined;
  return { node: { kind: "link", href: /^www\./i.test(url) ? `http://${url}` : url, children: [{ kind: "text", text: url }] }, length: url.length };
}

let streamingTail = false;

function matchStreaming(rest: string, previous: string): Match | undefined {
  const head = rest[0];
  if (head === "`") {
    const ticks = /^`+/.exec(rest)![0];
    let content = rest.slice(ticks.length);
    const partial = /`+$/.exec(content);
    if (partial && partial[0].length < ticks.length) content = content.slice(0, -partial[0].length);
    return content ? { node: { kind: "code", text: content.replace(/\n/g, " ").replace(/^ (.+) $/, "$1") }, length: rest.length } : { node: { kind: "text", text: "" }, length: rest.length };
  }
  if (/^(?:\*{1,3}|_{1,3}|~{1,2})$/.test(rest)) return { node: { kind: "text", text: "" }, length: rest.length };
  if (head === "*" || head === "_" || head === "~") {
    const marker = /^(\*{1,3}|_{1,3}|~~)/.exec(rest)?.[1];
    if (!marker || /\s/.test(rest[marker.length] ?? " ") || (head === "_" && WORD.test(previous))) return undefined;
    const children = parseInline(rest.slice(marker.length), true);
    const node: Inline = head === "~" ? { kind: "strike", children } : marker.length === 1 ? { kind: "italic", children } : marker.length === 2 ? { kind: "bold", children } : { kind: "bold", children: [{ kind: "italic", children }] };
    return { node, length: rest.length };
  }
  if (head === "[" || (head === "!" && rest[1] === "[")) {
    const start = head === "!" ? 1 : 0;
    const label = /^\[([^\]\n]*)(\](?:\([^)]*)?)?$/.exec(rest.slice(start));
    if (label) return { node: { kind: "text", text: label[1] }, length: rest.length };
  }
  return undefined;
}

export function parseInline(source: string, tail = false): Inline[] {
  const outer = streamingTail;
  streamingTail = tail;
  try {
    const parsed = parseInlineRun(source);
    if (!tail) rawOf.set(parsed, source);
    return parsed;
  } finally {
    streamingTail = outer;
  }
}

function parseInlineRun(source: string): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  let at = 0;
  while (at < source.length) {
    const rest = source.slice(at);
    const previous = source[at - 1] ?? "";
    let match = SPECIAL.has(source[at]) ? matchInline(rest, previous) : undefined;
    if (match?.node.kind === "text" && streamingTail && source[at] === "`") match = undefined;
    if (!match && options.linkify && (source[at] === "h" || source[at] === "H" || source[at] === "w" || source[at] === "W")) match = matchUrl(rest, previous);
    if (!match && streamingTail && SPECIAL.has(source[at])) match = matchStreaming(rest, previous);
    if (!match) {
      plain += source[at];
      at++;
      continue;
    }
    if (match.node.kind === "text") {
      plain += match.node.text;
    } else {
      if (plain) out.push({ kind: "text", text: plain });
      plain = "";
      out.push(match.node);
    }
    at += match.length;
  }
  if (plain) out.push({ kind: "text", text: plain });
  return out;
}

export function imagesIn(inlines: Inline[]): string[] {
  return inlines.flatMap((node) => (node.kind === "image" ? [node.path] : node.kind === "bold" || node.kind === "italic" || node.kind === "strike" || node.kind === "link" ? imagesIn(node.children) : []));
}

export function hasImages(blocks: Block[]): boolean {
  return blocks.some((block) => {
    if (block.kind === "paragraph" || block.kind === "heading") return imagesIn(block.inlines).length > 0;
    if (block.kind === "list") return block.items.some(hasImages);
    if (block.kind === "quote") return hasImages(block.blocks);
    return false;
  });
}

function fenceEnd(lines: string[], from: number): number {
  const fence = FENCE.exec(lines[from]) as RegExpExecArray;
  const closing = new RegExp(`^ {0,3}${fence[1][0] === "`" ? "`" : "~"}{${fence[1].length},}\\s*$`);
  for (let at = from + 1; at < lines.length; at++) if (closing.test(lines[at])) return at + 1;
  return lines.length;
}

function nextFilled(lines: string[], from: number): number {
  let at = from;
  while (at < lines.length && blank(lines[at])) at++;
  return at;
}

function indentedCodeEnd(lines: string[], from: number): number {
  let end = from + 1;
  let at = from + 1;
  while (at < lines.length) {
    const next = nextFilled(lines, at);
    if (next >= lines.length || indentOf(lines[next]) < 4) break;
    end = next + 1;
    at = next + 1;
  }
  return end;
}

function listEnd(lines: string[], from: number): number {
  const first = LIST_ITEM.exec(lines[from]) as RegExpExecArray;
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const continues = (line: string) => {
    const marker = LIST_ITEM.exec(line);
    if (marker && marker[1].length <= baseIndent) return /\d/.test(marker[2]) === ordered && !RULE.test(line);
    return indentOf(line) > baseIndent;
  };
  let end = from + 1;
  let at = from + 1;
  while (at < lines.length) {
    if (blank(lines[at])) {
      const next = nextFilled(lines, at);
      if (next >= lines.length || !continues(lines[next])) break;
      end = next + 1;
      at = next + 1;
      continue;
    }
    if (!continues(lines[at]) && startsBlock(lines[at])) break;
    end = at + 1;
    at++;
  }
  return end;
}

function structuralBlankLines(lines: string[]): Set<number> {
  const out = new Set<number>();
  let at = 0;
  while (at < lines.length) {
    const line = lines[at];
    if (blank(line)) {
      at++;
      continue;
    }
    let end = at + 1;
    if (FENCE.test(line)) end = fenceEnd(lines, at);
    else if (indentOf(line) >= 4) end = indentedCodeEnd(lines, at);
    else if (LIST_ITEM.test(line)) end = listEnd(lines, at);
    else {
      while (end < lines.length && !blank(lines[end]) && !startsBlock(lines[end])) end++;
    }
    for (let index = at; index < end - 1; index++) if (blank(lines[index])) out.add(index);
    at = end;
  }
  return out;
}

export function splitMarkdownBlocks(text: string): string[] {
  if (text.length === 0) return [];
  const blocks: string[] = [];
  let current: string[] = [];
  let sawSeparator = false;
  const lines = text.split("\n");
  const structural = structuralBlankLines(lines);
  lines.forEach((line, index) => {
    const isBlank = line.trim().length === 0;
    if (isBlank && structural.has(index)) {
      current.push(line);
      return;
    }
    if (isBlank) {
      if (current.length > 0) sawSeparator = true;
      return;
    }
    if (sawSeparator) {
      blocks.push(current.join("\n"));
      current = [];
      sawSeparator = false;
    }
    current.push(line);
  });
  if (current.length > 0) blocks.push(current.join("\n"));
  return foldLinkReferenceDefinitions(blocks.filter((block) => block.length > 0));
}

const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*\S+(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/;

function isLinkReferenceDefinitionBlock(block: string): boolean {
  const lines = block.split("\n").filter((line) => line.trim().length > 0);
  return lines.length > 0 && lines.every((line) => REFERENCE_DEFINITION.test(line));
}

function foldLinkReferenceDefinitions(blocks: string[]): string[] {
  const folded: string[] = [];
  let leading: string[] = [];
  for (const block of blocks) {
    if (isLinkReferenceDefinitionBlock(block)) {
      if (folded.length > 0) folded[folded.length - 1] += `\n\n${block}`;
      else leading.push(block);
      continue;
    }
    folded.push([...leading, block].join("\n\n"));
    leading = [];
  }
  if (leading.length > 0) folded.push(leading.join("\n\n"));
  return folded;
}
