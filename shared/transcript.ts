import type { Usage } from "./context-meter.ts";
import type { ToolCallDetail } from "./tool-call.ts";

export type ItemKind = "session" | "user" | "wake" | "assistant" | "thinking" | "tool" | "mail" | "turn" | "compaction" | "delivery";

export type ShownKind = Exclude<ItemKind, "delivery">;

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
  to?: string;
  ref?: string;
  reply?: string;
  redelivered?: boolean;
  run?: string;
  note?: string;
  detail?: ToolCallDetail;
  status?: ToolCallStatus;
  toolError?: unknown;
  durationMs?: number;
  costUsd?: number;
  trigger?: "auto" | "manual";
  preTokens?: number;
}

export type ToolCallStatus = "running" | "completed" | "failed" | "canceled";

export interface ToolCall {
  detail: ToolCallDetail;
  status: ToolCallStatus;
  toolError?: unknown;
}

export type ShownItem = Item & { kind: ShownKind };

export interface Transcript {
  items: ShownItem[];
  total: number;
  name: string;
  role?: string;
  files: number;
  roles?: Record<string, string>;
  usage?: Usage;
  epoch?: string;
  rev?: number;
  from?: number;
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

export type ToolResultBlock = Block;

export type DescribeTool = (name: string, input: unknown, result: ToolResultBlock | undefined, cwd: string | undefined) => ToolCall;

interface TokenUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

interface Entry {
  type?: string;
  subtype?: string;
  state?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isSynthetic?: boolean;
  isCompactSummary?: boolean;
  compact_metadata?: { trigger?: string; pre_tokens?: number };
  parent_tool_use_id?: string | null;
  message?: { role?: string; content?: string | Block[]; model?: string; usage?: TokenUsage };
  model?: string;
  cwd?: string;
  session_id?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  is_error?: boolean;
  modelUsage?: Record<string, { contextWindow?: number }>;
}

export interface ContextReading {
  used?: { tokens: number; model?: string };
  windows: Record<string, number>;
}

const count = (n: number | undefined): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

export function tokensInContext(usage: TokenUsage): number {
  return count(usage.input_tokens) + count(usage.cache_creation_input_tokens) + count(usage.cache_read_input_tokens) + count(usage.output_tokens);
}

export function usageOf(reading: ContextReading): Usage | undefined {
  if (!reading.used) return undefined;
  const max = reading.used.model ? reading.windows[reading.used.model] : undefined;
  return { contextWindowUsedTokens: reading.used.tokens, ...(max ? { contextWindowMaxTokens: max } : {}) };
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
  redelivered?: boolean;
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
    out.push({ ref: attrs.id, from: attrs.sender ?? attrs.from, reply: attrs.reply_to, at: attrs.at, ...(attrs.redelivered === "true" ? { redelivered: true } : {}), body: m[2].trim() });
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
  readonly context: ContextReading = { windows: {} };
  readonly changed = new Set<number>();
  private readonly untimed = new Set<number>();
  private open = new Map<string, { item: Item; name: string; input: unknown }>();
  private readonly run: string | undefined;
  private readonly saveImage: SaveImage | undefined;
  private readonly describe: DescribeTool | undefined;
  private cwd: string | undefined;
  private spent = 0;
  private began: string | undefined;

  constructor(run?: string, saveImage?: SaveImage, describe?: DescribeTool) {
    this.run = run;
    this.saveImage = saveImage;
    this.describe = describe;
  }

  private push(item: Omit<Item, "i">): Item {
    const full: Item = { ...item, i: this.items.length };
    if (this.run) full.run = this.run;
    this.items.push(full);
    this.changed.add(full.i);
    if (full.at === undefined) this.untimed.add(full.i);
    return full;
  }

  stamp(): void {
    const had = new Map<number, number | undefined>();
    for (const i of this.untimed) {
      had.set(i, this.items[i].at);
      this.items[i].at = undefined;
    }
    stampUntimed(this.items);
    for (const [i, at] of had) if (this.items[i].at !== at) this.changed.add(i);
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
    if (!this.cwd && e.cwd) this.cwd = e.cwd;
    this.measure(e);
    const at = stamp(e);
    if (e.type === "system" && e.subtype === "init") {
      const began = [e.session_id, e.model, e.cwd].join("\n");
      if (began === this.began) return;
      this.began = began;
      this.push({ kind: "session", at, text: [e.model, e.cwd].filter(Boolean).join(" · ") });
      return;
    }
    if (e.type === "command_lifecycle" && e.state === "started") {
      this.push({ kind: "delivery", at, text: "" });
      return;
    }
    if (e.type === "system" && e.subtype === "compact_boundary") {
      const pre = e.compact_metadata?.pre_tokens;
      this.push({ kind: "compaction", at, text: "", trigger: e.compact_metadata?.trigger === "manual" ? "manual" : "auto", ...(typeof pre === "number" ? { preTokens: pre } : {}) });
      return;
    }
    if (e.type === "result") {
      let cost: number | undefined;
      if (typeof e.total_cost_usd === "number") {
        cost = e.total_cost_usd >= this.spent ? e.total_cost_usd - this.spent : e.total_cost_usd;
        this.spent = e.total_cost_usd;
      }
      const bits: string[] = [];
      if (typeof e.num_turns === "number") bits.push(`${e.num_turns} turns`);
      if (typeof e.duration_ms === "number") bits.push(`${Math.round(e.duration_ms / 1000)}s`);
      if (cost !== undefined) bits.push(`$${cost.toFixed(2)}`);
      this.push({ kind: "turn", at, text: bits.join(" · "), error: e.is_error === true, ...(typeof e.duration_ms === "number" ? { durationMs: e.duration_ms } : {}), ...(cost !== undefined ? { costUsd: cost } : {}) });
      return;
    }
    if (e.type !== "user" && e.type !== "assistant") return;
    if (e.isMeta || e.isCompactSummary) return;
    const content = e.message?.content;
    if (content === undefined) return;
    if (e.type === "assistant") this.assistant(content, at);
    else this.user(content, at, e.isSynthetic === true);
  }

  private measure(e: Entry): void {
    if (e.type === "assistant" && !e.parent_tool_use_id && e.message?.usage) this.context.used = { tokens: tokensInContext(e.message.usage), model: e.message.model };
    if (e.type === "result" && e.modelUsage) {
      for (const [model, use] of Object.entries(e.modelUsage)) if (typeof use?.contextWindow === "number" && use.contextWindow > 0) this.context.windows[model] = use.contextWindow;
    }
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
        const name = b.name ?? "tool";
        const item = this.push({ kind: "tool", at, text: name, tool: b.name, ...(this.describe ? this.describe(name, b.input, undefined, this.cwd) : { input: inputText(b.input) }) });
        if (b.id) this.open.set(b.id, { item, name, input: b.input });
      }
    }
  }

  private user(content: string | Block[], at: number | undefined, synthetic: boolean): void {
    if (typeof content === "string") {
      if (!synthetic) this.userText(content, at);
      return;
    }
    const before = this.items.length;
    const images: Block[] = [];
    for (const b of content) {
      if (b.type === "text" && b.text) {
        if (!synthetic) this.userText(b.text, at);
      } else if (b.type === "image") images.push(b);
      else if (b.type === "tool_result" && b.tool_use_id) {
        const text = contentText(b.content);
        const call = this.open.get(b.tool_use_id);
        if (call) {
          const { item } = call;
          this.changed.add(item.i);
          if (b.is_error) item.error = true;
          if (this.describe) Object.assign(item, this.describe(call.name, call.input, b, this.cwd));
          else item.result = text.trim();
          const sent = !b.is_error && call.name.endsWith("__send") ? /^sent (#\d+)$/.exec(text.trim()) : null;
          if (sent) item.ref = sent[1];
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
    for (const m of mailsIn(text)) this.push({ kind: "mail", at, text: m.body, from: m.from, ref: m.ref, reply: m.reply, ...(m.redelivered ? { redelivered: true } : {}) });
  }
}

function stampUntimed(items: Item[]): Item[] {
  const timed = items.map((item) => item.at);
  let next: number | undefined;
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (timed[index] !== undefined) next = timed[index];
    else if (item.kind === "session" || item.kind === "delivery") item.at = next;
  }
  let last = timed.find((at) => at !== undefined);
  for (const item of items) {
    if (item.at === undefined) item.at = last;
    else last = item.at;
  }
  return items;
}

export function parseLog(text: string, run?: string, saveImage?: SaveImage, describe?: DescribeTool): { items: Item[]; context: ContextReading } {
  const p = new Parser(run, saveImage, describe);
  for (const line of text.split("\n")) p.line(line);
  return { items: stampUntimed(p.items), context: p.context };
}

export function parseLines(text: string, run?: string, saveImage?: SaveImage, describe?: DescribeTool): Item[] {
  return parseLog(text, run, saveImage, describe).items;
}

export function withIncrement(had: ShownItem[], next: { items: ShownItem[]; from?: number }, limit: number): ShownItem[] {
  if (next.from === undefined) return next.items;
  const from = next.from;
  if (next.items.length === 0 && (had[had.length - 1]?.i ?? -1) < from) return had;
  const merged = [...had.filter((item) => item.i < from), ...next.items];
  return merged.slice(Math.max(0, merged.length - limit));
}
