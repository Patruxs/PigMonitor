import type { Dir, Row, View as PigView } from "../../shared/view.ts";

export interface Item {
  row: Row;
  dir: string;
}

function itemsOf(view: PigView): Item[] {
  const out: Item[] = [];
  for (const d of view.board.dirs) {
    for (const b of d.blocks) {
      for (const row of b.rows) {
        if (row.kind === "member" || row.kind === "solo") out.push({ row, dir: d.path });
      }
    }
  }
  return out;
}

export function itemsIn(view: PigView, dirs: Dir[] | undefined): Item[] {
  if (!dirs) return itemsOf(view);
  const paths = new Set(dirs.map((d) => d.path));
  return itemsOf(view).filter((i) => paths.has(i.dir));
}

export interface Tree {
  parents: Map<string, Row>;
  reports: Map<string, Row[]>;
  templates: Map<string, string>;
}

export function treeOf(view: PigView): Tree {
  const parents = new Map<string, Row>();
  const reports = new Map<string, Row[]>();
  const templates = new Map<string, string>();
  for (const list of [view.all, view.closed]) {
    for (const d of list.dirs) {
      for (const b of d.blocks) {
        if (b.head?.template) templates.set(b.head.id, b.head.template);
        const stack: Row[] = [];
        for (const r of b.rows) {
          if (r.kind !== "member") continue;
          stack.length = r.depth;
          const parent = stack[r.depth - 1];
          if (parent) {
            parents.set(r.id, parent);
            reports.set(parent.id, [...(reports.get(parent.id) ?? []), r]);
          }
          stack[r.depth] = r;
        }
      }
    }
  }
  return { parents, reports, templates };
}

export interface Node {
  row?: Row;
  kids: Node[];
}

export function graphOf(rows: Row[], tree: Tree): Node[] {
  const shown = new Map(rows.map((r) => [r.id, { row: r, kids: [] as Node[] }]));
  const roots: Node[] = [];
  for (const r of rows) {
    let p = tree.parents.get(r.id);
    while (p && !shown.has(p.id)) p = tree.parents.get(p.id);
    const node = shown.get(r.id)!;
    if (p) shown.get(p.id)!.kids.push(node);
    else roots.push(node);
  }
  return roots;
}
