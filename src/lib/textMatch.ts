// Accent/case-insensitive text matching for instant client-side search —
// the server's q param doesn't cover every column yet (see StageBoardList).
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function textIncludes(haystack: string, needle: string): boolean {
  if (!needle.trim()) return true;
  return normalizeText(haystack).includes(normalizeText(needle));
}

/** Solo letras y dígitos: "OC-317", "oc 317", "#317" y "OC317" quedan igual
 * de comparables. También sirve de llave para nombres que el nombre de archivo
 * sanea distinto ("CASTAÑEDA" vs "CASTANEDA", "5.11" vs "5 11"). */
export function compactText(s: string): string {
  return normalizeText(s).replace(/[^a-z0-9]/g, '');
}

/** Buscador tolerante: cada palabra tiene que aparecer en algún campo, tal
 * cual o sin guiones/espacios/# (así "#317" y "oc317" encuentran "OC-317"). */
export function searchMatches(campos: string[], q: string): boolean {
  const palabras = q.trim().split(/\s+/).filter(Boolean);
  return palabras.every((p) => {
    const c = compactText(p);
    return campos.some((t) => textIncludes(t, p) || (c.length > 0 && compactText(t).includes(c)));
  });
}
