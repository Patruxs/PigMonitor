import assert from "node:assert/strict";
import test from "node:test";
import { claudeToolCall } from "./tool-detail.ts";

const done = (content: unknown, is_error?: boolean) => ({ type: "tool_result", tool_use_id: "t", content, ...(is_error ? { is_error } : {}) });

test("a Bash call is a shell detail, running until its result and failed with the result as its error", () => {
  assert.deepEqual(claudeToolCall("Bash", { command: "ls", description: "List" }, undefined, "/p"), { detail: { type: "shell", command: "ls" }, status: "running" });
  assert.deepEqual(claudeToolCall("Bash", { command: "ls" }, done([{ type: "text", text: "a\nb" }]), "/p"), { detail: { type: "shell", command: "ls", output: "a\nb" }, status: "completed" });
  const failed = claudeToolCall("Bash", { command: "false" }, done("Exit code 1", true), "/p");
  assert.deepEqual(failed, { detail: { type: "shell", command: "false" }, status: "failed", toolError: { type: "tool_result", tool_use_id: "t", is_error: true, content: "Exit code 1" } });
});

test("file tools carry their path and text: Read without its line gutter, Edit and Write from their input", () => {
  assert.deepEqual(claudeToolCall("Read", { file_path: "/p/a.ts", offset: 10, limit: 2 }, done("    10\tconst a = 1;\n    11\tconst b = 2;"), "/p").detail, { type: "read", filePath: "/p/a.ts", content: "const a = 1;\nconst b = 2;", offset: 10, limit: 2 });
  assert.deepEqual(claudeToolCall("Edit", { file_path: "/p/a.ts", old_string: "a", new_string: "b" }, done("The file has been updated."), "/p").detail, { type: "edit", filePath: "/p/a.ts", oldString: "a", newString: "b" });
  assert.deepEqual(claudeToolCall("Write", { file_path: "/p/b.ts", content: "x" }, done("File created"), "/p").detail, { type: "write", filePath: "/p/b.ts", content: "x" });
});

test("searches and fetches come out as Paseo gives them from a text result: Grep as a search, Glob and WebFetch as unknown", () => {
  assert.deepEqual(claudeToolCall("Grep", { pattern: "foo", path: "/p" }, done("Found 1 file\n/p/a.ts"), "/p").detail, { type: "search", query: "foo", toolName: "grep", content: "Found 1 file\n/p/a.ts", numFiles: 0 });
  assert.deepEqual(claudeToolCall("Glob", { pattern: "**/*.ts" }, done("/p/a.ts"), "/p").detail, { type: "unknown", input: { pattern: "**/*.ts" }, output: { output: "/p/a.ts" } });
  assert.deepEqual(claudeToolCall("WebFetch", { url: "https://x.dev", prompt: "sum" }, undefined, "/p").detail, { type: "fetch", url: "https://x.dev", prompt: "sum" });
  assert.equal(claudeToolCall("WebFetch", { url: "https://x.dev", prompt: "sum" }, done("A page"), "/p").detail.type, "unknown");
});

test("an Agent call is a sub-agent card with its answer, ExitPlanMode a plan, and an MCP tool unknown with its JSON result parsed", () => {
  assert.deepEqual(claudeToolCall("Agent", { description: "Explore", subagent_type: "Explore", prompt: "look" }, done([{ type: "text", text: "Found it in a.ts" }]), "/p"), { detail: { type: "sub_agent", subAgentType: "Explore", description: "Explore", log: "Found it in a.ts", actions: [] }, status: "completed" });
  assert.deepEqual(claudeToolCall("ExitPlanMode", { plan: "1. do" }, done("rejected", true), "/p"), { detail: { type: "plan", text: "1. do" }, status: "completed" });
  assert.deepEqual(claudeToolCall("mcp__piggery__send", { to: "squid", body: "hi" }, done([{ type: "text", text: '{"id":"m1","seq":3}' }]), "/p").detail, { type: "unknown", input: { to: "squid", body: "hi" }, output: { output: { id: "m1", seq: 3 } } });
});
