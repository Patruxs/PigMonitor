import type { ComposerAttachment } from "./attachment.ts";

export interface ComposerContent {
  text: string;
  attachments: ComposerAttachment[];
}

export function restoreComposerIfEmpty(current: ComposerContent, rewound: ComposerContent): ComposerContent {
  return current.text.length > 0 || current.attachments.length > 0 ? current : rewound;
}

export function rewoundImageOf(image: { id: string; mimeType?: string }, dataUrl: string, now: number): ComposerAttachment {
  const mimeType = image.mimeType ?? /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? "image/png";
  return { kind: "image", metadata: { id: `rewound_${image.id}`, mimeType, dataUrl, fileName: null, byteSize: null, createdAt: now } };
}
