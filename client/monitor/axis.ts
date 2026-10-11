export interface AxisLabel {
  step: number;
  x: number;
  width: number;
}

export function keptAxisSteps(labels: AxisLabel[], end: number, gap: number): number[] {
  const fitting = labels.filter((label) => label.x >= 0 && label.x + label.width <= end);
  for (let stride = 1; ; stride *= 2) {
    const kept = fitting.filter((label) => label.step % stride === 0);
    const clear = kept.every((label, i) => i === 0 || label.x >= kept[i - 1].x + kept[i - 1].width + gap);
    if (clear || kept.length <= 1) return kept.map((label) => label.step);
  }
}

const offsetAt = (t: number) => -new Date(t).getTimezoneOffset() * 60_000;

export function localTicks(start: number, end: number, tick: number): { t: number; step: number }[] {
  const out: { t: number; step: number }[] = [];
  for (let step = Math.ceil((start + offsetAt(start)) / tick); ; step++) {
    const wall = step * tick;
    const t = wall - offsetAt(wall - offsetAt(wall));
    if (t >= end) return out;
    if (t >= start && (out.length === 0 || t > out[out.length - 1].t)) out.push({ t, step });
  }
}
