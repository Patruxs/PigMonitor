import assert from "node:assert/strict";
import test from "node:test";
import { imagesIn, parseInline, parseMarkdown, splitMarkdownBlocks } from "./markdown.ts";

test("blocks: headings, paragraphs, nested lists, fenced code, quotes and rules", () => {
  const source = ["# Title", "", "Some text", "on two lines.", "", "- one", "  - nested", "- two", "", "3. third", "4. fourth", "", "```ts", "const a = 1;", "", "- not a list", "```", "> quoted **bold**", "", "---"].join("\n");
  assert.deepEqual(parseMarkdown(source), [
    { kind: "heading", level: 1, inlines: [{ kind: "text", text: "Title" }] },
    { kind: "paragraph", inlines: [{ kind: "text", text: "Some text\non two lines." }] },
    {
      kind: "list",
      ordered: false,
      start: 1,
      items: [
        [{ kind: "paragraph", inlines: [{ kind: "text", text: "one" }] }, { kind: "list", ordered: false, start: 1, items: [[{ kind: "paragraph", inlines: [{ kind: "text", text: "nested" }] }]] }],
        [{ kind: "paragraph", inlines: [{ kind: "text", text: "two" }] }],
      ],
    },
    { kind: "list", ordered: true, start: 3, items: [[{ kind: "paragraph", inlines: [{ kind: "text", text: "third" }] }], [{ kind: "paragraph", inlines: [{ kind: "text", text: "fourth" }] }]] },
    { kind: "code", lang: "ts", text: "const a = 1;\n\n- not a list" },
    { kind: "quote", blocks: [{ kind: "paragraph", inlines: [{ kind: "text", text: "quoted " }, { kind: "bold", children: [{ kind: "text", text: "bold" }] }] }] },
    { kind: "rule" },
  ]);
});

test("inline: bold, italic, code and links, leaving snake_case and lone stars alone", () => {
  assert.deepEqual(parseInline("**bold *it*** and `x_y` see [docs](https://a.b/c) snake_case_name 2 * 3 * 4"), [
    { kind: "bold", children: [{ kind: "text", text: "bold " }, { kind: "italic", children: [{ kind: "text", text: "it" }] }] },
    { kind: "text", text: " and " },
    { kind: "code", text: "x_y" },
    { kind: "text", text: " see " },
    { kind: "link", href: "https://a.b/c", children: [{ kind: "text", text: "docs" }] },
    { kind: "text", text: " snake_case_name 2 * 3 * 4" },
  ]);
});

test("absolute image paths become images: markdown, bare, in backticks and attached; others stay text", () => {
  const inlines = parseInline("![shot](/tmp/a.png) see /tmp/folder-e2e/before.png, `/tmp/c.JPG` [image: /tmp/piggery-attach/x/d.webp] but not tmp/e.png, https://x.io/f.png or `/tmp/g.txt`");
  assert.deepEqual(imagesIn(inlines), ["/tmp/a.png", "/tmp/folder-e2e/before.png", "/tmp/c.JPG", "/tmp/piggery-attach/x/d.webp"]);
  assert.deepEqual(imagesIn(parseMarkdown("- **look:** /tmp/h.gif").flatMap((b) => (b.kind === "list" ? b.items[0].flatMap((i) => (i.kind === "paragraph" ? i.inlines : [])) : []))), ["/tmp/h.gif"]);
});

test("streamed assistant text splits into blocks only at blank lines outside code fences and lists, as Paseo's splitMarkdownBlocks", () => {
  assert.deepEqual(splitMarkdownBlocks("First paragraph\n\n\nSecond paragraph"), ["First paragraph", "Second paragraph"]);
  assert.deepEqual(splitMarkdownBlocks("Intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nOutro"), ["Intro", "```ts\nconst a = 1;\n\nconst b = 2;\n```", "Outro"]);
  assert.deepEqual(splitMarkdownBlocks("Before fence\n\n```ts\nconst a = 1;\n\nconst b = 2;"), ["Before fence", "```ts\nconst a = 1;\n\nconst b = 2;"]);
  assert.deepEqual(splitMarkdownBlocks("Before\n\n    ```\n    code\n    ```\n\nAfter"), ["Before", "    ```\n    code\n    ```", "After"]);
  assert.deepEqual(splitMarkdownBlocks("Before\n\n3. Outer three\n\n   7. Inner seven\n   8. Inner eight\n\nAfter"), ["Before", "3. Outer three\n\n   7. Inner seven\n   8. Inner eight", "After"]);
  assert.deepEqual(splitMarkdownBlocks(""), []);
});

test("tables and strikethrough, as GitHub markdown writes them", () => {
  assert.deepEqual(parseMarkdown("| a | b |\n|---|:-:|\n| 1 | ~~2~~ |"), [
    { kind: "table", head: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]], rows: [[[{ kind: "text", text: "1" }], [{ kind: "strike", children: [{ kind: "text", text: "2" }] }]]] },
  ]);
});

test("while an answer streams, its unfinished code span, bold and link already render as formatted; bare URLs link only when asked", () => {
  assert.deepEqual(parseMarkdown("run `npm te", { streaming: true }), [{ kind: "paragraph", inlines: [{ kind: "text", text: "run " }, { kind: "code", text: "npm te" }] }]);
  assert.deepEqual(parseMarkdown("this is **important", { streaming: true }), [{ kind: "paragraph", inlines: [{ kind: "text", text: "this is " }, { kind: "bold", children: [{ kind: "text", text: "important" }] }] }]);
  assert.deepEqual(parseMarkdown("see [the docs](https://exa", { streaming: true }), [{ kind: "paragraph", inlines: [{ kind: "text", text: "see the docs" }] }]);
  assert.deepEqual(parseMarkdown("run `npm te"), [{ kind: "paragraph", inlines: [{ kind: "text", text: "run `npm te" }] }]);
  assert.deepEqual(parseMarkdown("go to https://paseo.sh.", { linkify: true }), [{ kind: "paragraph", inlines: [{ kind: "text", text: "go to " }, { kind: "link", href: "https://paseo.sh", children: [{ kind: "text", text: "https://paseo.sh" }] }, { kind: "text", text: "." }] }]);
});
