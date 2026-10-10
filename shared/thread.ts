// The mail the person exchanges with one session, as transcript items among the session's own.
// Pure, so `node --test` loads it as is.
import type { MailMessage } from "./mail.ts";
import type { Item } from "./transcript.ts";

export interface Me {
  id: string;
  name: string;
}

export const MAIL_BASE = 1_000_000_000;

/** Mail as transcript items: the person's as their bubbles with the send state, the session's as mail in. */
export function itemsOfThread(messages: MailMessage[], me: Me): Item[] {
  return messages.map((m) => {
    const ref = `#${m.seq}`;
    if (m.from === me.id) return { i: MAIL_BASE + m.seq, kind: "user", at: m.created_at, text: m.body, ref, note: m.held ? "Held" : m.acked_at ? "Read" : "Sent", run: "mail" };
    return { i: MAIL_BASE + m.seq, kind: "mail", at: m.created_at, text: m.body, from: m.from_name, ref, reply: m.reply_seq === undefined ? undefined : `#${m.reply_seq}`, run: "mail" };
  });
}

/** The newest mail `id` sent: what a reply answers. */
export function latestFrom(messages: MailMessage[], id: string): MailMessage | undefined {
  return messages.filter((m) => m.from === id).sort((a, b) => b.seq - a.seq)[0];
}

/** The session's items and the person's mail with it in time order; the session's own copy of the person's mail is left out. */
export function mergeItems(items: Item[], extra: Item[], hideFrom: string | undefined): Item[] {
  const own = hideFrom ? items.filter((it) => !(it.kind === "mail" && it.from === hideFrom)) : items;
  if (extra.length === 0) return own;
  const merged = [...own, ...extra];
  const order = new Map(merged.map((it, i) => [it, i]));
  return merged.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || (order.get(a) ?? 0) - (order.get(b) ?? 0));
}
