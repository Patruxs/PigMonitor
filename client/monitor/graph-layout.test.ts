import assert from "node:assert/strict";
import test from "node:test";
import type { Block, Dir, Kind, Row, View } from "../../shared/piggery/view.ts";
import { graphOf, itemsIn, type Node, treeOf } from "./graph-layout.ts";

function row(id: string, depth: number, kind: Kind = "member"): Row {
  return { kind, id, depth, name: id, state: "idle", state_text: "idle", status: "idle", unacked: 0 };
}

function dir(path: string, blocks: Block[]): Dir {
  return { path, label: path, blocks };
}

function view(parts: { all?: Dir[]; closed?: Dir[]; board?: Dir[] }): View {
  return {
    version: 1,
    generated_at: 0,
    summary: { teams: 0, working: 0, idle: 0, held: 0, unacked: 0 },
    tabs: [],
    all: { dirs: parts.all ?? [] },
    closed: { dirs: parts.closed ?? [] },
    board: { columns: [], dirs: parts.board ?? [] },
    events: [],
    details: {},
  };
}

function ids(nodes: Node[]): unknown[] {
  return nodes.map((n) => [n.row?.id, ...ids(n.kids)]);
}

test("the graph's items are the board's member and solo rows, each with its dir, limited to the dirs asked for", () => {
  const board = [dir("/a", [{ rows: [row("team", 0, "team"), row("lead", 0), row("gone", 1, "gone")] }, { rows: [row("solo", 0, "solo")] }]), dir("/b", [{ rows: [row("other", 0)] }])];
  const pig = view({ board });
  assert.deepEqual(itemsIn(pig, undefined).map((i) => [i.row.id, i.dir]), [["lead", "/a"], ["solo", "/a"], ["other", "/b"]]);
  assert.deepEqual(itemsIn(pig, [board[1]]).map((i) => i.row.id), ["other"]);
});

test("the tree hangs each member from the nearest shallower member above it in its own block, in open and closed teams alike", () => {
  const pig = view({
    all: [dir("/a", [{ head: { id: "t1", detail: "", name: "t1", template: "slp", line: true, open: true }, rows: [row("lead", 0), row("mid", 1), row("worker", 2), row("solo", 1, "solo"), row("peer", 1)] }, { rows: [row("orphan", 1)] }])],
    closed: [dir("/b", [{ rows: [row("old-lead", 0), row("old-worker", 1)] }])],
  });
  const tree = treeOf(pig);
  assert.deepEqual(Object.fromEntries([...tree.parents].map(([id, parent]) => [id, parent.id])), { mid: "lead", worker: "mid", peer: "lead", "old-worker": "old-lead" });
  assert.deepEqual(tree.reports.get("lead")?.map((r) => r.id), ["mid", "peer"]);
  assert.deepEqual(tree.templates, new Map([["t1", "slp"]]));
});

test("a shown row hangs from its nearest shown ancestor, or from the team when none is shown, so no card is lost", () => {
  const lead = row("lead", 0);
  const mid = row("mid", 1);
  const worker = row("worker", 2);
  const peer = row("peer", 1);
  const tree = treeOf(view({ all: [dir("/a", [{ rows: [lead, mid, worker, peer] }])] }));
  assert.deepEqual(ids(graphOf([lead, worker, peer], tree)), [["lead", ["worker"], ["peer"]]]);
  assert.deepEqual(ids(graphOf([worker, peer, row("stranger", 1)], tree)), [["worker"], ["peer"], ["stranger"]]);
});
