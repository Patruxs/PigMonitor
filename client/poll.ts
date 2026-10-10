import { useEffect, useState } from "react";

/** ps --view reads the workers' logs for ctx and turns: ask this often while something works or waits ... */
export const BUSY_MS = 5000;
/** ... and this often otherwise. */
export const QUIET_MS = 30000;

/** How long ago a read may be, beyond the poll interval, before it counts as overdue: the call itself takes time. */
export const GRACE_MS = 3000;

/** How often ps --view is asked for: soon while something works or waits, else rarely. */
export const pollEvery = (busy: boolean) => (busy ? BUSY_MS : QUIET_MS);

/** The web app's page; a native app has none. */
type Page = { visibilityState: string; addEventListener(type: string, fn: () => void): void; removeEventListener(type: string, fn: () => void): void };
const page = (globalThis as { document?: Page }).document;

/** The app page is in the background. */
function hidden(): boolean {
  return page?.visibilityState === "hidden";
}

export type Failed = { code: string; message: string };
export type Loaded<T> = { value: T | null; error: Failed | null; /** When the value was read (ms), null before the first read. */ at: number | null };

/**
 * Calls `load` now and again after `every(value)` ms while mounted and the page is shown (a hidden
 * page skips, and asks at once when shown again); keeps the last good value across a failure.
 */
export function usePoll<T>(load: () => Promise<{ ok: true; value: T } | { ok: false; code: string; error: string }>, key: string, every: (value: T | null) => number): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ value: null, error: null, at: null });
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: T | null = null;
    const again = () => {
      if (live) timer = setTimeout(tick, hidden() ? QUIET_MS : every(last));
    };
    const tick = async () => {
      if (hidden()) return again();
      try {
        const r = await load();
        if (r.ok) last = r.value;
        if (live) setState((s) => (r.ok ? { value: r.value, error: null, at: Date.now() } : { ...s, error: { code: r.code, message: r.error } }));
      } catch (error) {
        if (live) setState((s) => ({ ...s, error: { code: "failed", message: String(error) } }));
      }
      again();
    };
    const shown = () => {
      if (hidden() || !live) return;
      clearTimeout(timer);
      void tick();
    };
    setState({ value: null, error: null, at: null });
    void tick();
    page?.addEventListener("visibilitychange", shown);
    return () => {
      live = false;
      clearTimeout(timer);
      page?.removeEventListener("visibilitychange", shown);
    };
    // `load` is a fresh closure each render; `key` says when it asks for something else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/** The clock, ticking every `ms`, for ages that are drawn from a time and not from piggery's own words. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
