import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PALETTE, DEFAULT_TEAM_HUES, exportPalette, importPalette, mergePalette, resetPalette, resetPaletteValue, setPaletteValue, teamHuesOf, valueError, withAlpha } from "./palette.ts";

test("the defaults are the colours PigMonitor drew before the palette", () => {
  assert.deepEqual(DEFAULT_PALETTE, {
    working: "statusSuccess",
    waiting: "statusWarning",
    idle: "foregroundMuted",
    gone: "statusDanger",
    supervisor: "#a78bfa",
    lead: "#38bdf8",
    peer: "#34d399",
    executor: "#2dd4bf",
    advisor: "#f472b6",
    mail: "#f472b6",
    mailHeld: "#fb923c",
    team: "#a78bfa",
    teamHues: "#fbbf24, #fb923c, #f87171, #a3e635, #e879f9, #818cf8, #22d3ee, #facc15",
  });
});

test("hex in three forms and theme tokens are accepted, anything else is rejected", () => {
  for (const value of ["#abc", "#aabbcc", "#aabbcc80", "accent", "statusDanger"]) assert.equal(valueError("peer", value), null, value);
  for (const value of ["", "red", "#abcd", "#gggggg", "rgb(1,2,3)", "Accent"]) assert.notEqual(valueError("peer", value), null, value);
});

test("overrides merge over the defaults and invalid stored values fall back to the default", () => {
  const merged = mergePalette({ working: "#00ff00", peer: "nope", lead: 7, unknown: "#fff" });
  assert.equal(merged.working, "#00ff00");
  assert.equal(merged.peer, DEFAULT_PALETTE.peer);
  assert.equal(merged.lead, DEFAULT_PALETTE.lead);
  assert.equal(merged.gone, DEFAULT_PALETTE.gone);
  assert.deepEqual(mergePalette(undefined), DEFAULT_PALETTE);
});

test("setting refuses invalid values, and a value equal to its default or a reset removes the override", () => {
  const set = setPaletteValue({}, "peer", " #123456 ");
  assert.deepEqual(set, { ok: true, overrides: { peer: "#123456" } });
  assert.equal(setPaletteValue({ peer: "#123456" }, "peer", "blue").ok, false);
  assert.deepEqual(setPaletteValue({ peer: "#123456" }, "peer", DEFAULT_PALETTE.peer), { ok: true, overrides: {} });
  assert.deepEqual(resetPaletteValue({ peer: "#123456", lead: "#000" }, "peer"), { lead: "#000" });
  assert.deepEqual(resetPalette(), {});
});

test("team hues take one to eight hex colours, and an invalid list falls back to the built-in eight", () => {
  assert.deepEqual(teamHuesOf(mergePalette({ teamHues: "#111, #222222" })), ["#111", "#222222"]);
  assert.equal(valueError("teamHues", "#111"), null);
  assert.notEqual(valueError("teamHues", " , "), null);
  assert.notEqual(valueError("teamHues", Array(9).fill("#111").join(",")), null);
  assert.notEqual(valueError("teamHues", "#111, accent"), null);
  assert.deepEqual(teamHuesOf({ ...DEFAULT_PALETTE, teamHues: "#111, nope" }), DEFAULT_TEAM_HUES);
});

test("an exported palette imports back to the same colours, and bad JSON is refused", () => {
  const overrides = { working: "#00ff00", teamHues: "#111, #222" };
  const back = importPalette(exportPalette(overrides));
  if (!back.ok) return assert.fail(back.error);
  assert.deepEqual(mergePalette(back.overrides), mergePalette(overrides));
  assert.deepEqual(back.overrides, overrides);
  for (const bad of ["not json", "[]", "null", '{"wroking":"#fff"}', '{"peer":5}', '{"peer":"blue"}']) assert.equal(importPalette(bad).ok, false, bad);
});

test("fills keep their alpha for every accepted colour form", () => {
  assert.equal(withAlpha("#a78bfa", "22"), "#a78bfa22");
  assert.equal(withAlpha("#abc", "88"), "#aabbcc88");
  assert.equal(withAlpha("#aabbcc80", "ff"), "#aabbcc80");
  assert.equal(withAlpha("#aabbccff", "80"), "#aabbcc80");
  assert.equal(withAlpha("rgb(10, 20, 30)", "80"), "rgba(10, 20, 30, 0.502)");
  assert.equal(withAlpha("rgba(10,20,30,0.5)", "ff"), "rgba(10, 20, 30, 0.5)");
});
