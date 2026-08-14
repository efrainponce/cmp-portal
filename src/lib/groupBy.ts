// Groups items by a status/dropdown column's value, using the column's own
// label/color metadata — used by Oportunidades (Etapa) and Costeo (Etapa Costeo).
import type { ColMeta, ItemDTO } from './api';
import { statusIndex } from './statusValue';

export interface ColumnGroup {
  key: string;
  label: string;
  color: string;
  items: ItemDTO[];
}

/** Case/acento-insensitive, para fusionar grupos cuyo texto visible es el
 * mismo aunque Monday los traiga bajo índices distintos (p. ej. una opción
 * archivada cuyo texto sobrevive en items viejos junto a la opción vigente
 * con el mismo label — ver "Cancelada" 2026-08-14, mismo patrón que el
 * índice 10 duplicado de "En Negociación"). */
function normalizeLabel(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

export function groupByColumn(
  items: ItemDTO[],
  col: ColMeta | undefined,
  fallbackLabel = 'Sin etapa',
  fallbackColor = '#9a958a',
  /** Explicit key order (e.g. Monday's real deal_stage pipeline order) —
   *  groups not listed here keep their natural (first-seen) order, after
   *  the listed ones. */
  order?: string[],
): ColumnGroup[] {
  const map = new Map<string, ColumnGroup>();
  for (const item of items) {
    const val = col ? item.cols[col.id] : undefined;
    const idx = statusIndex(val);
    const entry = col?.labels?.[idx];
    let key = idx;
    let label = entry?.label ?? fallbackLabel;
    if (!entry) {
      // Mirror-of-subitems columns (e.g. Etapa Costeo) fan in one value per
      // subitem as a raw comma-joined string — dedupe to the distinct set so
      // "Listo, Listo, Listo" from 20 different opportunities merges into
      // one "Listo" group instead of one group per exact repeat count.
      const parts = Array.from(new Set((val?.text ?? '').split(',').map((s) => s.trim()).filter(Boolean)));
      if (parts.length > 0) { key = parts.join(', '); label = key; }
    }
    const color = entry?.color ?? fallbackColor;
    if (!map.has(key)) map.set(key, { key, label, color, items: [] });
    map.get(key)!.items.push(item);
  }
  // Fusiona grupos cuyo label normalizado coincide (mismo texto, índice
  // distinto): promueve el key/color "oficial" (el que aparece en `order`,
  // si alguno) para que la tarjeta fusionada siga ordenándose y coloreándose
  // como la etapa real, no como el índice huérfano.
  const merged = new Map<string, ColumnGroup>();
  for (const g of map.values()) {
    const normKey = normalizeLabel(g.label);
    const existing = merged.get(normKey);
    if (!existing) { merged.set(normKey, g); continue; }
    existing.items.push(...g.items);
    if (order?.includes(g.key) && !order.includes(existing.key)) {
      existing.key = g.key;
      existing.color = g.color;
    }
  }
  const groups = Array.from(merged.values());
  if (!order) return groups;
  const rank = (key: string) => { const i = order.indexOf(key); return i === -1 ? order.length : i; };
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g.key) - rank(b.g.key) || a.i - b.i)
    .map(({ g }) => g);
}
