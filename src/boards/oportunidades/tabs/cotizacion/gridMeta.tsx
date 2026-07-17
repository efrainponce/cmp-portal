// Metadata compartida de la grid de Cotización: ids de columnas de Monday,
// definición de columnas por variante (venta/costeo), helpers puros de formato
// y el estado de edición por fila. Cada columna está keyed a su id real de
// Monday; columnas que el rol del viewer no puede ver simplemente no vienen en
// `cols` y se saltan (el server ya las filtra — docs/dev-contracts.md).
import type { ColVal, ItemDTO } from '../../../../lib/api';
import { fmtMoney } from '../../../../lib/format';
import { COL } from '../../../../lib/costeoCalc';

export const COSTO_DISTR_COL = 'numeric_mm0bph99';
export const ETAPA_COSTEO_COL = 'color_mm084gvf';
export const SUGERIDO_COL = 'numeric_mm2qzzbe';       // P. venta sugerido (auto) — vacío en muchas líneas
export const MARGEN_COL = 'formula_mkznpw5p';         // Margen % (utilidad/subtotal)
export const SUBTOTAL_COL = 'formula_mkznmjh6';
export const IVA_COL = 'formula_mm0rtdqp';
export const TOTAL_CON_IVA_COL = 'formula_mm00xy0n';
export const COSTO_TOTAL_ROW_COL = 'formula_mkznrm5a';   // Costo Total de la línea (costoTotalUnit × cantidad)
export const UTILIDAD_TOTAL_COL = 'formula_mkznry25';    // Utilidad Total de la línea

export const PRODUCTO_COL = 'lookup_mm0x4kda';        // mirror del producto ligado — solo lectura directa
export const PRODUCTO_TXT_COL = 'text_mm0bkm1j';      // Producto (texto libre) — fallback sin catálogo
export const PRODUCTO_REL_COL = 'board_relation_mkzmafgp'; // relación real a Productos — puebla el mirror
export const COLOR_COL = 'text_mm07s2mg';
export const COLORES_DISP_COL = 'lookup_mkznm0h3';    // mirror: colores disponibles del producto ligado (asíncrono)
export const PRODUCTO_COLOR_DROPDOWN_COL = 'dropdown_mkztty4b'; // Color del producto en el catálogo — misma
// fuente que valida enviarCosteo. Se lee directo del `catalog` ya cargado en memoria (sin esperar
// al mirror asíncrono del subitem, que solo se puebla después de que Monday recompute la relación).

// Mismo status column y labels que worker/lib/quoteVersions.ts (SUB_EMB_STATUS) —
// marcar "Con Embellecimiento" aquí es lo que hace que la línea aparezca en la
// tab Embellecimientos (EmbellecimientosTab filtra por este mismo label).
export const EMB_STATUS_COL = 'color_mm1b34bg';
export const EMB_LABEL_CON = 'Con Embellecimiento';
export const EMB_LABEL_SIN = 'Sin Embellecimiento';

// Rojo <0%, amarillo <20%, verde ≥20% — mismo criterio para una línea o para
// el total agregado (Efraín, 2026-07-16).
export function marginColor(pct: number): string {
  if (pct < 0) return '#ce3048';
  if (pct < 20) return '#e99729';
  return '#00b461';
}

// Cuando cmp-tallas todavía no generó el Precio de Venta sugerido (columna
// vacía), se ofrece un fallback calculado con la misma fórmula de Margen que
// ya usa el resto del tab: Margen% = 1 − MargenGob% − CostoTotalC/U/Precio.
// Se despeja Precio para Margen% = 23 — un ancla útil mientras compras decide
// el precio real (Efraín, 2026-07-16).
export function suggestedPrecio23(costoTotalUnit: number, margenGobPct: number): number | undefined {
  const denom = 1 - 0.23 - margenGobPct / 100;
  if (denom <= 0 || costoTotalUnit <= 0) return undefined;
  return costoTotalUnit / denom;
}

// Determina qué columnas son editables inline según la etapa de la oportunidad.
// En "Nueva oportunidad" (stage 4): vendedor edita producto/color/cantidad/embellecimiento inline.
// En otras etapas: esos cambios SOLO vía "Nueva versión" (archivable, dispara costeo).
// Precio: NUNCA editable por vendedor (solo vía cmp-tallas costeo/admin).
// Costos: solo compras/admin.
export function inlineEditableCols(stage: string | undefined, allowLineEdits: boolean): Set<string> {
  const base = new Set<string>([
    COL.costoDistr, COL.descuentoPct, COL.conversion, COL.gastosPct, COL.margenGobPct, ETAPA_COSTEO_COL,
  ]);
  if (stage === '4' && allowLineEdits) { // Nueva oportunidad
    base.add(PRODUCTO_COL);
    base.add(COLOR_COL);
    base.add(COL.cantidad);
    base.add(EMB_STATUS_COL);
  }
  return base;
}

// Colores reales de la columna status "Etapa Costeo" en Monday (settings_str),
// no inventados — docs/monday-column-map.md.
export const ETAPA_COSTEO_COLORS: Record<string, { color: string; tint: string }> = {
  'No iniciado': { color: '#68737d', tint: '#e6e9eb' },
  'En curso': { color: '#e99729', tint: '#fdecd7' },
  'Listo': { color: '#00b461', tint: '#d6f5e6' },
  'Detenido': { color: '#ce3048', tint: '#fbdbdf' },
  'Modificado': { color: '#3db0df', tint: '#dbf0fa' },
};

