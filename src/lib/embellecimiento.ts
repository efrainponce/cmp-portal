// Mirrors validar_costeo.py's `_parse_embellecimiento` in cmp-tallas: the
// subitem's long_text_mm1bj4pt column stores "key:value,,key:value,,..." —
// explode it into the fixed 8-zone template so the UI can render one row per
// zone instead of dumping the raw joined string.
export { EMBELL_TEMPLATE_KEYS } from '../../shared/embellecimiento';
import { EMBELL_TEMPLATE_KEYS } from '../../shared/embellecimiento';

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
 * (only filled zones, template order) so the portal can write a new position back
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
