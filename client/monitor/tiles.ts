export function tileColumns(count: number, fit: number): number {
  if (count <= 0) return 1;
  const perRow = Math.max(1, fit);
  const rows = Math.ceil(count / perRow);
  return Math.ceil(count / rows);
}

export function tileWidth(rowWidth: number, count: number, min: number, max: number, gap: number): number {
  const fit = Math.floor((rowWidth + gap) / (min + gap));
  const cols = tileColumns(count, fit);
  return Math.min(max, Math.floor((rowWidth - gap * (cols - 1)) / cols));
}
