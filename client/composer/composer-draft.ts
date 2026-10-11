import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { registerComposerRestore } from "../chat/rewind.tsx";
import type { ComposerAttachment } from "./attachment.ts";
import { saveDraft } from "./drafts.ts";
import { restoreComposerIfEmpty, type ComposerContent } from "./rewind-restore.ts";

export function useComposerDraft({ draftKey, value, attachments, setValue, setCursor, setAttachments, focusInput }: { draftKey: string | undefined; value: string; attachments: ComposerAttachment[]; setValue: (value: string) => void; setCursor: (cursor: number) => void; setAttachments: Dispatch<SetStateAction<ComposerAttachment[]>>; focusInput: () => void }): void {
  const content = useRef<ComposerContent>({ text: value, attachments });
  content.current = { text: value, attachments };

  useEffect(() => {
    if (draftKey !== undefined) saveDraft(draftKey, { text: value, attachments });
  }, [draftKey, value, attachments]);

  useEffect(() => {
    if (draftKey === undefined) return;
    return registerComposerRestore(draftKey, (rewound) => {
      const next = restoreComposerIfEmpty(content.current, rewound);
      if (next !== content.current) {
        setValue(next.text);
        setCursor(next.text.length);
        setAttachments(next.attachments);
      }
      focusInput();
    });
  }, [draftKey, focusInput]);
}
