import assert from "node:assert/strict";
import test from "node:test";
import { keptAxisSteps } from "./axis.ts";

const ticks = (widths: number[], spacing: number, firstStep = 0) => widths.map((width, i) => ({ step: firstStep + i, x: i * spacing, width }));

test("labels that fit between their ticks are all kept", () => {
  assert.deepEqual(keptAxisSteps(ticks([36, 36, 36, 36], 64), 1000, 8), [0, 1, 2, 3]);
});

test("a wide dated first label drops every other label until none overlap", () => {
  assert.deepEqual(keptAxisSteps(ticks([80, 36, 36, 36, 36], 64, 6), 1000, 8), [6, 8, 10]);
});

test("labels keep thinning while every other one still collides", () => {
  assert.deepEqual(keptAxisSteps(ticks([36, 36, 36, 36, 36, 36, 36, 36, 36], 12), 1000, 8), [0, 4, 8]);
});

test("the kept labels stay on the same ticks as the window slides", () => {
  assert.deepEqual(keptAxisSteps(ticks([36, 36, 36, 36, 36], 30, 7), 1000, 8), [8, 10]);
  assert.deepEqual(keptAxisSteps(ticks([36, 36, 36, 36, 36], 30, 8), 1000, 8), [8, 10, 12]);
});

test("a label that would run past the end is dropped instead of clipped", () => {
  assert.deepEqual(keptAxisSteps(ticks([36, 36, 36], 64), 150, 8), [0, 1]);
});
