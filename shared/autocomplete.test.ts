import assert from "node:assert/strict";
import test from "node:test";
import { applyFileMentionReplacement, applySlashCommandReplacement, filterAndRankCommands, findActiveFileMention, findActiveSlashCommand } from "./autocomplete.ts";

test("a slash opens commands at the start or after a space, not inside a word or a path", () => {
  assert.deepEqual(findActiveSlashCommand("/rev", 4), { start: 0, end: 4, query: "rev", position: "start" });
  assert.equal(findActiveSlashCommand("run /sk", 7)?.position, "inline");
  assert.equal(findActiveSlashCommand("a/b", 3), null);
  assert.equal(findActiveSlashCommand("/a b", 4), null);
});

test("picking a command replaces the typed fragment and adds a space at the end", () => {
  const text = "/rev";
  assert.equal(applySlashCommandReplacement(text, findActiveSlashCommand(text, 4)!, "review"), "/review ");
});

test("picking a file quotes its path in place of the mention", () => {
  const text = "see @src/ma now";
  const mention = findActiveFileMention(text, 11)!;
  assert.equal(applyFileMentionReplacement(text, mention, "src/main.ts"), 'see "src/main.ts" now');
});

test("commands rank by how well the query matches their name", () => {
  const ranked = filterAndRankCommands([{ name: "compact" }, { name: "review" }, { name: "pr-review" }], "review");
  assert.deepEqual(ranked.map((c) => c.name), ["review", "pr-review"]);
});
