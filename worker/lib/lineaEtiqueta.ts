// worker/lib/lineaEtiqueta.ts — Cómo se nombra una LÍNEA (subitem) para una
// persona: "Producto · Color" en Oportunidades, "Producto · Color · Talla" en
// Proyectos. Pura y sin dependencias: la usan el feed de Actualizaciones
// (updatesLineas.ts) y el aviso de un comentario sobre una línea
// (updateNotify.ts), que no debe arrastrar las lecturas a Monday.
import type { MirrorItem } from '../../shared/types';
import type { BoardSlug } from '../../shared/boards';

// Qué columnas nombran la línea en cada board de subitems: el `name` del
// subitem es un número ("1") en Oportunidades, no sirve de etiqueta.
const ETIQUETA_COLS: Partial<Record<BoardSlug, { producto: string[]; extra: string[] }>> = {
  oportunidades_sub: { producto: ['text_mm0bkm1j', 'lookup_mm0x4kda'], extra: ['text_mm07s2mg'] },
  proyectos_sub: { producto: ['text_mm0hs17x'], extra: ['text_mm0h4a1c', 'text_mm1antcb'] },
};

export function colTexts(row: Pick<MirrorItem, 'columns'>): Map<string, string> {
  const out = new Map<string, string>();
  try {
    for (const c of JSON.parse(row.columns || '[]') as { id: string; text?: string | null }[]) {
      const t = (c.text ?? '').trim();
      if (t) out.set(c.id, t);
    }
  } catch { /* columnas corruptas → sin etiqueta, cae al name */ }
  return out;
}

/** "Botiquín IFAK-002M · Negro" — producto (texto, o el espejo del catálogo)
 * más color/talla. Sin producto, el name del subitem. */
export function etiquetaLinea(childSlug: BoardSlug, row: Pick<MirrorItem, 'name' | 'columns'>): string {
  const cfg = ETIQUETA_COLS[childSlug];
  const texts = colTexts(row);
  const producto = cfg?.producto.map(id => texts.get(id)).find(Boolean) ?? row.name;
  const extra = (cfg?.extra ?? []).map(id => texts.get(id)).filter(Boolean);
  return [producto, ...extra].join(' · ');
}
