const MARKDOWN_BLOCK_TAGS = ["p", "pre", "li", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6"];

export const MARKDOWN_BLOCK_SELECTOR = MARKDOWN_BLOCK_TAGS.map((tag) => `[data-paseo-markdown-tag="${tag}"]`).join(",");
export const FIND_IGNORED_SELECTOR = '[data-paseo-markdown-ignore="true"], [aria-hidden="true"], button, [role="button"], svg, script, style';

function dataSet(values: Record<string, string>): object {
  return { dataSet: values };
}

export const messageTextProps = dataSet({ messageText: "true" });
export const findWidgetProps = dataSet({ chatFindWidget: "true" });

export function markdownTagProps(tag: string): object {
  return dataSet({ paseoMarkdownTag: tag });
}

export function historyRowAttributes(rowId: string, messageId: string): { "data-history-row-id": string; "data-message-id": string } {
  return { "data-history-row-id": rowId, "data-message-id": messageId };
}

export function messageRows(root: ParentNode | null | undefined, messageId: string): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)) : [];
}

export function messageTextBlocks(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll<HTMLElement>('[data-message-text="true"]'));
}

export function historyRows(content: ParentNode): { id: string; element: HTMLElement }[] {
  return Array.from(content.querySelectorAll<HTMLElement>("[data-history-row-id]"), (element) => ({ id: element.dataset.historyRowId ?? "", element }));
}

export function historyRowOf(node: Node): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  return element?.closest<HTMLElement>("[data-history-row-id]") ?? null;
}

export function findWidgetIn(root: ParentNode | null | undefined): HTMLElement | null {
  return root?.querySelector<HTMLElement>('[data-chat-find-widget="true"]') ?? null;
}
