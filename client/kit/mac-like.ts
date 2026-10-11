export function isMacLike(nav: { userAgent?: string; platform?: string } | undefined): boolean {
  return /Macintosh|Mac OS|iPhone|iPad|iPod/i.test(nav?.userAgent ?? "") || /Mac|iPhone|iPad|iPod/i.test(nav?.platform ?? "");
}
