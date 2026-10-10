import assert from "node:assert/strict";
import test from "node:test";
import { extractForgeRefs } from "./forge-refs.ts";

test("only issue and PR links of the checkout's own repository are found", () => {
  const text = "fix https://github.com/acme/app/pull/12, see https://github.com/acme/app/issues/7. and https://github.com/other/repo/pull/3";
  assert.deepEqual(extractForgeRefs(text, "git@github.com:acme/app.git"), [
    { kind: "change_request", number: 12 },
    { kind: "issue", number: 7 },
  ]);
  assert.deepEqual(extractForgeRefs(text, null), []);
});

test("GitLab merge requests use its own path", () => {
  assert.deepEqual(extractForgeRefs("https://gitlab.com/g/p/-/merge_requests/5", "https://gitlab.com/g/p.git"), [{ kind: "change_request", number: 5 }]);
});
