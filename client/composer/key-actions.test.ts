import assert from "node:assert/strict";
import test from "node:test";
import { resolveComposerKey } from "./key-actions.ts";

const key = (over: Partial<Parameters<typeof resolveComposerKey>[0]>) => resolveComposerKey({ key: "Escape", primary: false, shift: false, alt: false, focus: "input", dictation: "idle", isAgentRunning: true, isCancelling: false, canCycleMode: false, ...over });

test("Escape cancels a recording before it would stop the agent, and stops nothing from another input or dialog", () => {
  assert.equal(key({ dictation: "recording" }), "dictation-cancel");
  assert.equal(key({ focus: "pane" }), "interrupt");
  assert.equal(key({ focus: "outside" }), null);
});

test("Cmd/Ctrl+D toggles dictation and Enter while recording confirms and sends", () => {
  assert.equal(key({ key: "d", primary: true, focus: "pane" }), "dictation-toggle");
  assert.equal(key({ key: "Enter", dictation: "recording" }), "dictation-send");
  assert.equal(key({ key: "Enter" }), null);
});

test("Shift+Tab in the message box cycles the agent's mode when it has modes to cycle", () => {
  assert.equal(key({ key: "Tab", shift: true, canCycleMode: true }), "mode-cycle");
  assert.equal(key({ key: "Tab", shift: true, canCycleMode: true, focus: "pane" }), null);
  assert.equal(key({ key: "Tab", shift: true }), null);
});
