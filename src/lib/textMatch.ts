// Accent/case-insensitive text matching for instant client-side search —
// the server's q param doesn't cover every column yet (see StageBoardList).
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function textIncludes(haystack: string, needle: string): boolean {
  if (!needle.trim()) return true;
  return normalizeText(haystack).includes(normalizeText(needle));
}
