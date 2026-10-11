import assert from "node:assert/strict";
import test from "node:test";
import { currentBar, eventDots, exitMark, pieceBoxes, xOf, type Scale } from "./track-geometry.ts";

const scale: Scale = { start: 0, now: 1000, width: 1000 };
const x = (t: number) => xOf(scale, t);

test("the exit point sits at the exit time and its label flips left only near now", () => {
  assert.deepEqual(exitMark(scale, 500), { x: 500, labelSide: "right" });
  assert.deepEqual(exitMark(scale, 880), { x: 880, labelSide: "right" });
  assert.deepEqual(exitMark(scale, 881), { x: 881, labelSide: "left" });
  assert.deepEqual(exitMark(scale, 1000), { x: 1000, labelSide: "left" });
});

test("the current bar ends exactly at now and never runs past it", () => {
  assert.deepEqual(currentBar(scale, 700), { left: 700, width: 300 });
  assert.deepEqual(currentBar(scale, 998), { left: 994, width: 6 });
  assert.deepEqual(currentBar(scale, 1000), { left: 994, width: 6 });
  assert.deepEqual(currentBar(scale, -500), { left: 0, width: 1000 });
});

test("past pieces stop at their neighbour and short pieces stay visible", () => {
  const boxes = pieceBoxes([{ start: 100, end: 100.5 }, { start: 100.5, end: 300 }, { start: 300, end: 700 }], x, 700);
  assert.deepEqual(boxes, [{ left: 100, width: 0.5 }, { left: 100.5, width: 199.5 }, { left: 300, width: 400 }]);
  const lone = pieceBoxes([{ start: 100, end: 100.5 }], x, 700);
  assert.deepEqual(lone, [{ left: 100, width: 2 }]);
  const clipped = pieceBoxes([{ start: 600, end: 800 }], x, 650);
  assert.deepEqual(clipped, [{ left: 600, width: 50 }]);
});

test("events closer than one dot merge with a count and the strongest tone", () => {
  const dots = eventDots([{ t: 500, tone: "muted" }, { t: 505, tone: "danger" }, { t: 510, tone: "warning" }, { t: 600, tone: "warning" }], x);
  assert.deepEqual(dots, [{ x: 500, tone: "danger", count: 3 }, { x: 600, tone: "warning", count: 1 }]);
  assert.deepEqual(eventDots([{ t: 500, tone: "muted" }, { t: 511, tone: "muted" }], x).map((d) => d.count), [1, 1]);
});
