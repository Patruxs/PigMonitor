import assert from "node:assert/strict";
import test from "node:test";
import { inputText, isWake, mailsIn, parseLines } from "./transcript.ts";

const line = (o: unknown) => JSON.stringify(o);

test("inputText leads with the main field and keeps everything", () => {
  assert.equal(inputText({ command: "ls -la", description: "List" }), "ls -la\ndescription=List");
  assert.equal(inputText({}), "");
  assert.equal(inputText({ to: "lead", text: "hi" }), "hi\nto=lead");
  assert.equal(inputText("x".repeat(5000)).length, 5000);
});

test("non-empty thinking is kept as its own entry", () => {
  const items = parseLines(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "" }, { type: "thinking", thinking: "Let me check CI." }, { type: "text", text: "Checking." }] } }));
  assert.deepEqual(items.map((i) => [i.kind, i.text]), [["thinking", "Let me check CI."], ["assistant", "Checking."]]);
});

test("mailsIn reads piggery's message blocks", () => {
  const text = '[piggery] 2 new messages:\n\n<message id="#1440" from="gates (supervisor, you report to them)" sender="gates" reply_to="#1433" at="10:22:12">\nTình trạng?\n</message>\n<message id="#1441" from="x" sender="ci">\nDone.\n</message>';
  assert.deepEqual(mailsIn(text), [
    { ref: "#1440", from: "gates", reply: "#1433", at: "10:22:12", body: "Tình trạng?" },
    { ref: "#1441", from: "ci", reply: undefined, at: undefined, body: "Done." },
  ]);
  assert.equal(isWake("Another Claude session sent a message:\n[piggery] wake #1: you have new mail"), true);
  assert.equal(isWake("merge code vào main đi"), false);
});

test("parseLines turns stream-json into a readable session", () => {
  const log = [
    line({ type: "system", subtype: "init", model: "claude-opus-5-5", cwd: "/p", timestamp: "2026-10-10T03:00:00Z" }),
    line({ type: "assistant", timestamp: "2026-10-10T03:00:01Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "" }, { type: "tool_use", id: "t1", name: "mcp__piggery__inbox", input: {} }] } }),
    line({ type: "tool_execution_start", toolName: "mcp__piggery__inbox", args: {} }),
    line({ type: "user", timestamp: "2026-10-10T03:00:02Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: '[piggery] 1 new message:\n\n<message id="#1" sender="gates" reply_to="#0">\nFix CI\n</message>' }] }] } }),
    line({ type: "assistant", timestamp: "2026-10-10T03:00:03Z", message: { role: "assistant", content: [{ type: "text", text: "On it." }, { type: "tool_use", id: "t2", name: "Bash", input: { command: "go test ./..." } }] } }),
    line({ type: "user", timestamp: "2026-10-10T03:00:04Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", is_error: true, content: "FAIL" }] } }),
    line({ type: "result", subtype: "success", num_turns: 2, duration_ms: 15755, total_cost_usd: 7.7372, is_error: false }),
    "not json",
    "",
  ].join("\n");
  const items = parseLines(log, "run1");
  assert.deepEqual(
    items.map((i) => [i.i, i.kind, i.text, i.tool, i.input, i.result, i.error, i.from, i.ref, i.reply, i.run]),
    [
      [0, "session", "claude-opus-5-5 · /p", undefined, undefined, undefined, undefined, undefined, undefined, undefined, "run1"],
      [1, "tool", "mcp__piggery__inbox", "mcp__piggery__inbox", "", '[piggery] 1 new message:\n\n<message id="#1" sender="gates" reply_to="#0">\nFix CI\n</message>', undefined, undefined, undefined, undefined, "run1"],
      [2, "mail", "Fix CI", undefined, undefined, undefined, undefined, "gates", "#1", "#0", "run1"],
      [3, "assistant", "On it.", undefined, undefined, undefined, undefined, undefined, undefined, undefined, "run1"],
      [4, "tool", "Bash", "Bash", "go test ./...", "FAIL", true, undefined, undefined, undefined, "run1"],
      [5, "turn", "2 turns · 16s · $7.74", undefined, undefined, undefined, false, undefined, undefined, undefined, "run1"],
    ],
  );
  assert.equal(items[0].at, Date.parse("2026-10-10T03:00:00Z"));
});

test("parseLines reads a Claude project transcript: prompts, wakes, no sidechains or meta", () => {
  const log = [
    line({ type: "user", isSidechain: false, timestamp: "2026-10-09T13:43:49Z", message: { role: "user", content: [{ type: "text", text: "Found team slp. Giao cho lead làm đi" }] } }),
    line({ type: "attachment", attachment: { type: "environment" } }),
    line({ type: "assistant", isSidechain: false, timestamp: "2026-10-09T13:43:55Z", message: { role: "assistant", content: [{ type: "text", text: "Đã giao." }] } }),
    line({ type: "user", isSidechain: true, message: { role: "user", content: "hidden subagent prompt" } }),
    line({ type: "user", isMeta: true, message: { role: "user", content: "meta" } }),
    line({ type: "user", timestamp: "2026-10-09T13:50:00Z", message: { role: "user", content: "Another Claude session sent a message:\n[piggery] wake #1: you have new mail; it is shown with this turn.\n\nThis comes from piggery." } }),
    line({ type: "user", timestamp: "2026-10-09T13:50:01Z", message: { role: "user", content: "<system-reminder>\nstuff\n</system-reminder>" } }),
    line({ type: "queue-operation", operation: "enqueue" }),
  ].join("\n");
  const items = parseLines(log);
  assert.deepEqual(
    items.map((i) => [i.kind, i.text]),
    [
      ["user", "Found team slp. Giao cho lead làm đi"],
      ["assistant", "Đã giao."],
      ["wake", "[piggery] wake #1: you have new mail; it is shown with this turn."],
    ],
  );
  assert.equal(items[0].run, undefined);
});

test("images the person pasted show in their message", () => {
  const user = (content: unknown) => line({ type: "user", message: { role: "user", content } });
  const png = { type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } };
  const items = parseLines([user([{ type: "text", text: "What is this?" }, png]), user([png, png])].join("\n"));
  assert.deepEqual(items.map((i) => [i.kind, i.text]), [["user", "What is this?\n[image]"], ["user", "[2 images]"]]);
  const saved = parseLines(user([{ type: "text", text: "What is this?" }, png]), undefined, (data, mimeType) => `/tmp/pasted/${data.length}.${mimeType.slice(6)}`);
  assert.deepEqual(saved.map((i) => i.text), ["What is this?\n[image: /tmp/pasted/4.png]"]);
});

