import type { Tone } from "../../shared/piggery/view.ts";

export const CURRENT_MIN_W = 6;
export const EXIT_DOT = 10;
export const EXIT_LABEL_ROOM = 120;
export const EVENT_DOT = 11;

export interface Scale {
  start: number;
  now: number;
  width: number;
}

export const xOf = (s: Scale, t: number) => Math.max(0, Math.min(s.width, ((t - s.start) / (s.now - s.start)) * s.width));

export function currentBar(scale: Scale, since: number): { left: number; width: number } {
  const stateX = xOf(scale, Math.max(since, scale.start));
  const width = Math.max(CURRENT_MIN_W, scale.width - stateX);
  return { left: scale.width - width, width };
}

export function exitMark(scale: Scale, since: number): { x: number; labelSide: "right" | "left" } {
  const x = xOf(scale, since);
  return { x, labelSide: x + EXIT_LABEL_ROOM <= scale.width ? "right" : "left" };
}

export function pieceBoxes(pieces: { start: number; end: number }[], x: (t: number) => number, until: number): { left: number; width: number }[] {
  return pieces.map((piece, i) => {
    const left = x(piece.start);
    const room = (i + 1 < pieces.length ? x(pieces[i + 1].start) : until) - left;
    return { left, width: Math.min(room, Math.max(2, x(piece.end) - left)) };
  });
}

const TONE_RANK: Record<Tone, number> = { muted: 0, warning: 1, danger: 2 };

export function eventDots(events: { t: number; tone: Tone }[], x: (t: number) => number): { x: number; tone: Tone; count: number }[] {
  const dots: { x: number; tone: Tone; count: number }[] = [];
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    const at = x(e.t);
    const last = dots[dots.length - 1];
    if (last && at - last.x < EVENT_DOT) {
      last.count += 1;
      if (TONE_RANK[e.tone] > TONE_RANK[last.tone]) last.tone = e.tone;
    } else dots.push({ x: at, tone: e.tone, count: 1 });
  }
  return dots;
}
