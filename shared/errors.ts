export function messageOf(error: unknown, fallback?: string): string {
  if (fallback !== undefined) return error instanceof Error ? error.message : fallback;
  return String((error as Error | null | undefined)?.message ?? error);
}
