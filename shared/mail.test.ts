import assert from "node:assert/strict";
import test from "node:test";
import { bodyOf, continues, dayLabel, GROUP_MS, isLong, matchesSearch, previewOf, isNotice, isUnacked, kindLabel, kindTone, participantsOf, roleTone, shownMail, teamIdOfKey, titleOf, type MailMessage } from "./mail.ts";

const at = Date.UTC(2026, 9, 10, 12, 0, 0);

function msg(over: Partial<MailMessage>): MailMessage {
  return { id: over.id ?? "m", seq: 1, from: "a", from_name: "lead", from_role: "lead", to: "b", to_name: "peer", to_role: "peer", body: "hello", created_at: at, ...over };
}

test("an assign's first line is its title and the rest its body", () => {
  const m = msg({ op: "assign", body: "Fix CI\n\nThe matrix fails on macOS." });
  assert.equal(titleOf(m), "Fix CI");
  assert.equal(bodyOf(m), "The matrix fails on macOS.");
  assert.equal(kindLabel(m), "assign");
  assert.equal(kindLabel({ op: "assign", kind: "task" }), "assign · task");
});

test("other mail has no title and keeps its body", () => {
  const m = msg({ kind: "handback", body: "Done.\nSee commit." });
  assert.equal(titleOf(m), undefined);
  assert.equal(bodyOf(m), "Done.\nSee commit.");
  assert.equal(kindLabel(m), "handback");
});

test("kinds take the tone of what they mean", () => {
  assert.equal(kindTone("handback", undefined), "success");
  assert.equal(kindTone("rework", undefined), "warning");
  assert.equal(kindTone("urgent", undefined), "danger");
  assert.equal(kindTone(undefined, "assign"), "accent");
  assert.equal(kindTone("whatever", undefined), "muted");
  assert.equal(kindTone(undefined, undefined), "muted");
});

test("roles take a tone, pseudo participants none", () => {
  assert.equal(roleTone("lead", "x"), "accent");
  assert.equal(roleTone("peer", "x"), "success");
  assert.equal(roleTone(undefined, "engine"), "muted");
  assert.equal(roleTone("lead", "notify"), "muted");
});

test("engine notices and mail to notify are notices", () => {
  assert.equal(isNotice({ from: "engine", to: "notify" }), true);
  assert.equal(isNotice({ from: "a", to: "notify" }), true);
  assert.equal(isNotice({ from: "a", to: "b" }), false);
});

test("mail to a participant without an ack is unread; mail to notify or board never is", () => {
  assert.equal(isUnacked({ to: "b", acked_at: undefined }), true);
  assert.equal(isUnacked({ to: "b", acked_at: at }), false);
  assert.equal(isUnacked({ to: "notify", acked_at: undefined }), false);
  assert.equal(isUnacked({ to: "board", acked_at: undefined }), false);
});

test("participants are the senders and receivers, most active first, without pseudo ids", () => {
  const people = participantsOf([msg({ id: "1" }), msg({ id: "2", from: "b", from_name: "peer", from_role: "peer", to: "a", to_name: "lead", to_role: "lead" }), msg({ id: "3", from: "engine", from_name: "engine", from_role: undefined, to: "notify", to_name: "notify", to_role: undefined }), msg({ id: "4", to: "c", to_name: "other", to_role: "peer" })]);
  assert.deepEqual(
    people.map((p) => [p.id, p.count]),
    [
      ["a", 3],
      ["b", 2],
      ["c", 1],
    ],
  );
});

test("shownMail hides notices by default, keeps only unread and one participant on request", () => {
  const all = [msg({ id: "1" }), msg({ id: "2", acked_at: at }), msg({ id: "3", from: "engine", from_name: "engine", to: "notify", to_name: "notify" }), msg({ id: "4", from: "c", from_name: "other", to: "a", to_name: "lead" })];
  assert.deepEqual(shownMail(all, { participant: "", unackedOnly: false, notices: false }).map((m) => m.id), ["1", "2", "4"]);
  assert.deepEqual(shownMail(all, { participant: "", unackedOnly: false, notices: true }).map((m) => m.id), ["1", "2", "3", "4"]);
  assert.deepEqual(shownMail(all, { participant: "", unackedOnly: true, notices: false }).map((m) => m.id), ["1", "4"]);
  assert.deepEqual(shownMail(all, { participant: "b", unackedOnly: false, notices: false }).map((m) => m.id), ["1", "2"]);
});

test("day labels name today and yesterday, else the date", () => {
  const now = new Date(2026, 9, 10, 15, 0, 0).getTime();
  assert.equal(dayLabel(now - 3600000, now), "Today");
  assert.equal(dayLabel(now - 86400000, now), "Yesterday");
  assert.equal(dayLabel(new Date(2026, 8, 2, 9, 0, 0).getTime(), now), "Sep 2");
  assert.equal(dayLabel(new Date(2025, 8, 2, 9, 0, 0).getTime(), now), "Sep 2, 2025");
});

test("a team detail key gives its team id; anything else gives none", () => {
  assert.equal(teamIdOfKey("\u0000team:01ABC"), "01ABC");
  assert.equal(teamIdOfKey("\u0000gone:01ABC"), undefined);
  assert.equal(teamIdOfKey("01ABC"), undefined);
});

test("a message continues the one before when the same pair talks within five minutes", () => {
  const first = msg({ id: "1", body: "one" });
  assert.equal(continues(undefined, first), false);
  assert.equal(continues(first, msg({ id: "2", created_at: at + 1000 })), true);
  assert.equal(continues(first, msg({ id: "3", created_at: at + GROUP_MS + 1 })), false);
  assert.equal(continues(first, msg({ id: "4", to: "c", created_at: at + 1000 })), false);
  assert.equal(continues(first, msg({ id: "5", op: "assign", created_at: at + 1000 })), false);
  assert.equal(continues(first, msg({ id: "6", reply_to: "1", created_at: at + 1000 })), false);
});

test("search matches every word across body and names, or a #seq exactly", () => {
  const m = msg({ seq: 42, body: "The matrix fails on macOS" });
  assert.equal(matchesSearch(m, ""), true);
  assert.equal(matchesSearch(m, "matrix macos"), true);
  assert.equal(matchesSearch(m, "lead fails"), true);
  assert.equal(matchesSearch(m, "linux"), false);
  assert.equal(matchesSearch(m, "#42"), true);
  assert.equal(matchesSearch(m, "#4"), false);
});

test("a body is long past eight lines or seven hundred characters", () => {
  assert.equal(isLong("short"), false);
  assert.equal(isLong("x".repeat(701)), true);
  assert.equal(isLong(Array(9).fill("l").join("\n")), true);
  assert.equal(previewOf("\n\n  first  \nsecond"), "first");
});
