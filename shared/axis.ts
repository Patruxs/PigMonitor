export interface AxisLabel {
  step: number;
  x: number;
  width: number;
}

export function keptAxisSteps(labels: AxisLabel[], end: number, gap: number): number[] {
  const fitting = labels.filter((label) => label.x + label.width <= end);
  for (let stride = 1; ; stride *= 2) {
    const kept = fitting.filter((label) => label.step % stride === 0);
    const clear = kept.every((label, i) => i === 0 || label.x >= kept[i - 1].x + kept[i - 1].width + gap);
    if (clear || kept.length <= 1) return kept.map((label) => label.step);
  }
}