test("a run's start, its handed-over prompt and its end take the times around them, and each turn its own duration and cost", () => {
  const log = [
    line({ type: "command_lifecycle", state: "queued" }),
    line({ type: "command_lifecycle", state: "started" }),
    line({ type: "system", subtype: "init", model: "m", cwd: "/p" }),
    line({ type: "assistant", timestamp: "2026-10-10T03:00:01Z", message: { role: "assistant", content: [{ type: "text", text: "Hi." }] } }),
    line({ type: "assistant", timestamp: "2026-10-10T03:00:05Z", message: { role: "assistant", content: [{ type: "text", text: "Done." }] } }),
    line({ type: "result", subtype: "success", duration_ms: 4000, total_cost_usd: 0.5 }),
    line({ type: "assistant", timestamp: "2026-10-10T03:01:00Z", message: { role: "assistant", content: [{ type: "text", text: "Again." }] } }),
    line({ type: "result", subtype: "success", duration_ms: 2000, total_cost_usd: 0.75 }),
  ].join("\n");
  const items = parseLines(log, "run1");
  assert.deepEqual(items.map((i) => [i.kind, i.at]), [["delivery", Date.parse("2026-10-10T03:00:01Z")], ["session", Date.parse("2026-10-10T03:00:01Z")], ["assistant", Date.parse("2026-10-10T03:00:01Z")], ["assistant", Date.parse("2026-10-10T03:00:05Z")], ["turn", Date.parse("2026-10-10T03:00:05Z")], ["assistant", Date.parse("2026-10-10T03:01:00Z")], ["turn", Date.parse("2026-10-10T03:01:00Z")]]);
  assert.deepEqual([items[4].durationMs, items[4].costUsd, items[6].durationMs, items[6].costUsd], [4000, 0.5, 2000, 0.25]);
});

test("a compaction is a marker, and neither its summary nor a skill's synthetic prompt is the person's message", () => {
  const log = [
    line({ type: "user", timestamp: "2026-10-10T03:00:00Z", message: { role: "user", content: "Fix the build." } }),
    line({ type: "system", subtype: "compact_boundary", timestamp: "2026-10-10T03:10:00Z", compact_metadata: { trigger: "auto", pre_tokens: 969364 } }),
    line({ type: "user", isCompactSummary: true, isVisibleInTranscriptOnly: true, timestamp: "2026-10-10T03:10:01Z", message: { role: "user", content: "This session is being continued from a previous conversation..." } }),
    line({ type: "user", isSynthetic: true, timestamp: "2026-10-10T03:11:00Z", message: { role: "user", content: [{ type: "text", text: "Answer questions about my Discord with the dexport CLI." }] } }),
  ].join("\n");
  const items = parseLines(log);
  assert.deepEqual(items.map((i) => [i.kind, i.text]), [["user", "Fix the build."], ["compaction", ""]]);
  assert.deepEqual([items[1].trigger, items[1].preTokens], ["auto", 969364]);
});

test("a sent mail's tool call carries the mail's #ref, a refused one does not", () => {
  const send = (id: string) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name: "mcp__piggery__send", input: { to: "lead", body: "done" } }] } });
  const result = (id: string, text: string) => line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }] } });
  const items = parseLines([send("a"), result("a", "sent #1753"), send("b"), result("b", "refused (routing.no_rule): routing does not allow peer -> peer")].join("\n"));
  assert.deepEqual(items.map((i) => i.ref), ["#1753", undefined]);
});

test("a run is started once, not again for each query, unless its session, model or folder changes", () => {
  const init = (cwd: string) => line({ type: "system", subtype: "init", session_id: "s1", model: "m", cwd });
  const say = (text: string) => line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
  const items = parseLines([init("/p"), say("one"), init("/p"), say("two"), init("/q"), say("three")].join("\n"));
  assert.deepEqual(items.map((i) => [i.kind, i.text]), [["session", "m · /p"], ["assistant", "one"], ["assistant", "two"], ["session", "m · /q"], ["assistant", "three"]]);
});