export interface GridCol {
  id: string;
  label: string;
  align: 'left' | 'right';
  kind: 'text' | 'money' | 'percent';
}

export const GRID_COLS_COSTEO: GridCol[] = [
  { id: 'lookup_mm0x4kda', label: 'Producto', align: 'left', kind: 'text' },
  { id: 'lookup_mkzn7x9a', label: 'SKU', align: 'left', kind: 'text' },
  { id: 'numeric_mkzm6399', label: 'Cant.', align: 'left', kind: 'text' },
  { id: ETAPA_COSTEO_COL, label: 'Etapa costeo', align: 'left', kind: 'text' },
  { id: 'lookup_mm11t8gj', label: 'Moneda', align: 'left', kind: 'text' },
  { id: 'numeric_mm0bph99', label: 'Costo distr. C/U', align: 'right', kind: 'money' },
  { id: 'numeric_mkzn2q51', label: 'Desc. %', align: 'right', kind: 'percent' },
  { id: 'formula_mkzngnjm', label: 'Costo real C/U', align: 'right', kind: 'money' },
  { id: 'numeric_mm0rvhgs', label: 'Conversión', align: 'right', kind: 'text' },
  { id: 'numeric_mkzngs9x', label: 'Gastos %', align: 'right', kind: 'percent' },
  { id: 'numeric_mm0gxvpa', label: 'Costo embell. C/U', align: 'right', kind: 'money' },
  { id: 'formula_mkznpfgg', label: 'Costo total C/U', align: 'right', kind: 'money' },
  { id: 'numeric_mm2qzzbe', label: 'P. venta sugerido', align: 'right', kind: 'money' },
  { id: 'numeric_mkzneg3d', label: 'P. venta', align: 'right', kind: 'money' },
  { id: 'numeric_mkznnm5s', label: 'Margen Gob %', align: 'right', kind: 'percent' },
  { id: 'formula_mkznpw5p', label: 'Margen', align: 'right', kind: 'percent' },
];

// Ventas-side view: no cost breakdown, just what the customer is quoted.
export const GRID_COLS_VENTA: GridCol[] = [
  { id: 'lookup_mm0x4kda', label: 'Producto', align: 'left', kind: 'text' },
  { id: 'lookup_mkzn7x9a', label: 'SKU', align: 'left', kind: 'text' },
  { id: COLOR_COL, label: 'Color', align: 'left', kind: 'text' },
  { id: 'numeric_mkzm6399', label: 'Cant.', align: 'left', kind: 'text' },
  { id: EMB_STATUS_COL, label: 'Con Embellecimiento', align: 'left', kind: 'text' },
  { id: 'numeric_mkzneg3d', label: 'P. venta C/U', align: 'right', kind: 'money' },
  { id: 'formula_mkznmjh6', label: 'Subtotal', align: 'right', kind: 'money' },
  { id: 'formula_mm0rtdqp', label: 'IVA', align: 'right', kind: 'money' },
  { id: 'formula_mm00xy0n', label: 'Total c/IVA', align: 'right', kind: 'money' },
];

// Mismo fallback que worker/lib/quoteVersions.ts's productoNombre(): el mirror
// (lookup_mm0x4kda) solo se puebla cuando hay relación real a Productos; sin
// relación, cae al texto libre (text_mm0bkm1j). `preview` gana primero — es el
// valor recién guardado antes de que el mirror asíncrono de Monday lo confirme.
export function displayProducto(product: ItemDTO, preview?: Record<string, ColVal>): string {
  return preview?.[PRODUCTO_COL]?.text || product.cols[PRODUCTO_COL]?.text || product.cols[PRODUCTO_TXT_COL]?.text || '';
}

export function cellValue(col: GridCol, val?: ColVal): string {
  if (!val || val.text === '') return '—';
  if (col.kind === 'money') {
    const n = Number(val.value ?? val.text);
    return Number.isNaN(n) ? val.text : fmtMoney(n);
  }
  if (col.kind === 'percent') {
    const n = Number(val.value ?? val.text);
    return Number.isNaN(n) ? val.text : `${n}%`;
  }
  return val.text;
}

export const inputStyle: React.CSSProperties = {
  width: '100%', font: 'var(--text-label)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 6, padding: '6px 9px',
  textAlign: 'right', boxSizing: 'border-box',
};

const warningStyle: React.CSSProperties = {
  font: 'var(--text-caption)', color: '#9c4c3d', marginTop: 3,
};

export function RowWarning({ children }: { children: React.ReactNode }) {
  return <div style={warningStyle}>⚠ {children}</div>;
}

export interface RowEditState {
  editing: Record<string, string>;   // colId -> in-progress raw text
  preview: Record<string, ColVal>;   // colId -> locally recomputed formula preview
  saving: Record<string, boolean>;   // colId -> PATCH in flight
  error?: string;
}

export const EMPTY_ROW: RowEditState = { editing: {}, preview: {}, saving: {} };

// Lee el valor numérico de una columna para una fila, con el mismo criterio de
// prioridad preview-primero que el resto del tab (preview = recién editado
// localmente, antes de que el refetch confirme el valor real de Monday).
export function numFrom(state: RowEditState, product: ItemDTO, colId: string): number {
  const v = state.preview[colId] ?? product.cols[colId];
  const n = Number(v?.value ?? v?.text);
  return Number.isFinite(n) ? n : 0;
}
