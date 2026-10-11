import assert from "node:assert/strict";
import test from "node:test";
import { attachmentChoices } from "./attachment-menu.ts";

test("on native the sheet lists Paseo's items with only issue/PR live; on web it lists them all live, without Paste image", () => {
  const shown = (native: boolean, canAttach: boolean) => attachmentChoices(native, canAttach).map((c) => `${c.id}:${c.enabled ? "live" : "off"}`);
  assert.deepEqual(shown(true, false), ["image:off", "paste-image:off", "github:live", "file:off"]);
  assert.deepEqual(shown(false, true), ["image:live", "github:live", "file:live"]);
});
