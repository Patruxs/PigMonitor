import assert from "node:assert/strict";
import { test } from "node:test";
import { bottomInsetOf, resolveKeyboardShift } from "./keyboard.ts";

test("keyboard shift subtracts the space already below the view", () => {
  assert.equal(resolveKeyboardShift({ keyboardHeight: 336, visible: true, bottomInset: 34, isIos: true }), 302);
  assert.equal(resolveKeyboardShift({ keyboardHeight: 336, visible: false, bottomInset: 34, isIos: true }), 0);
  assert.equal(resolveKeyboardShift({ keyboardHeight: 0, visible: true, bottomInset: 34, isIos: true }), 0);
});

test("iOS ignores keyboards shorter than the accessory bar threshold", () => {
  assert.equal(resolveKeyboardShift({ keyboardHeight: 90, visible: true, bottomInset: 0, isIos: true }), 0);
  assert.equal(resolveKeyboardShift({ keyboardHeight: 90, visible: true, bottomInset: 0, isIos: false }), 90);
});

test("bottom inset is the gap between the view and the window bottom", () => {
  assert.equal(bottomInsetOf({ windowHeight: 844, viewTop: 100, viewHeight: 710 }), 34);
  assert.equal(bottomInsetOf({ windowHeight: 844, viewTop: 100, viewHeight: 800 }), 0);
});
