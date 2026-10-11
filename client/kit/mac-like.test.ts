import assert from "node:assert/strict";
import test from "node:test";
import { isMacLike } from "./mac-like.ts";

test("Apple keyboards use ⌘ for find and focus on a Mac, an iPad and an iPhone alike, and Ctrl elsewhere", () => {
  assert.deepEqual([{ platform: "MacIntel" }, { platform: "iPad" }, { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }, { platform: "Win32" }, { platform: "Linux x86_64" }, undefined].map(isMacLike), [true, true, true, false, false, false]);
});
