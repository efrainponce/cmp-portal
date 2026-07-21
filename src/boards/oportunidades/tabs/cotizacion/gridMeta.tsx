// Metadata compartida de la grid de Cotización: ids de columnas de Monday,
// definición de columnas por variante (venta/costeo), helpers puros de formato
// y el estado de edición por fila. Cada columna está keyed a su id real de
// Monday; columnas que el rol del viewer no puede ver simplemente no vienen en
// `cols` y se saltan (el server ya las filtra — docs/dev-contracts.md).
import type { ColVal, ItemDTO } from '../../../../lib/api';
import { fmtMoney } from '../../../../lib/format';
import { COL } from '../../../../lib/costeoCalc';
import { EMB_STATUS_COL } from '../../../../../shared/embellecimiento';
export { EMB_STATUS_COL, EMB_LABEL_CON, EMB_LABEL_SIN } from '../../../../../shared/embellecimiento';

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
export const DESCRIPCION_COL = 'lookup_mm0xw8p7';     // mirror: Descripción Cotización (fuente: Productos long_text_mm0xse7v)
export const TALLAS_COL = 'lookup_mm19c0b6';          // mirror: Tallas (fuente: Productos long_text_mm174q0j "Tallas JSON")
// Fuente real de los dos mirrors de arriba, en el catálogo de Productos — fallback
// mientras el mirror asíncrono del subitem no se ha poblado todavía.
export const CATALOGO_DESCRIPCION_COL = 'long_text_mm0xse7v';
export const CATALOGO_TALLAS_COL = 'long_text_mm174q0j';
// "Descripción y tallas confirmadas" — checkbox en Productos (18395657591), creada
// 2026-07-18. Vive en el catálogo por SKU, no por línea (Efraín: la ficha es del
// producto, no de la cotización) — Compras la marca y eso desbloquea "Mandar a
// Validación de costeo" (worker/lib/costeo.ts checkValidacion).
export const PRODUCTO_CONFIRM_COL = 'boolean_mm5cqtjs';
export const COLOR_COL = 'text_mm07s2mg';
export const COLORES_DISP_COL = 'lookup_mkznm0h3';    // mirror: colores disponibles del producto ligado (asíncrono)
export const PRODUCTO_COLOR_DROPDOWN_COL = 'dropdown_mkztty4b'; // Color del producto en el catálogo — misma
// fuente que valida enviarCosteo. Se lee directo del `catalog` ya cargado en memoria (sin esperar
// al mirror asíncrono del subitem, que solo se puebla después de que Monday recompute la relación).

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

