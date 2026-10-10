import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { attachmentText, bodyWithAttachments, bodyWithImages, saveImages, uploadTooLarge } from "./attach.ts";
import { forgeAttachment, MAX_UPLOAD_BYTES } from "../shared/attach.ts";

test("an image sent as mail is saved under the session's folder and its path is in the body", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "piggery-attach-"));
  try {
    const files = await saveImages(root, "01PEER", [{ data: Buffer.from("png bytes").toString("base64"), mimeType: "image/png" }]);
    assert.equal(files.length, 1);
    assert.equal(path.dirname(files[0]), path.join(root, "01PEER"));
    assert.ok(files[0].endsWith(".png"));
    assert.equal(readFileSync(files[0], "utf8"), "png bytes");
    assert.equal(bodyWithImages("look", files), `look\n[image: ${files[0]}]`);
    assert.equal(bodyWithImages("  ", files), `[image: ${files[0]}]`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("files and issues or PRs sent as mail are appended to the body as Paseo renders them for an agent", () => {
  const file = { type: "uploaded_file" as const, id: "upload_1", fileName: "notes.txt", mimeType: "text/plain", size: 5, path: "/home/u/.paseo/uploads/upload_1/notes.txt" };
  const pr = forgeAttachment({ number: 7, title: "Fix the menu", url: "https://github.com/o/r/pull/7", state: "open", body: "Body of PR", labels: [], baseRefName: "main", headRefName: "fix", kind: "change_request" });
  const issue = forgeAttachment({ forge: "gitlab", number: 3, title: "Broken", url: "https://gitlab.com/o/r/-/issues/3", state: "open", body: null, labels: [], kind: "issue" });
  assert.equal(
    bodyWithAttachments("see these", [file, pr, issue]),
    [
      "see these",
      "Uploaded file: notes.txt\nPath: /home/u/.paseo/uploads/upload_1/notes.txt\nMIME: text/plain\nSize: 5 bytes",
      "GitHub PR #7: Fix the menu\nhttps://github.com/o/r/pull/7\nBase: main\nHead: fix\n\nBody of PR",
      "GitLab Issue #3: Broken\nhttps://gitlab.com/o/r/-/issues/3",
    ].join("\n\n"),
  );
  assert.equal(bodyWithAttachments("", [file]), attachmentText(file));
});

test("an upload over Paseo's 50MB limit is refused before it reaches the daemon", () => {
  assert.equal(uploadTooLarge("big.bin", Buffer.alloc(MAX_UPLOAD_BYTES).toString("base64")), null);
  assert.match(uploadTooLarge("big.bin", Buffer.alloc(MAX_UPLOAD_BYTES + 1).toString("base64")) ?? "", /big\.bin is too large/);
});
