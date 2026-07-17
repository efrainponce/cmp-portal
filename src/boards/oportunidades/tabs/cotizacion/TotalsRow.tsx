import type { ItemDTO } from '../../../../lib/api';
import { fmtMoney } from '../../../../lib/format';
import { COL } from '../../../../lib/costeoCalc';
import {
  type GridCol, type RowEditState, EMPTY_ROW, numFrom, marginColor,
  MARGEN_COL, SUBTOTAL_COL, IVA_COL, TOTAL_CON_IVA_COL, COSTO_TOTAL_ROW_COL, UTILIDAD_TOTAL_COL,
} from './gridMeta';

/** Fila de totales alineada a la misma grid de columnas que el header/filas —
 * cada total cae exactamente debajo de su columna en vez de una barra aparte
 * (Efraín 2026-07-16: "los quiero abajo de cada columna"). Suma lo que ya
 * trae cada línea (Monday ya calculó subtotal/IVA/costo/utilidad por fila;
 * aquí solo se agregan); el Margen total es ponderado (utilidad total /
 * subtotal total), no el promedio simple de cada fila. Las columnas sin un
 * total con sentido (SKU, Etapa costeo, Moneda, C/U de costo…) quedan vacías. */
export function TotalsRow({ variant, visibleCols, products, rows }: {
  variant: 'venta' | 'costeo'; visibleCols: GridCol[]; products: ItemDTO[]; rows: Record<string, RowEditState>;
}) {
  let cantidad = 0, subtotal = 0, iva = 0, totalConIva = 0, costoTotal = 0, utilidadTotal = 0, margenGobTotal = 0;
  for (const p of products) {
    const state = rows[p.id] ?? EMPTY_ROW;
    cantidad += numFrom(state, p, COL.cantidad);
    subtotal += numFrom(state, p, SUBTOTAL_COL);
    iva += numFrom(state, p, IVA_COL);
    totalConIva += numFrom(state, p, TOTAL_CON_IVA_COL);
    costoTotal += numFrom(state, p, COSTO_TOTAL_ROW_COL);
    utilidadTotal += numFrom(state, p, UTILIDAD_TOTAL_COL);
    margenGobTotal += numFrom(state, p, COL.margenGobTotal);
  }
  const margenPct = subtotal > 0 ? (utilidadTotal / subtotal) * 100 : 0;
  // Igual que Margen: ponderado sobre el subtotal total, no el promedio simple
  // del % de cada fila.
  const margenGobPct = subtotal > 0 ? (margenGobTotal / subtotal) * 100 : 0;

  // colId -> { value, color? } — costeo reusa la posición de las columnas
  // "…C/U" (per-unit) para mostrar el gran total, ya que la grid no tiene una
  // columna de total de línea aparte.
  const byCol: Record<string, { value: string; color?: string }> =
    variant === 'venta'
      ? {
          [COL.cantidad]: { value: String(cantidad) },
          [SUBTOTAL_COL]: { value: fmtMoney(subtotal) },
          [IVA_COL]: { value: fmtMoney(iva) },
          [TOTAL_CON_IVA_COL]: { value: fmtMoney(totalConIva) },
        }
      : {
          [COL.cantidad]: { value: String(cantidad) },
          [COL.costoTotalUnit]: { value: fmtMoney(costoTotal) },
          [COL.precio]: { value: fmtMoney(subtotal) },
          [COL.margenGobPct]: { value: `${margenGobPct.toFixed(1)}%` },
          [MARGEN_COL]: { value: `${margenPct.toFixed(1)}%`, color: marginColor(margenPct) },
        };

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `1.8fr ${visibleCols.slice(1).map(() => '1fr').join(' ')}`,
      gap: 14, alignItems: 'center', padding: '12px 16px', background: 'var(--bg-sunken)',
      borderTop: '2px solid var(--border)',
    }}>
      {visibleCols.map((c, idx) => (
        <div
          key={c.id}
          style={{
            textAlign: c.align, font: 'var(--text-body-strong)',
            color: byCol[c.id]?.color ?? 'var(--ink)',
          }}
        >
          {idx === 0 ? 'TOTAL' : (byCol[c.id]?.value ?? '')}
        </div>
      ))}
    </div>
  );
}
