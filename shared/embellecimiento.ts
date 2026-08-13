// Shared with worker (per-zone image upload validation, createOportunidad) and
// frontend (zone list rendering) — mirrors validar_costeo.py's
// `_parse_embellecimiento` template in cmp-tallas.
export const EMBELL_TEMPLATE_KEYS = [
  'Espalda',
  'Frente derecho',
  'Frente izquierdo',
  'Manga derecha/costado derecho',
  'Manga izquierda/costado izquierdo',
  'Etiqueta del fabricante',
  'Etiqueta de propiedad',
  'Otros',
] as const;

export type EmbellZoneKey = typeof EMBELL_TEMPLATE_KEYS[number];

// Mismo status column (oportunidades_sub) que worker/lib/quoteVersions.ts
// (SUB_EMB_STATUS) y src/boards/oportunidades/tabs/cotizacion/gridMeta.tsx
// (EMB_STATUS_COL) — marcar "Con Embellecimiento" es lo que hace que la línea
// aparezca en la tab Embellecimientos.
export const EMB_STATUS_COL = 'color_mm1b34bg';
export const EMB_LABEL_CON = 'Con Embellecimiento';
export const EMB_LABEL_SIN = 'Sin Embellecimiento';

export interface EmbellZone {
  label: string;
  value: string;
}

/** Parse "key:value,,key:value,,..." into {key: value}, keeping the first
 * non-empty value on duplicate keys. Tolerates a leading "\n,," separator. */
export function parseEmbellecimiento(raw: string | undefined | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw) return result;
  const pairs = raw.replace(/\n,,/g, ',,').split(',,');
  for (const pair of pairs) {
    const trimmed = pair.trim();
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in result) || (!result[key] && value)) {
      result[key] = value;
    }
  }
  return result;
}

/** Explodes raw embellecimiento text into the 8 template zones, in order.
 * Pass `onlyFilled: true` to drop zones without a value (matches the PDF's
 * display rule in confirm_tallas.py). */
export function explodeEmbellecimiento(raw: string | undefined | null, onlyFilled = false): EmbellZone[] {
  const parsed = parseEmbellecimiento(raw);
  const zones = EMBELL_TEMPLATE_KEYS.map((label) => ({ label, value: parsed[label] ?? '' }));
  return onlyFilled ? zones.filter((z) => z.value) : zones;
}

/** Inverse of parseEmbellecimiento — serializes back to "key:value,,key:value,,..."
 * (only filled zones, template order) so callers can write a new position back
 * to Monday's long_text_mm1bj4pt without disturbing the other zones' text. */
export function serializeEmbellecimiento(zones: Record<string, string>): string {
  return EMBELL_TEMPLATE_KEYS
    .filter((key) => zones[key])
    .map((key) => `${key}:${zones[key]}`)
    .join(',,');
}

/** Sets/overwrites one zone's value on top of the raw text already stored, keeping
 * every other zone intact — used when the vendedor agrega/edita una posición. */
export function upsertEmbellZone(raw: string | undefined | null, zone: string, value: string): string {
  const current = parseEmbellecimiento(raw);
  current[zone] = value;
  return serializeEmbellecimiento(current);
}

/** Repara embellecimiento agregando las claves de plantilla que falten, preservando
 * las que ya tienen valor — solo si al menos una clave reconocida ya trae algo (si
 * no, no hay nada que preservar y se deja tal cual). Mirror 1:1 de
 * validar_costeo.py's `_try_repair_embellecimiento` (worker/lib/costeo.ts la usa en
 * el flujo nativo de "Mandar a costeo"): separador "\n,," y TODAS las claves de
 * plantilla, aunque queden vacías — a propósito distinto de serializeEmbellecimiento
 * (",," y solo zonas con valor), que sirve para el flujo de edición manual. */
export function repairEmbellecimiento(raw: string | undefined | null): { text: string; repaired: boolean } {
  if (!raw || !raw.trim()) return { text: raw ?? '', repaired: false };
  const parsed = parseEmbellecimiento(raw);
  const hasKnownValue = EMBELL_TEMPLATE_KEYS.some((k) => parsed[k]);
  if (!hasKnownValue) return { text: raw, repaired: false };
  const missing = EMBELL_TEMPLATE_KEYS.filter((k) => !(k in parsed));
  if (missing.length === 0) return { text: raw, repaired: false };
  const repaired = EMBELL_TEMPLATE_KEYS.map((k) => `${k}:${parsed[k] ?? ''}`).join('\n,,');
  return { text: repaired, repaired: true };
}

/** Error legible si el embellecimiento no cumple la plantilla completa; `null` si
 * está OK (incluye "vacío", que no bloquea — la línea sin texto de embellecimiento
 * no es un error de por sí). Mirror 1:1 de validar_costeo.py's
 * `_validate_embellecimiento`, corrida sobre el texto YA reparado por
 * repairEmbellecimiento. */
export function embellecimientoTemplateError(raw: string | undefined | null): string | null {
  if (!raw || !raw.trim()) return null;
  const parsed = parseEmbellecimiento(raw);
  const missing = EMBELL_TEMPLATE_KEYS.filter((k) => !(k in parsed));
  if (missing.length > 0) return `Embellecimiento incompleto (faltan: ${missing.slice(0, 2).join(', ')}).`;
  if (!Object.values(parsed).some((v) => v)) return 'Embellecimiento debe tener al menos un valor.';
  return null;
}
