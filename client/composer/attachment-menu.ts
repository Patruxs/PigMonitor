export type AttachmentChoiceId = "image" | "paste-image" | "github" | "file";

export interface AttachmentChoice {
  id: AttachmentChoiceId;
  enabled: boolean;
}

export function attachmentChoices(native: boolean, canAttach: boolean): AttachmentChoice[] {
  const local = !native && canAttach;
  return [{ id: "image", enabled: local }, ...(native ? [{ id: "paste-image" as const, enabled: false }] : []), { id: "github", enabled: true }, { id: "file", enabled: local }];
}
