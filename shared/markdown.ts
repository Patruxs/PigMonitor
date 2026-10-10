export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "italic"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "image"; path: string; alt: string };

export type Block =
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "heading"; level: number; inlines: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; items: Block[][] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "rule" };

const IMAGE_PATH = /^\/[^\s`"'<>()[\]]*\.(?:png|jpe?g|gif|webp)$/i;
const BARE_IMAGE_PATH = /^\/[^\s`"'<>()[\]]*?\.(?:png|jpe?g|gif|webp)(?=$|[\s.,;:!?)\]"'])/i;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:\s+(.*))?$/;

export function isImagePath(text: string): boolean {
  return IMAGE_PATH.test(text);
}

export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"));
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

const SPECIAL = new Set(["\\", "`", "!", "[", "*", "_", "/"]);

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
    const attached = /^\[image: ([^\]\n]+)\]/.exec(rest);
    if (attached && isImagePath(attached[1].trim())) return { node: { kind: "image", path: attached[1].trim(), alt: "" }, length: attached[0].length };
    const link = /^\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(rest);
    if (link) return { node: isImagePath(link[2]) && link[1] === link[2] ? { kind: "image", path: link[2], alt: "" } : { kind: "link", href: link[2], children: parseInline(link[1]) }, length: link[0].length };
  }
  if (head === "*" || head === "_") return matchEmphasis(rest, previous);
  if (head === "/" && (previous === "" || /[\s(["']/.test(previous))) {
    const path = BARE_IMAGE_PATH.exec(rest);
    if (path) return { node: { kind: "image", path: path[0], alt: "" }, length: path[0].length };
  }
  return undefined;
}

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  let at = 0;
  while (at < source.length) {
    const match = SPECIAL.has(source[at]) ? matchInline(source.slice(at), source[at - 1] ?? "") : undefined;
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
  return inlines.flatMap((node) => (node.kind === "image" ? [node.path] : node.kind === "bold" || node.kind === "italic" || node.kind === "link" ? imagesIn(node.children) : []));
}

export function hasImages(blocks: Block[]): boolean {
  return blocks.some((block) => {
    if (block.kind === "paragraph" || block.kind === "heading") return imagesIn(block.inlines).length > 0;
    if (block.kind === "list") return block.items.some(hasImages);
    if (block.kind === "quote") return hasImages(block.blocks);
    return false;
  });
}
