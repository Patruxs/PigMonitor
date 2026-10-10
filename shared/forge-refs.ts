export interface ForgeRef {
  kind: "change_request" | "issue";
  number: number;
}

type ReferencePath = { kind: ForgeRef["kind"]; infix: string };

const GITHUB_PATHS: ReferencePath[] = [
  { kind: "change_request", infix: "/pull/" },
  { kind: "issue", infix: "/issues/" },
];
const GITLAB_PATHS: ReferencePath[] = [
  { kind: "change_request", infix: "/-/merge_requests/" },
  { kind: "issue", infix: "/-/issues/" },
];
const GITEA_PATHS: ReferencePath[] = [
  { kind: "change_request", infix: "/pulls/" },
  { kind: "issue", infix: "/issues/" },
];

export interface Forge {
  id: string;
  displayName: string;
  changeRequestAbbrev: string;
  changeRequestNumberPrefix: string;
  cloudHosts: string[];
  referencePaths: ReferencePath[];
}

export const FORGES: Forge[] = [
  { id: "github", displayName: "GitHub", changeRequestAbbrev: "PR", changeRequestNumberPrefix: "#", cloudHosts: ["github.com", "ssh.github.com"], referencePaths: GITHUB_PATHS },
  { id: "gitlab", displayName: "GitLab", changeRequestAbbrev: "MR", changeRequestNumberPrefix: "!", cloudHosts: ["gitlab.com"], referencePaths: GITLAB_PATHS },
  { id: "gitea", displayName: "Gitea", changeRequestAbbrev: "PR", changeRequestNumberPrefix: "#", cloudHosts: ["gitea.com"], referencePaths: GITEA_PATHS },
  { id: "forgejo", displayName: "Forgejo", changeRequestAbbrev: "PR", changeRequestNumberPrefix: "#", cloudHosts: [], referencePaths: GITEA_PATHS },
  { id: "codeberg", displayName: "Codeberg", changeRequestAbbrev: "PR", changeRequestNumberPrefix: "#", cloudHosts: ["codeberg.org"], referencePaths: GITEA_PATHS },
];

const WEB_URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/giu;
const TRAILING_SENTENCE_PUNCTUATION = /[.,;:!]+$/u;
const TRANSPORTS = new Set(["https:", "http:", "ssh:"]);

function normalizeHost(host: string): string {
  return host.trim().replace(/\.+$/u, "").toLowerCase();
}

function normalizeRemotePath(path: string): string | null {
  let normalized = path.trim().replace(/^\/+|\/+$/gu, "");
  if (normalized.endsWith(".git")) normalized = normalized.slice(0, -4);
  return normalized || null;
}

function isValidRemoteHost(host: string): boolean {
  return /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(host);
}

export function parseGitRemote(remoteUrl: string): { host: string; path: string } | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;
  const scpLike = trimmed.includes("://") ? null : trimmed.match(/^[^@]+@([^:]+):(.+)$/u);
  if (scpLike) {
    const host = normalizeHost(scpLike[1] ?? "");
    const path = normalizeRemotePath(scpLike[2] ?? "");
    return isValidRemoteHost(host) && path ? { host, path } : null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!TRANSPORTS.has(parsed.protocol.toLowerCase())) return null;
  const host = normalizeHost(parsed.hostname);
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  const normalizedPath = normalizeRemotePath(path);
  return isValidRemoteHost(host) && normalizedPath ? { host, path: normalizedPath } : null;
}

export function forgeRefKey(ref: ForgeRef): string {
  return `${ref.kind}:${ref.number}`;
}

export function extractForgeRefs(text: string | null | undefined, remoteUrl: string | null | undefined): ForgeRef[] {
  const remote = remoteUrl ? parseGitRemote(remoteUrl) : null;
  const body = text?.trim();
  if (!remote || !body) return [];
  const webHosts = new Set([remote.host]);
  const forgeIds = new Set<string>();
  for (const forge of FORGES) {
    const cloudHosts = forge.cloudHosts.map(normalizeHost);
    if (!cloudHosts.includes(remote.host)) continue;
    forgeIds.add(forge.id);
    for (const host of cloudHosts) webHosts.add(host);
  }
  const referencePaths = FORGES.flatMap((forge) => (forgeIds.size === 0 || forgeIds.has(forge.id) ? forge.referencePaths : []));
  const refs: ForgeRef[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(WEB_URL_PATTERN)) {
    let candidate: URL;
    try {
      candidate = new URL(match[0].replace(TRAILING_SENTENCE_PUNCTUATION, ""));
    } catch {
      continue;
    }
    if ((candidate.protocol !== "http:" && candidate.protocol !== "https:") || !webHosts.has(normalizeHost(candidate.hostname))) continue;
    let pathname: string;
    try {
      pathname = decodeURIComponent(candidate.pathname);
    } catch {
      continue;
    }
    for (const referencePath of referencePaths) {
      const prefix = `/${remote.path}${referencePath.infix}`;
      if (!pathname.toLowerCase().startsWith(prefix.toLowerCase())) continue;
      const numberText = pathname.slice(prefix.length).match(/^(\d+)(?:\/|$)/u)?.[1];
      if (!numberText) continue;
      const number = Number.parseInt(numberText, 10);
      if (!Number.isSafeInteger(number) || number <= 0) continue;
      const ref = { kind: referencePath.kind, number };
      if (!seen.has(forgeRefKey(ref))) {
        seen.add(forgeRefKey(ref));
        refs.push(ref);
      }
      break;
    }
  }
  return refs;
}
