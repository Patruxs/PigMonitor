import assert from "node:assert/strict";
import test from "node:test";
import { restoreComposerIfEmpty, rewoundImageOf } from "./rewind-restore.ts";

test("a rewind puts the prompt's text and images back into an empty composer and leaves a started draft alone", () => {
  const image = rewoundImageOf({ id: "i1" }, "data:image/jpeg;base64,AAAA", 0);
  assert.deepEqual(image.kind === "image" ? [image.metadata.mimeType, image.metadata.dataUrl] : null, ["image/jpeg", "data:image/jpeg;base64,AAAA"]);
  const rewound = { text: "look at this", attachments: [image] };
  assert.deepEqual(restoreComposerIfEmpty({ text: "", attachments: [] }, rewound), rewound);
  const draft = { text: "half typed", attachments: [] };
  assert.equal(restoreComposerIfEmpty(draft, rewound), draft);
});
