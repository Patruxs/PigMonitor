export const SHARE = { name: 3, role: 1.5, state: 1.5, ctx: 1, since: 1 } as const;
export const NAME_MIN = 120;
export const STATE_MIN = 72;
export const ROLE_COLUMN_MIN = 560;
export const CTX_COLUMN_MIN = 440;

export type Columns = "both" | "ctx" | "none";

export const columnsFor = (width: number): Columns => (width >= ROLE_COLUMN_MIN ? "both" : width >= CTX_COLUMN_MIN ? "ctx" : "none");

export function tailWidth(columns: Columns): `${number}%` {
  const tail = SHARE.state + SHARE.since + (columns !== "none" ? SHARE.ctx : 0) + (columns === "both" ? SHARE.role : 0);
  return `${(100 * tail) / (SHARE.name + tail)}%`;
}
