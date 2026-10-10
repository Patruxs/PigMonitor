const MESSAGE = /<message\s+([^>]*)>\r?\n?([\s\S]*?)<\/message>/g;
const ATTRIBUTE = /(\w+)="([^"]*)"/g;
const PIGGERY_LINE = /\[piggery\][^\n]*\n?/g;

export interface Mail {
  ref?: string;
  from?: string;
  reply?: string;
  redelivered?: boolean;
  body: string;
}

export function mailsIn(text: string): Mail[] {
  return [...text.matchAll(MESSAGE)].map((m) => {
    const attrs = Object.fromEntries([...m[1].matchAll(ATTRIBUTE)].map((a) => [a[1], a[2]]));
    return { ref: attrs.id, from: attrs.sender ?? attrs.from, reply: attrs.reply_to, ...(attrs.redelivered === "true" ? { redelivered: true } : {}), body: m[2].trim() };
  });
}

export function stripMails(text: string): string {
  return text.replace(MESSAGE, "").replace(PIGGERY_LINE, "").trim();
}

export function isWake(text: string): boolean {
  return /\[piggery\] wake #\d+/.test(text) || /^Another Claude session sent a message:/.test(text.trim());
}
