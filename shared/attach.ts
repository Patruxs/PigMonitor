import type { AttachmentData, ForgeItemData } from "./rpc.ts";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const FORGES: Record<string, { displayName: string; changeRequestAbbrev: string; changeRequestNumberPrefix: string }> = {
  github: { displayName: "GitHub", changeRequestAbbrev: "PR", changeRequestNumberPrefix: "#" },
  gitlab: { displayName: "GitLab", changeRequestAbbrev: "MR", changeRequestNumberPrefix: "!" },
  gitea: { displayName: "Gitea", changeRequestAbbrev: "PR", changeRequestNumberPrefix: "#" },
  forgejo: { displayName: "Forgejo", changeRequestAbbrev: "PR", changeRequestNumberPrefix: "#" },
  codeberg: { displayName: "Codeberg", changeRequestAbbrev: "PR", changeRequestNumberPrefix: "#" },
};

export function forgeOf(id: string) {
  return FORGES[id] ?? { displayName: id, changeRequestAbbrev: "PR", changeRequestNumberPrefix: "#" };
}

export function forgeAttachment(item: ForgeItemData): AttachmentData {
  const common = { forge: item.forge ?? "github", number: item.number, title: item.title, url: item.url, ...(item.body ? { body: item.body } : {}), ...(item.projectPath ? { projectPath: item.projectPath } : {}) };
  if (item.kind === "change_request") return { type: "forge_change_request", mimeType: "application/paseo-forge-change-request", ...common, ...(item.baseRefName ? { baseRefName: item.baseRefName } : {}), ...(item.headRefName ? { headRefName: item.headRefName } : {}) };
  return { type: "forge_issue", mimeType: "application/paseo-forge-issue", ...common };
}
