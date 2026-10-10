import assert from "node:assert/strict";
import test from "node:test";
import { ageLong, ageShort, clock24, messageClock } from "./format.ts";

const now = new Date(2026, 8, 29, 15, 0).getTime();
const before = (ms: number) => now - ms;

test("a long age reads just now, then minutes, hours and days ago", () => {
  assert.deepEqual([ageLong(before(30_000), now), ageLong(before(21 * 60_000), now), ageLong(before(3 * 3_600_000), now), ageLong(before(2 * 86_400_000), now)], ["just now", "21 min ago", "3 h ago", "2 d ago"]);
});

test("a short age reads now, then whole minutes, hours and days", () => {
  assert.deepEqual([ageShort(before(30_000), now), ageShort(before(8 * 60_000), now), ageShort(before(3 * 3_600_000), now), ageShort(before(2 * 86_400_000), now)], ["now", "8m", "3h", "2d"]);
});

test("a 24-hour clock shows the time today and the date before it on an earlier day", () => {
  assert.equal(clock24(new Date(2026, 8, 29, 14, 2).getTime(), now), "14:02");
  assert.equal(clock24(new Date(2026, 8, 28, 14, 2).getTime(), now), "Sep 28 14:02");
});

test("a message stamp is the time today, adds the weekday within six days, and the full date from the seventh day on", () => {
  const now = new Date(2026, 9, 10, 15, 0);
  const daysAgo = (days: number) => new Date(2026, 9, 10 - days, 9, 30);
  const weekday = (date: Date) => date.toLocaleDateString(undefined, { weekday: "long" });
  assert.equal(messageClock(daysAgo(0), now).includes(weekday(daysAgo(0))), false);
  assert.equal(messageClock(daysAgo(6), now).startsWith(weekday(daysAgo(6))), true);
  assert.equal(messageClock(daysAgo(7), now).includes("2026"), true);
});
