/** Iniciales para las burbujas de persona: "Angel Omar Canto Cural" → "AC";
 * una sola palabra → sus dos primeras letras. Compartido por PersonAvatar
 * (listas) y el feed de Actualizaciones. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
