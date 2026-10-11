import { z } from "zod";

const LoggedEvents = z.object({ events: z.array(z.object({ ts: z.number(), type: z.string() }).passthrough()) }).passthrough();

export type LoggedEvent = { ts: number; type: string };

type ViewEvent = { time?: unknown; type?: unknown; who?: unknown; target?: unknown; at?: number };

export function loggedEventsOf(out: string): LoggedEvent[] | null {
  try {
    const doc = LoggedEvents.safeParse(JSON.parse(out));
    return doc.success ? doc.data.events : null;
  } catch {
    return null;
  }
}

function wallClock(ms: number): string {
  const t = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(t.getHours())}:${two(t.getMinutes())}:${two(t.getSeconds())}`;
}

function sameClock(ms: number, time: string): boolean {
  const clock = wallClock(ms);
  return clock === time || clock.slice(0, 5) === time;
}

function keyOf(event: ViewEvent): string {
  return [event.time, event.type, event.who, event.target ?? ""].map(String).join("|");
}

export class EventTimes {
  private known = new Map<string, number | null>();
  private readonly readLog: () => Promise<LoggedEvent[] | null>;

  constructor(readLog: () => Promise<LoggedEvent[] | null>) {
    this.readLog = readLog;
  }

  async stamp(doc: Record<string, unknown>): Promise<void> {
    const events = Array.isArray(doc.events) ? (doc.events as ViewEvent[]) : [];
    const keys = events.map(keyOf);
    if (keys.some((key) => !this.known.has(key))) {
      const logged = await this.readLog();
      if (logged) this.learn(events, keys, logged);
    }
    this.known = new Map(keys.filter((key) => this.known.has(key)).map((key) => [key, this.known.get(key) ?? null]));
    events.forEach((event, i) => {
      const at = this.known.get(keys[i]);
      if (typeof at === "number") event.at = at;
    });
  }

  private learn(events: ViewEvent[], keys: string[], logged: LoggedEvent[]): void {
    events.forEach((event, i) => {
      if (this.known.has(keys[i]) || typeof event.time !== "string") return;
      const time = event.time.trim();
      const matches = logged.filter((e) => e.type === event.type && sameClock(e.ts, time));
      this.known.set(keys[i], matches.length > 0 ? Math.max(...matches.map((e) => e.ts)) : null);
    });
  }
}
