import { useCallback, useMemo, useState } from "react";
import type { NativeSyntheticEvent, TextInputSelectionChangeEventData } from "react-native";
import { readDraft } from "./drafts.ts";

export function useComposerText(draftKey: string | undefined) {
  const initial = useMemo(() => (draftKey === undefined ? { text: "", attachments: [] } : readDraft(draftKey)), []);
  const [value, setValue] = useState(initial.text);
  const [cursor, setCursor] = useState(initial.text.length);

  const replaceText = useCallback((next: string) => {
    setValue(next);
    setCursor(next.length);
  }, []);

  const onSelectionChange = (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => setCursor(event.nativeEvent.selection?.start ?? 0);

  return { initial, value, setValue, cursor, setCursor, replaceText, onSelectionChange };
}
