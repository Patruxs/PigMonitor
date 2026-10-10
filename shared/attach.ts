import { FORGES, type Forge } from "./forge-refs.ts";
import type { AttachmentData, ForgeItemData } from "./rpc.ts";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const IMAGE_MARK = /^\[image: (\/[^\]\n]+)\]/;

export function imageMark(path: string): string {
  return `[image: ${path}]`;
}

export function markedImage(text: string): { path: string; length: number } | undefined {
  const mark = IMAGE_MARK.exec(text);
  return mark ? { path: mark[1].trim(), length: mark[0].length } : undefined;
}

export function splitImageMarks(text: string): { text: string; paths: string[] } {
  const paths: string[] = [];
  const lines = text.split("\n").filter((line) => {
    const trimmed = line.trim();
    const image = markedImage(trimmed);
    if (!image || image.length !== trimmed.length) return true;
    paths.push(image.path);
    return false;
  });
  return { text: lines.join("\n").trim(), paths };
}

export function forgeOf(id: string): Pick<Forge, "displayName" | "changeRequestAbbrev" | "changeRequestNumberPrefix"> {
  return FORGES.find((forge) => forge.id === id) ?? { displayName: id, changeRequestAbbrev: "PR", changeRequestNumberPrefix: "#" };
}

export function forgeAttachment(item: ForgeItemData): AttachmentData {
  const common = { forge: item.forge ?? "github", number: item.number, title: item.title, url: item.url, ...(item.body ? { body: item.body } : {}), ...(item.projectPath ? { projectPath: item.projectPath } : {}) };
  if (item.kind === "change_request") return { type: "forge_change_request", mimeType: "application/paseo-forge-change-request", ...common, ...(item.baseRefName ? { baseRefName: item.baseRefName } : {}), ...(item.headRefName ? { headRefName: item.headRefName } : {}) };
  return { type: "forge_issue", mimeType: "application/paseo-forge-issue", ...common };
}
