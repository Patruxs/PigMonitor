import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { withPromptImages } from "../shared/chat/prompt-images.ts";
import { createUserMessage, type StreamItem, type UserMessageItem } from "../shared/stream/stream.ts";
import { pastedImageSaver } from "./image.ts";
import { PromptImageReader } from "./prompt-images.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function prompt(uuid: string, text: string, withImage: boolean): string {
  const content = withImage ? [{ type: "text", text }, { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }] : [{ type: "text", text }];
  return `${JSON.stringify({ type: "user", uuid, message: { role: "user", content } })}\n`;
}

function session(): { file: string; reader: PromptImageReader } {
  const dir = mkdtempSync(path.join(tmpdir(), "pigmonitor-prompt-images-"));
  return { file: path.join(dir, "session.jsonl"), reader: new PromptImageReader(pastedImageSaver(path.join(dir, "pasted"))) };
}

function userMessage(id: string, text: string): UserMessageItem {
  return createUserMessage({ clientMessageId: id, messageId: id, text, timestamp: new Date(0) });
}

function imagesOf(items: StreamItem[]): (string | undefined)[][] {
  return items.map((item) => (item.kind === "user_message" ? (item.images ?? []).map((image) => image.path) : []));
}

test("a prompt sent with an image from Paseo's own composer shows that image, though Paseo's timeline carries only its text", () => {
  const { file, reader } = session();
  const text = "found template slp mày là supervisor, nút new agent và new monitor";
  const meta = { type: "user", isMeta: true, uuid: "m1", message: { role: "user", content: [{ type: "text", text: "[Image: source: /tmp/claude-1000/images/1.png]" }] } };
  writeFileSync(file, prompt("u1", text, true) + `${JSON.stringify(meta)}\n`);
  const fromPaseo = userMessage("draft_msg_1791639493763_n4roxjqw6:initial-message", text);
  const [shown] = withPromptImages([fromPaseo], reader.prompts(file)) as UserMessageItem[];
  assert.equal(shown.images?.length, 1);
  assert.equal(readFileSync(shown.images?.[0]?.path as string).toString("base64"), PNG);
});

test("a prompt written to the session after the first read still gets its image", () => {
  const { file, reader } = session();
  writeFileSync(file, prompt("u1", "first", false));
  assert.deepEqual(reader.prompts(file), []);
  appendFileSync(file, prompt("u2", "second", true));
  const shown = withPromptImages([userMessage("c1", "first"), userMessage("c2", "second")], reader.prompts(file));
  assert.deepEqual(imagesOf(shown).map((paths) => paths.length), [0, 1]);
});

test("the same words sent again without an image leave the image on the message that had it", () => {
  const { file, reader } = session();
  writeFileSync(file, prompt("u1", "look", true) + prompt("u2", "look", false));
  const shown = withPromptImages([userMessage("c1", "look"), userMessage("c2", "look")], reader.prompts(file));
  assert.deepEqual(imagesOf(shown).map((paths) => paths.length), [1, 0]);
});

test("a session file replaced by another is read from its start, not from where the old one ended", () => {
  const { file, reader } = session();
  writeFileSync(file, prompt("u1", "old", true));
  assert.deepEqual(reader.prompts(file).map((p) => p.uuid), ["u1"]);
  writeFileSync(`${file}.next`, prompt("u8", "new", false) + prompt("u9", "newer", true));
  renameSync(`${file}.next`, file);
  assert.deepEqual(reader.prompts(file).map((p) => p.uuid), ["u8", "u9"]);
});
