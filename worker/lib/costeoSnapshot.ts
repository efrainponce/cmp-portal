// worker/lib/costeoSnapshot.ts — el snapshot de costos de una línea de
// cotización: qué se congela (costo, descuento, gastos, IVA, tipo de cambio y
// precio sugerido) y de dónde sale (los espejos del catálogo que la propia
// línea ya trae). Ids verificados contra shared/column-meta.gen.ts, sección
// "oportunidades_sub" — mismos que validar_costeo.py.
//
// Vivía dentro de worker/lib/costeo.ts, donde solo lo usaba "Mandar a costeo".
// Se separó porque la Zona Efrain lo necesita ANTES: ahí la misma persona
// cotiza, costea y aprueba de un jalón, así que el costeo se estampa en cuanto
// se elige el producto (Efraín, 2026-08-19) — ver worker/lib/nativeMirrors.ts.
// Módulo HOJA a propósito: nativeMirrors.ts no puede importar costeo.ts
// (costeo → outbox → nativeMirrors cerraría un ciclo de imports).
import { COLUMN_META } from '../../shared/column-meta.gen';
import type { RawColumn } from './canon';
import { cvNum, cvText, type MondayCol } from './monday';

// SCOL_* = lecturas (espejos del catálogo en la línea).
export const SCOL_COSTO = 'lookup_mm5ck4b3';            // Costo (auto)
export const SCOL_MONEDA = 'lookup_mm11t8gj';           // Moneda
export const SCOL_DESCUENTO = 'lookup_mm0bdwb5';        // Descuento (auto) — fracción 0-1
export const SCOL_GASTOS = 'lookup_mm0bbz02';           // Gastos % (auto) — fracción 0-1
export const SCOL_PRODUCTO_NOMBRE = 'lookup_mm0x4kda';  // Nombre del Producto (mirror)
export const SCOL_SKU = 'lookup_mkzn7x9a';              // SKU (auto)

// SNAP_* = columnas EDITABLES donde se congela el valor.
export const SNAP_NOMBRE = 'text_mm0bkm1j';   // mismo id que SUB_PRODUCTO_TXT — doble uso
export const SNAP_SKU = 'text_mm0bxy39';
export const SNAP_COSTO = 'numeric_mm0bph99';
export const SNAP_DESC_PCT = 'numeric_mkzn2q51';
export const SNAP_GAST_PCT = 'numeric_mkzngs9x';
export const SNAP_IVA = 'numeric_mm0cg0bm';
export const SNAP_TC = 'numeric_mm0rvhgs';
export const SNAP_PRECIO = 'numeric_mm2qzzbe';  // "Precio de Venta (formula)" — DISTINTO
                                                 // de numeric_mkzneg3d (Precio de Venta
                                                 // C/U, solo-admin, shared/visibility.ts).

export const IVA_DEFAULT = '16';

export interface SnapshotValues {
  nombre: string;
  sku: string;
  costo: number;
  descPct: number;
  gastPct: number;
  tc: number;
  precio: number;
}

/** precio = (1+gastos%)·(costo·(1-desc%))·TC·1.3 — TC=18 si Moneda es USD, 1 si no.
 * Mirror 1:1 de validar_costeo.py's compute_snapshot_values. */
export function computeSnapshot(cols: MondayCol[]): SnapshotValues {
  const costo = cvNum(cols, SCOL_COSTO);
  const descFrac = cvNum(cols, SCOL_DESCUENTO);
  const gastosFrac = cvNum(cols, SCOL_GASTOS);
  const tc = cvText(cols, SCOL_MONEDA).toUpperCase() === 'USD' ? 18 : 1;
  const precio = Math.round((1 + gastosFrac) * (costo * (1 - descFrac)) * tc * 1.3 * 100) / 100;
  return {
    nombre: cvText(cols, SCOL_PRODUCTO_NOMBRE),
    sku: cvText(cols, SCOL_SKU),
    costo, descPct: Math.round(descFrac * 100), gastPct: Math.round(gastosFrac * 100), tc, precio,
  };
}

/** El snapshot como `column_values` de Monday (id → texto). */
export function snapshotColumnValues(snap: SnapshotValues): Record<string, string> {
  return {
    [SNAP_NOMBRE]: snap.nombre,
    [SNAP_SKU]: snap.sku,
    [SNAP_COSTO]: String(snap.costo),
    [SNAP_DESC_PCT]: String(snap.descPct),
    [SNAP_GAST_PCT]: String(snap.gastPct),
    [SNAP_IVA]: IVA_DEFAULT,
    [SNAP_TC]: String(snap.tc),
    [SNAP_PRECIO]: String(snap.precio),
  };
}

const tipoDe = (id: string): string => COLUMN_META.oportunidades_sub[id]?.type ?? 'text';

/** El mismo snapshot en shape de mirror, para una línea NATIVA (no hay echo de
 * Monday que lo convierta). El `type` sale de la metadata real del board —
 * `numbers`, no `numeric`: serialize.ts solo parsea el `value` de los tipos que
 * Monday manda de verdad (PARSE_VALUE_TYPES), y una línea con el tipo mal
 * escrito llega al front sin `value`. */
export function snapshotRawCols(snap: SnapshotValues): RawColumn[] {
  return Object.entries(snapshotColumnValues(snap)).map(([id, text]) => ({
    id, type: tipoDe(id), text, value: JSON.stringify(text),
  }));
}

/** Las columnas NUMÉRICAS del snapshot en blanco — para una línea nativa cuyo
 * producto nuevo no trae costo en el catálogo: dejar el costo del producto
 * anterior sería peor que no tener ninguno. Nombre y SKU no se limpian: esos
 * los reescribe el propio cambio de producto. */
export function snapshotEmptyCols(): RawColumn[] {
  return [SNAP_COSTO, SNAP_DESC_PCT, SNAP_GAST_PCT, SNAP_IVA, SNAP_TC, SNAP_PRECIO]
    .map(id => ({ id, type: tipoDe(id), text: '', value: null }));
}
