const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const DATE_AFTER_MS = 7 * DAY_MS;

export function ageLong(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

export function ageShort(ms: number, now: number): string {
  const elapsed = now - ms;
  if (elapsed < MINUTE_MS) return "now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h`;
  return `${Math.floor(elapsed / DAY_MS)}d`;
}

export function ageShortOrDate(ms: number, now: number): string {
  if (now - ms < DATE_AFTER_MS) return ageShort(ms, now);
  const date = new Date(ms);
  return `${date.toLocaleDateString("en-US", { month: "short" })} ${date.getDate()}`;
}

export function ageProse(ms: number, now: number): string {
  const short = ageShortOrDate(ms, now);
  if (short === "now") return "just now";
  return /^\d/.test(short) ? `${short} ago` : short;
}

export function readAge(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)} min ago`;
}

export function clock24(ms: number, now: number): string {
  const t = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  const hm = `${two(t.getHours())}:${two(t.getMinutes())}`;
  if (t.toDateString() === new Date(now).toDateString()) return hm;
  return `${t.toLocaleString("en-US", { month: "short" })} ${t.getDate()} ${hm}`;
}

let timeOfDay: Intl.DateTimeFormat | null = null;

function localTime(date: Date): string {
  if (!timeOfDay) {
    const resolved = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).resolvedOptions();
    timeOfDay = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hourCycle: resolved.hourCycle });
  }
  return timeOfDay.format(date);
}

export function messageClock(date: Date, now: Date = new Date()): string {
  const time = localTime(date);
  if (date.toDateString() === now.toDateString()) return time;
  const days = Math.floor((now.getTime() - date.getTime()) / DAY_MS);
  if (days >= 0 && days < 7) return `${date.toLocaleDateString(undefined, { weekday: "long" })} ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}, ${time}`;
}

export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${Math.floor(totalSeconds)}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = Math.floor(totalSeconds) % 60;
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export function stopwatch(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function percent(value: number): string {
  return `${Math.round(clampPercent(value))}%`;
}

export type Level = "normal" | "warning" | "danger";

export function levelOf(percentUsed: number): Level {
  if (percentUsed > 90) return "danger";
  if (percentUsed >= 70) return "warning";
  return "normal";
}

export function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function sessionCostText(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value < 0.01 ? `$${value.toFixed(4)}` : usd(value);
}
