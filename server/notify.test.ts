import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { notifyHooksSet } from "./notify.ts";

test("notify counts as set up only when hooks/notify.d holds an executable file, as the daemon runs them", () => {
  const home = mkdtempSync(path.join(tmpdir(), "pigmonitor-notify-"));
  assert.equal(notifyHooksSet(home), false);
  const dir = path.join(home, "hooks", "notify.d");
  mkdirSync(path.join(dir, "folder"), { recursive: true });
  writeFileSync(path.join(dir, "notes.txt"), "");
  chmodSync(path.join(dir, "notes.txt"), 0o644);
  assert.equal(notifyHooksSet(home), false);
  writeFileSync(path.join(dir, "desktop"), "#!/bin/sh\n");
  chmodSync(path.join(dir, "desktop"), 0o700);
  assert.equal(notifyHooksSet(home), true);
});
