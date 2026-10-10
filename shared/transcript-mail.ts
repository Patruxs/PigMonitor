import type { MailMessage } from "./mail.ts";
import type { Item, ShownItem } from "./transcript.ts";

function isShown(item: Item): item is ShownItem {
  return item.kind !== "delivery";
}

export function mergeMail(items: Item[], messages: MailMessage[], self: string, person: string | undefined): ShownItem[] {
  const mailItem = (m: MailMessage, at: number): ShownItem => {
    const ref = `#${m.seq}`;
    if (m.from === person) return { i: 0, kind: "user", at, text: m.body, ref, note: m.held ? "Held" : m.acked_at ? "Read" : "Sent", run: "mail" };
    return { i: 0, kind: "mail", at, text: m.body, from: m.from_name, ...(m.from === self ? { to: m.to_name, outgoing: true } : {}), ref, ...(m.reply_seq !== undefined ? { reply: `#${m.reply_seq}` } : {}), run: "mail" };
  };
  const byRef = new Map(messages.map((m) => [`#${m.seq}`, m]));
  const placed = new Set<string>();
  const own: Item[] = [];
  for (const item of items) {
    const found = item.ref ? byRef.get(item.ref) : undefined;
    if (item.kind === "mail" && item.ref) {
      if (placed.has(item.ref) || (found && item.redelivered)) continue;
      placed.add(item.ref);
      own.push(found ? mailItem(found, item.at ?? found.created_at) : item);
    } else if (item.kind === "tool" && item.ref && found && !placed.has(item.ref)) {
      placed.add(item.ref);
      own.push(mailItem(found, item.at ?? found.created_at));
    } else own.push(item);
  }
  const rest = messages.filter((m) => !placed.has(`#${m.seq}`)).sort((a, b) => a.created_at - b.created_at || a.seq - b.seq);
  const deliveries = own.flatMap((item, index) => (item.kind === "delivery" ? [index] : []));
  const delivered = new Map<number, MailMessage[]>();
  const loose: MailMessage[] = [];
  let first = 0;
  for (const m of rest) {
    const queued = m.to === self && !m.held;
    while (queued && first < deliveries.length && (own[deliveries[first]].at ?? Infinity) < m.created_at) first++;
    if (!queued || first === deliveries.length) loose.push(m);
    else delivered.set(deliveries[first], [...(delivered.get(deliveries[first]) ?? []), m]);
  }
  const out: ShownItem[] = [];
  let next = 0;
  const arrive = () => {
    const m = loose[next++];
    out.push(mailItem(m, m.created_at));
  };
  own.forEach((item, index) => {
    while (next < loose.length && item.at !== undefined && loose[next].created_at < item.at) arrive();
    if (isShown(item)) out.push(item);
    for (const m of delivered.get(index) ?? []) out.push(mailItem(m, item.at ?? m.created_at));
  });
  while (next < loose.length) arrive();
  return out;
}
