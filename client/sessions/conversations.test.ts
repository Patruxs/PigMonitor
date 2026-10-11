import assert from "node:assert/strict";
import test from "node:test";
import { conversationsOf, matches, mostPressing, passes, projectsOf, type Conversation, type Filter } from "./conversations.ts";
import type { Dir, Row, Status, View } from "../../shared/piggery/view.ts";

const row = (id: string, status: Status, over: Partial<Row> = {}): Row => ({ kind: "member", id, depth: 0, name: id, state: status, state_text: status, status, unacked: 0, ...over });

const talk = (id: string, status: Status, at: number, dir = "/p", team = "t"): Conversation => ({ row: row(id, status), teamKey: team, teamName: team, template: undefined, dir: { path: dir, label: dir }, preview: "", at });

test("the most pressing comes first: waiting, then working, idle, gone, and the latest first within a status", () => {
  const items = [talk("old-idle", "idle", 1), talk("gone", "gone", 9), talk("new-idle", "idle", 5), talk("working", "working", 2), talk("waiting", "waiting", 0)];
  assert.equal(mostPressing(items)?.row.id, "waiting");
  const solos = projectsOf(items.map((c) => ({ ...c, teamKey: "" })))[0].groups[0].items.map((c) => c.row.id);
  assert.deepEqual(solos, ["waiting", "working", "new-idle", "old-idle", "gone"]);
  const projects = projectsOf([talk("a", "idle", 9, "/quiet"), talk("b", "waiting", 1, "/needs-you"), talk("c", "idle", 3, "/later")]);
  assert.deepEqual(projects.map((p) => p.path), ["/needs-you", "/quiet", "/later"]);
});

test("a filter keeps only its statuses", () => {
  const items = (["waiting", "working", "idle", "gone"] as const).map((s) => talk(s, s, 0));
  const kept = (filter: Filter) => items.filter((c) => passes(c, filter)).map((c) => c.row.id);
  assert.deepEqual(kept("all"), ["waiting", "working", "idle", "gone"]);
  assert.deepEqual(kept("live"), ["waiting", "working", "idle"]);
  assert.deepEqual(kept("waiting"), ["waiting"]);
  assert.deepEqual(kept("gone"), ["gone"]);
});

test("conversations are the members and solos piggery lists, under their directory, previewed by their task", () => {
  const dirs: Dir[] = [{ path: "/p", label: "~/p", blocks: [{ head: { id: "t", detail: "t", name: "Team", template: "slp", line: true, open: true }, rows: [row("team-line", "idle", { kind: "team" }), row("m", "working", { team: "t", harness: "claude" }), row("gone-line", "gone", { kind: "gone" })] }, { rows: [row("s", "idle", { kind: "solo", harness: "pi" })] }] }];
  const view: Pick<View, "details" | "tabs"> = { details: { m: { kind: "participant", title: "m", task: { title: "#12 Fix the parser", from: "" }, facts: [] } }, tabs: [{ key: "t", label: "Team", count: 1 }] };
  const items = conversationsOf(view, dirs);
  assert.deepEqual(items.map((c) => [c.row.id, c.teamKey, c.teamName, c.template, c.dir.label, c.preview]), [
    ["m", "t", "Team", "slp", "~/p", "Fix the parser"],
    ["s", "", undefined, undefined, "~/p", "pi session"],
  ]);
});

test("search finds a conversation by its name, role, team, task or harness", () => {
  const c: Conversation = { ...talk("builder", "idle", 0, "/p", "PigMonitor"), preview: "Fix the parser" };
  c.row = { ...c.row, role: "peer", harness: "claude" };
  for (const query of ["build", "PEER", "pigmon", "parser", "claude", "  "]) assert.ok(matches(c, query), query);
  assert.equal(matches(c, "codex"), false);
});