// Determina qué columnas son editables inline. `lineEdits` = true en "Nueva
// oportunidad" (stage 4) y sobre un borrador de versión (vigente sin costear,
// recién duplicada con "+ Nueva versión" — Efraín, 2026-07-17): vendedor edita
// producto/color/cantidad/embellecimiento inline. En una vigente ya costeada
// esos cambios requieren duplicar primero.
// Precio: NUNCA editable por vendedor (solo vía cmp-tallas costeo/admin).
// Costos: solo compras/admin.
export function inlineEditableCols(lineEdits: boolean): Set<string> {
  const base = new Set<string>([
    COL.costoDistr, COL.descuentoPct, COL.conversion, COL.gastosPct, COL.margenGobPct, ETAPA_COSTEO_COL,
  ]);
  if (lineEdits) {
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
  /** Ancho fijo en px — todas las columnas salvo la primera (Producto, que se
   * queda flexible) usan un ancho angosto y real en vez de repartir el
   * espacio en partes iguales (`1fr` por columna). Con 16 columnas en Costeo
   * eso estiraba cada celda/chip mucho más de lo que su contenido necesita
   * y la grid se sentía "amplia" — Efraín, 2026-07-21: quiere ver casi toda
   * la grid sin scroll horizontal. Ver `colsTemplate`. */
  width: number;
}

export const GRID_COLS_COSTEO: GridCol[] = [
  { id: 'lookup_mm0x4kda', label: 'Producto', align: 'left', kind: 'text', width: 170 },
  { id: 'lookup_mkzn7x9a', label: 'SKU', align: 'left', kind: 'text', width: 80 },
  { id: 'numeric_mkzm6399', label: 'Cant.', align: 'left', kind: 'text', width: 55 },
  { id: ETAPA_COSTEO_COL, label: 'Etapa costeo', align: 'left', kind: 'text', width: 100 },
  { id: 'lookup_mm11t8gj', label: 'Moneda', align: 'left', kind: 'text', width: 55 },
  { id: 'numeric_mm0bph99', label: 'Costo distr. C/U', align: 'right', kind: 'money', width: 88 },
  { id: 'numeric_mkzn2q51', label: 'Desc. %', align: 'right', kind: 'percent', width: 65 },
  { id: 'formula_mkzngnjm', label: 'Costo real C/U', align: 'right', kind: 'money', width: 88 },
  { id: 'numeric_mm0rvhgs', label: 'Conversión', align: 'right', kind: 'text', width: 75 },
  { id: 'numeric_mkzngs9x', label: 'Gastos %', align: 'right', kind: 'percent', width: 65 },
  { id: 'numeric_mm0gxvpa', label: 'Costo embell. C/U', align: 'right', kind: 'money', width: 88 },
  { id: 'formula_mkznpfgg', label: 'Costo total C/U', align: 'right', kind: 'money', width: 88 },
  { id: 'numeric_mm2qzzbe', label: 'P. venta sugerido', align: 'right', kind: 'money', width: 92 },
  { id: 'numeric_mkzneg3d', label: 'P. venta', align: 'right', kind: 'money', width: 82 },
  { id: 'numeric_mkznnm5s', label: 'Margen Gob %', align: 'right', kind: 'percent', width: 82 },
  { id: 'formula_mkznpw5p', label: 'Margen', align: 'right', kind: 'percent', width: 72 },
];

// Ancho fijo de la columna "Avisos" al final de la grid — siempre presente
// como pista real (header, cada fila y TotalsRow la definen), nunca un
// espacio condicional: cuando el warning aparecía solo como celda opcional
// al final de la fila, una línea sin problemas no reservaba ese espacio y
// las columnas se sentían "desalineadas" fila a fila (Efraín, 2026-07-21:
// "esta desalineado cuando esta o no con error"). Con una pista de ancho
// fijo siempre reservada, cada fila mide exactamente igual tenga o no aviso.
export const WARNINGS_COL_WIDTH = 150;

// Genera el `gridTemplateColumns` para la porción de columnas de datos
// (sin el # de línea, que header/fila/TotalsRow anteponen aparte con
// `28px` según haga falta). Todas las pistas son anchos fijos (Producto con
// un tope, el resto su ancho real) — sin ninguna pista `fr` de relleno.
// Junto con `gridWrapStyle` (`width: fit-content` puesto directo en el propio
// `display:grid`, no en un wrapper aparte — anidar el fit-content en un
// bloque plano que envuelve al grid es fresco entre navegadores y causó un
// bug real, ver commit de "esta desalineado…"), la tabla mide exactamente lo
// que ocupan sus columnas: angosta en "Nueva oportunidad" (pocas columnas,
// sin hueco antes de Avisos), y en Costeo (16 columnas) se desborda del
// contenedor con scroll horizontal en vez de encogerse — es responsive por
// construcción, no por media queries (Efraín, 2026-07-21: "que la tabla
// llegue hasta avisos y se corte, que sea responsive").
export function colsTemplate(cols: GridCol[]): string {
  const [first, ...rest] = cols;
  const firstW = first?.width ?? 160;
  return `minmax(${firstW}px, ${Math.max(firstW, 340)}px) ${rest.map((c) => `${c.width}px`).join(' ')} ${WARNINGS_COL_WIDTH}px`;
}

// Puesto directo en el elemento `display:grid` (header, cada fila, TotalsRow)
// — no en un `<div>` de fondo que lo envuelva — para que el fit-content se
// calcule sobre el propio grid (mismos tracks, mismo padding) y no dependa
// de cómo un bloque padre propague el tamaño intrínseco de un hijo anidado.
export const gridWrapStyle: React.CSSProperties = { width: 'fit-content' };

export const PRECIO_VENTA_COL = 'numeric_mkzneg3d';

// Mostrar/ocultar columnas en Costeo/Validación de Costeo — preferencia
// personal del viewer, no un permiso (eso ya lo filtra el server vía
// ColMeta.w/visibility.ts). Persistida en localStorage, misma para ambos
// boards ya que comparten GRID_COLS_COSTEO (Efraín, 2026-07-21).
const HIDDEN_COLS_KEY = 'cmp:costeoHiddenCols';

export function loadHiddenCols(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_COLS_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

export function saveHiddenCols(hidden: Set<string>) {
  localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify([...hidden]));
}

// Ventas-side view: no cost breakdown, just what the customer is quoted.
export const GRID_COLS_VENTA: GridCol[] = [
  { id: 'lookup_mm0x4kda', label: 'Producto', align: 'left', kind: 'text', width: 200 },
  { id: 'lookup_mkzn7x9a', label: 'SKU', align: 'left', kind: 'text', width: 80 },
  { id: COLOR_COL, label: 'Color', align: 'left', kind: 'text', width: 150 },
  { id: 'numeric_mkzm6399', label: 'Cant.', align: 'left', kind: 'text', width: 65 },
  { id: EMB_STATUS_COL, label: 'Con Embellecimiento', align: 'left', kind: 'text', width: 170 },
  { id: PRECIO_VENTA_COL, label: 'P. venta C/U', align: 'right', kind: 'money', width: 95 },
  { id: SUBTOTAL_COL, label: 'Subtotal', align: 'right', kind: 'money', width: 100 },
  { id: IVA_COL, label: 'IVA', align: 'right', kind: 'money', width: 90 },
  { id: TOTAL_CON_IVA_COL, label: 'Total c/IVA', align: 'right', kind: 'money', width: 105 },
];

// Sin costeo todavía no hay precios vigentes que mostrar — en "Nueva
// oportunidad" (o un borrador de versión sin costear, mismo trato que
// `lineEdits`) se ocultan en vez de enseñar columnas vacías/sin sentido
// (Efraín, 2026-07-20).
export const MONEY_COLS = new Set([PRECIO_VENTA_COL, SUBTOTAL_COL, IVA_COL, TOTAL_CON_IVA_COL]);

// Mismo fallback que worker/lib/quoteVersions.ts's productoNombre(): el mirror
// (lookup_mm0x4kda) solo se puebla cuando hay relación real a Productos; sin
// relación, cae al texto libre (text_mm0bkm1j). `preview` gana primero — es el
// valor recién guardado antes de que el mirror asíncrono de Monday lo confirme.
export function displayProducto(product: ItemDTO, preview?: Record<string, ColVal>): string {
  return preview?.[PRODUCTO_COL]?.text || product.cols[PRODUCTO_COL]?.text || product.cols[PRODUCTO_TXT_COL]?.text || '';
}

// Mismo shape que worker/lib/dal.ts's linkedItemId — {linked_item_ids:[...]} ya viene
// parseado en `value` porque board_relation está en serialize.ts's PARSE_VALUE_TYPES.
export function linkedProductoId(row: ItemDTO): number | null {
  const val = row.cols[PRODUCTO_REL_COL]?.value as { linked_item_ids?: unknown[] } | undefined;
  const first = (val?.linked_item_ids ?? []).map(Number).find(Number.isFinite);
  return first ?? null;
}

// true solo si el producto de catálogo ligado ya tiene el checkbox de Compras
// marcado — usado para el badge "Sin confirmar" en la fila colapsada (Efraín,
// 2026-07-18: la confirmación no se veía sin expandir cada línea).
export function productoConfirmado(row: ItemDTO, catalog: ItemDTO[]): boolean {
  const id = linkedProductoId(row);
  if (id == null) return false;
  const catalogItem = catalog.find((c) => Number(c.id) === id);
  return !!catalogItem?.cols[PRODUCTO_CONFIRM_COL]?.text;
}

// Chevron de detalle — más prominente que un texto suelto (Efraín, 2026-07-18:
// "no se ve mucho"): tamaño mayor, color de tinta plena y un target de click real.
export function chevronButtonStyle(expanded: boolean): React.CSSProperties {
  return {
    background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
    marginRight: 4, marginLeft: -4, font: '700 15px \'Inter\', sans-serif', color: 'var(--ink)',
    transform: expanded ? 'rotate(90deg)' : undefined, display: 'inline-block', lineHeight: 1,
  };
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

// Blanco + borde de acento — a propósito distinto del chip gris plano de las
// celdas de solo lectura (`valueChipStyle`): en Validación de Costeo, por
// ejemplo, P. venta es la ÚNICA celda editable de toda la fila y con el
// mismo tono que el resto no se notaba que ahí sí se podía escribir
// (Efraín, 2026-07-21: "no parece que P. venta es lo único que podemos
// editar").
export const inputStyle: React.CSSProperties = {
  width: '100%', font: 'var(--text-caption)', color: 'var(--ink)',
  border: '1px solid var(--accent)', background: '#fff',
  borderRadius: 'var(--radius-md)', padding: '5px 7px',
  textAlign: 'right', boxSizing: 'border-box',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
};

// Chip gris redondeado para celdas de solo lectura — mismo tratamiento visual
// que `inputStyle` (misma pill) para que editable/no-editable se sientan
// parte de la misma grid, imitando una referencia de diseño más simple que
// la grid original con bordes/mayúsculas (Efraín, 2026-07-20). Padding angosto
// a propósito — con columnas de ancho fijo (`colsTemplate`) el chip ya no
// necesita "rellenar" espacio de sobra (Efraín, 2026-07-21: quiere la grid
// compacta, ver casi todo sin scroll horizontal).
export const valueChipStyle: React.CSSProperties = {
  background: 'var(--bg-sunken)', borderRadius: 'var(--radius-md)', padding: '5px 7px',
  boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

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

// Detecta problemas en una línea de cotización — retorna una lista de warnings
// o array vacío si la línea está completa. Se usa para mostrar un indicador
// visual (⚠️) al inicio de la fila.
export function getLineWarnings(
  product: ItemDTO,
  state: RowEditState,
  variant: 'venta' | 'costeo',
  catalog: ItemDTO[],
  // true en Validación de Costeo — ahí lo único editable es Precio de Venta,
  // así que el único problema posible es que siga vacío. Los checks de
  // Costeo (producto/cantidad/costeo pendiente/confirmación) no aplican: esa
  // línea ya pasó por Costeo para llegar aquí (Efraín, 2026-07-21: "Sin
  // confirmar" es solo de Costeo, no de Validación).
  precioOnly = false,
): string[] {
  if (precioOnly) {
    const precio = numFrom(state, product, PRECIO_VENTA_COL);
    return precio > 0 ? [] : ['Falta precio'];
  }

  const warnings: string[] = [];
  const displayProd = displayProducto(product, state.preview);

  // Siempre requerido: producto
  if (!displayProd?.trim()) {
    warnings.push('Falta producto');
  }

  // En venta: color es requerido si hay producto
  if (variant === 'venta' && displayProd?.trim()) {
    const color = state.editing[COLOR_COL] ?? product.cols[COLOR_COL]?.text ?? '';
    if (!color.trim()) {
      warnings.push('Falta color');
    }
  }

  // En venta: ficha comercial (Compras la sube al catálogo) — mismo check que
  // validateLinea en el server (worker/lib/costeo.ts), reflejado aquí para que
  // el aviso viva en la línea y no solo en el pre-chequeo del botón.
  if (variant === 'venta' && displayProd?.trim() && !(product.cols[DESCRIPCION_COL]?.text ?? '').trim()) {
    warnings.push('Falta descripción');
  }

  // Siempre requerido: cantidad
  const cantRaw = state.editing['numeric_mkzm6399'] ?? product.cols['numeric_mkzm6399']?.text ?? '';
  const cantNum = parseFloat(cantRaw);
  if (!Number.isFinite(cantNum) || cantNum <= 0) {
    warnings.push('Falta cantidad');
  }

  // En costeo: debe tener costo distribuido asignado
  if (variant === 'costeo' && !product.cols[COSTO_DISTR_COL]?.text) {
    warnings.push('Pendiente de costeo');
  }

  // En costeo: producto debe estar confirmado
  if (variant === 'costeo' && !productoConfirmado(product, catalog)) {
    warnings.push('Sin confirmar');
  }

  return warnings;
}
