import { splitMarkdownBlocks } from "./markdown-parse.ts";
import type { AssistantMessageItem, StreamItem, UserMessageItem } from "../../shared/stream/stream.ts";

export function getStreamItemMessageId(item: StreamItem): string {
  return item.kind === "assistant_message" ? (item.blockGroupId ?? item.id) : item.id;
}

function retainItems(previous: StreamItem[], next: StreamItem[]): StreamItem[] {
  return previous.length === next.length && previous.every((item, index) => item === next[index]) ? previous : next;
}

function isReusableBlock(block: AssistantMessageItem, source: AssistantMessageItem, id: string): boolean {
  return block.id === id && block.turnId === source.turnId && block.timestamp.getTime() === source.timestamp.getTime() && block.timelineCursor?.epoch === source.timelineCursor?.epoch && block.timelineCursor?.seq === source.timelineCursor?.seq;
}

const SPOKEN_INPUT = /^\s*<spoken-input>([\s\S]*?)<\/spoken-input>(?:\s*<instruction>This message was spoken by the user\.[\s\S]*?<\/instruction>)?\s*$/;

export interface StreamPresentation {
  tail: StreamItem[];
  head: StreamItem[];
}

export function createStreamPresentation(): (input: { tail: StreamItem[]; head: StreamItem[] }) => StreamPresentation {
  const userMessageCache = new WeakMap<UserMessageItem, UserMessageItem>();
  const blocksBySource = new WeakMap<AssistantMessageItem, AssistantMessageItem[]>();
  let liveSources = new Map<string, AssistantMessageItem>();
  let historySource: StreamItem[] | undefined;
  let historyRows: StreamItem[] = [];
  let displayTail: StreamItem[] = [];
  let displayHistory: StreamItem[] | undefined;
  let promotedRows: StreamItem[] = [];

  function presentUserMessage(item: UserMessageItem): UserMessageItem {
    const cached = userMessageCache.get(item);
    if (cached) return cached;
    const spoken = SPOKEN_INPUT.exec(item.text);
    const projected = spoken ? { ...item, text: spoken[1].trim() } : item;
    userMessageCache.set(item, projected);
    return projected;
  }

  function nativeBlocks(item: StreamItem): StreamItem[] {
    if (item.kind === "user_message") return [presentUserMessage(item)];
    if (item.kind !== "assistant_message") return [item];
    const cached = blocksBySource.get(item);
    if (cached) return cached;
    const previousSource = liveSources.get(item.id);
    const previous = previousSource && blocksBySource.get(previousSource);
    const isAppend = previousSource && previous && item.text.startsWith(previousSource.text);
    let prefix: AssistantMessageItem[] = [];
    let growingText = item.text;
    if (isAppend) {
      prefix = previous.slice(0, -1);
      growingText = previous[previous.length - 1].text + item.text.slice(previousSource.text.length);
    }
    const parsed = splitMarkdownBlocks(growingText);
    const textBlocks = parsed.length > 0 || prefix.length > 0 ? parsed : [""];
    const blocks = [...prefix];
    textBlocks.forEach((text, offset) => {
      const index = prefix.length + offset;
      const blockText = offset === textBlocks.length - 1 ? text + (/\n\s*$/.exec(item.text)?.[0] ?? "") : text;
      const existing = previous?.[index];
      const id = `${item.id}:block:${index}`;
      if (existing?.text === blockText && isReusableBlock(existing, item, id)) {
        blocks.push(existing);
        return;
      }
      blocks.push({ ...item, id, blockGroupId: item.id, blockIndex: index, text: blockText });
    });
    blocksBySource.set(item, blocks);
    return blocks;
  }

  return (input) => {
    if (historySource !== input.tail) {
      historyRows = input.tail.flatMap(nativeBlocks);
      historySource = input.tail;
    }
    const head: StreamItem[] = [];
    const promoted: StreamItem[] = [];
    const nextLiveSources = new Map<string, AssistantMessageItem>();
    for (const item of input.head) {
      const blocks = nativeBlocks(item);
      if (item.kind === "assistant_message") nextLiveSources.set(item.id, item);
      if (item.kind === "assistant_message" && blocks.length > 1) {
        promoted.push(...blocks.slice(0, -1));
        head.push(blocks[blocks.length - 1]);
      } else head.push(...blocks);
    }
    liveSources = nextLiveSources;
    const nextPromoted = retainItems(promotedRows, promoted);
    if (displayHistory !== historyRows || nextPromoted !== promotedRows) {
      displayTail = nextPromoted.length > 0 ? [...historyRows, ...nextPromoted] : historyRows;
      displayHistory = historyRows;
      promotedRows = nextPromoted;
    }
    return { tail: displayTail, head };
  };
}
