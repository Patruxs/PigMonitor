export type ItemKind = "session" | "user" | "wake" | "assistant" | "thinking" | "tool" | "mail" | "turn";

export interface Item {
  i: number;
  kind: ItemKind;
  at?: number;
  text: string;
  tool?: string;
  input?: string;
  result?: string;
  error?: boolean;
  from?: string;
  ref?: string;
  reply?: string;
  run?: string;
  note?: string;
}

export interface Transcript {
  items: Item[];
  total: number;
  name: string;
  role?: string;
  files: number;
  roles?: Record<string, string>;
}


interface Block {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  tool_name?: string;
  source?: { type?: string; media_type?: string; data?: string };
}

export type SaveImage = (data: string, mimeType: string) => string | undefined;

interface Entry {
  type?: string;
  subtype?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: { role?: string; content?: string | Block[] };
  model?: string;
  cwd?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  is_error?: boolean;
}

export function inputText(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input === "string") return input.trim();
  if (typeof input !== "object") return String(input);
  const o = input as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length === 0) return "";
  const main = ["command", "cmd", "prompt", "text", "query", "pattern", "file_path", "path", "description", "task", "to", "target"].find((k) => typeof o[k] === "string");
  const parts = keys.map((k) => {
    const v = o[k];
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return `${k}=${s}`;
  });
  const ordered = main ? [`${o[main] as string}`, ...parts.filter((p) => !p.startsWith(`${main}=`))] : parts;
  return ordered.join("\n").trim();
}

export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Block[])
    .map((b) => {
      if (b.type === "text") return b.text ?? "";
      if (b.type === "tool_reference") return `[tool ${b.tool_name ?? ""}]`;
      if (b.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export interface Mail {
  ref?: string;
  from?: string;
  reply?: string;
  at?: string;
  body: string;
}

export function mailsIn(text: string): Mail[] {
  const out: Mail[] = [];
  const re = /<message\s+([^>]*)>\r?\n?([\s\S]*?)<\/message>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const attrs: Record<string, string> = {};
    const ar = /(\w+)="([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(m[1])) !== null) attrs[a[1]] = a[2];
    out.push({ ref: attrs.id, from: attrs.sender ?? attrs.from, reply: attrs.reply_to, at: attrs.at, body: m[2].trim() });
  }
  return out;
}

export function isWake(text: string): boolean {
  return /\[piggery\] wake #\d+/.test(text) || /^Another Claude session sent a message:/.test(text.trim());
}

const stamp = (e: Entry): number | undefined => {
  if (!e.timestamp) return undefined;
  const t = Date.parse(e.timestamp);
  return Number.isNaN(t) ? undefined : t;
};

export class Parser {
  readonly items: Item[] = [];
  private open = new Map<string, Item>();
  private readonly run: string | undefined;
  private readonly saveImage: SaveImage | undefined;

  constructor(run?: string, saveImage?: SaveImage) {
    this.run = run;
    this.saveImage = saveImage;
  }

  private push(item: Omit<Item, "i">): Item {
    const full: Item = { ...item, i: this.items.length };
    if (this.run) full.run = this.run;
    this.items.push(full);
    return full;
  }

  line(raw: string): void {
    const s = raw.trim();
    if (!s) return;
    let e: Entry;
    try {
      e = JSON.parse(s) as Entry;
    } catch {
      return;
    }
    this.entry(e);
  }

  entry(e: Entry): void {
    if (e.isSidechain) return;
    const at = stamp(e);
    if (e.type === "system" && e.subtype === "init") {
      this.push({ kind: "session", at, text: [e.model, e.cwd].filter(Boolean).join(" · ") });
      return;
    }
    if (e.type === "result") {
      const bits: string[] = [];
      if (typeof e.num_turns === "number") bits.push(`${e.num_turns} turns`);
      if (typeof e.duration_ms === "number") bits.push(`${Math.round(e.duration_ms / 1000)}s`);
      if (typeof e.total_cost_usd === "number") bits.push(`$${e.total_cost_usd.toFixed(2)}`);
      this.push({ kind: "turn", at, text: bits.join(" · "), error: e.is_error === true });
      return;
    }
    if (e.type !== "user" && e.type !== "assistant") return;
    if (e.isMeta) return;
    const content = e.message?.content;
    if (content === undefined) return;
    if (e.type === "assistant") this.assistant(content, at);
    else this.user(content, at);
  }

  private assistant(content: string | Block[], at: number | undefined): void {
    if (typeof content === "string") {
      if (content.trim()) this.push({ kind: "assistant", at, text: content.trim() });
      return;
    }
    for (const b of content) {
      if (b.type === "text" && b.text?.trim()) this.push({ kind: "assistant", at, text: b.text.trim() });
      else if (b.type === "thinking" && b.thinking?.trim()) this.push({ kind: "thinking", at, text: b.thinking.trim() });
      else if (b.type === "tool_use") {
        const item = this.push({ kind: "tool", at, text: b.name ?? "tool", tool: b.name, input: inputText(b.input) });
        if (b.id) this.open.set(b.id, item);
      }
    }
  }

  private user(content: string | Block[], at: number | undefined): void {
    if (typeof content === "string") {
      this.userText(content, at);
      return;
    }
    const before = this.items.length;
    const images: Block[] = [];
    for (const b of content) {
      if (b.type === "text" && b.text) this.userText(b.text, at);
      else if (b.type === "image") images.push(b);
      else if (b.type === "tool_result" && b.tool_use_id) {
        const text = contentText(b.content);
        const item = this.open.get(b.tool_use_id);
        if (item) {
          item.result = text.trim();
          if (b.is_error) item.error = true;
          this.open.delete(b.tool_use_id);
        }
        this.mails(text, at);
      }
    }
    if (images.length === 0) return;
    const mark = this.imageLines(images);
    const last = this.items[this.items.length - 1];
    if (this.items.length > before && last.kind === "user") last.text = `${last.text}\n${mark}`;
    else this.push({ kind: "user", at, text: mark });
  }

  private imageLines(images: Block[]): string {
    const files = images.map((b) => (b.source?.type === "base64" && b.source.data && b.source.media_type ? this.saveImage?.(b.source.data, b.source.media_type) : undefined));
    if (files.every((f) => f !== undefined)) return files.map((f) => `[image: ${f}]`).join("\n");
    return images.length === 1 ? "[image]" : `[${images.length} images]`;
  }

  private userText(text: string, at: number | undefined): void {
    const t = text.trim();
    if (!t) return;
    const mails = mailsIn(t);
    if (mails.length > 0) {
      this.mails(t, at);
      const rest = t.replace(/<message\s+[^>]*>[\s\S]*?<\/message>/g, "").replace(/\[piggery\][^\n]*\n?/g, "").trim();
      if (rest && !isWake(rest)) this.push({ kind: "user", at, text: rest });
      return;
    }
    if (isWake(t)) {
      this.push({ kind: "wake", at, text: t.split("\n").find((l) => l.includes("[piggery]")) ?? t });
      return;
    }
    if (/^<system-reminder>/.test(t) || /^<local-command/.test(t)) return;
    this.push({ kind: "user", at, text: t });
  }

  private mails(text: string, at: number | undefined): void {
    for (const m of mailsIn(text)) this.push({ kind: "mail", at, text: m.body, from: m.from, ref: m.ref, reply: m.reply });
  }
}

export function parseLines(text: string, run?: string, saveImage?: SaveImage): Item[] {
  const p = new Parser(run, saveImage);
  for (const line of text.split("\n")) p.line(line);
  return p.items;
}
