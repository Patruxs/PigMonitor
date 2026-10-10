import { useEffect, useRef, useState } from "react";
import { dom } from "./kit/platform.ts";

export const BUSY_MS = 5000;
export const QUIET_MS = 30000;

export const GRACE_MS = 3000;

export const pollEvery = (busy: boolean) => (busy ? BUSY_MS : QUIET_MS);

const page = dom.document;

function hidden(): boolean {
  return page?.visibilityState === "hidden";
}

export type Failed = { code: string; message: string };
export type Loaded<T> = { value: T | null; error: Failed | null; at: number | null };

export function usePoll<T>(load: () => Promise<{ ok: true; value: T } | { ok: false; code: string; error: string }>, reloadKey: string, every: (value: T | null) => number): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ value: null, error: null, at: null });
  const latest = useRef({ load, every });
  latest.current = { load, every };
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: T | null = null;
    const again = () => {
      if (live) timer = setTimeout(tick, hidden() ? QUIET_MS : latest.current.every(last));
    };
    const tick = async () => {
      if (hidden()) return again();
      try {
        const r = await latest.current.load();
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
  }, [reloadKey]);
  return state;
}

export function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
