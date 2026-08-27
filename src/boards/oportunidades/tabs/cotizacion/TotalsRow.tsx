import type { ItemDTO } from '../../../../lib/api';
import { fmtMoney } from '../../../../lib/format';
import { COL } from '../../../../lib/costeoCalc';
import {
  type GridCol, type RowEditState, EMPTY_ROW, numFrom, marginColor, colsTemplate, gridWrapStyle,
  MARGEN_COL, SUBTOTAL_COL, IVA_COL, TOTAL_CON_IVA_COL, COSTO_TOTAL_ROW_COL, UTILIDAD_TOTAL_COL,
  STICKY_PRODUCTO_STYLE,
} from './gridMeta';

/** Fila de totales alineada a la misma grid de columnas que el header/filas —
 * cada total cae exactamente debajo de su columna en vez de una barra aparte
 * (Efraín 2026-07-16: "los quiero abajo de cada columna"). Suma lo que ya
 * trae cada línea (Monday ya calculó subtotal/IVA/costo/utilidad por fila;
 * aquí solo se agregan); la Utilidad % total es ponderada (utilidad total /
 * subtotal total), no el promedio simple de cada fila. Las columnas sin un
 * total con sentido (SKU, Etapa costeo, Moneda, C/U de costo…) quedan vacías. */
export function TotalsRow({ variant, visibleCols, products, rows, isMobile = false, showActionsCol = false }: {
  variant: 'venta' | 'costeo'; visibleCols: GridCol[]; products: ItemDTO[]; rows: Record<string, RowEditState>;
  isMobile?: boolean;
  /** Mismo gate que canAddLines en CotizacionTab — agrega la columna final
   * fija de 32px que QuoteRow usa para el ícono 🗑, así los totales siguen
   * alineados con el header/filas (Efraín, 2026-08-13). */
  showActionsCol?: boolean;
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
  // ¿Llegó siquiera la columna de Margen Gob Total? Para quien no está en la
  // whitelist de utilidades (shared/visibility.ts) NO viaja, así que su total
  // sumaba 0 y esta fila pintaba un "0.0%" en Margen Gob % — un dato falso
  // justo donde se acaba de esconder el verdadero. Se mira el DATO y no
  // `visibleCols` para que esconder la columna a mano (el picker "Columnas") no
  // cambie el cálculo, solo dónde cae.
  const hayMargenGob = products.some(p => p.cols[COL.margenGobTotal] !== undefined);
  const margenPct = subtotal > 0 ? (utilidadTotal / subtotal) * 100 : 0;
  // Igual que Utilidad %: ponderado sobre el subtotal total, no el promedio
  // simple del % de cada fila.
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
          // Subtotal/IVA/Total c/IVA también en Costeo (Efraín, 2026-07-30) —
          // el mismo agregado que ya se calculaba arriba para la vista de
          // Venta, que aquí se tiraba a la basura por no tener columnas donde
          // caer. El total de venta colgaba de la columna "P. venta" (que es
          // C/U) como sustituto del Subtotal que no existía; ahora vive bajo
          // Subtotal, su columna real — si no, el mismo número salía dos veces
          // en celdas contiguas.
          [SUBTOTAL_COL]: { value: fmtMoney(subtotal) },
          [IVA_COL]: { value: fmtMoney(iva) },
          [TOTAL_CON_IVA_COL]: { value: fmtMoney(totalConIva) },
          ...(hayMargenGob ? {
            [COL.margenGobPct]: { value: `${margenGobPct.toFixed(1)}%` },
            [COL.margenGobTotal]: { value: fmtMoney(margenGobTotal) },
          } : {}),
          [UTILIDAD_TOTAL_COL]: { value: fmtMoney(utilidadTotal), color: marginColor(margenPct) },
          [MARGEN_COL]: { value: `${margenPct.toFixed(1)}%`, color: marginColor(margenPct) },
        };

  if (isMobile) {
    const entries = visibleCols.slice(1).filter((c) => byCol[c.id]?.value);
    return (
      <div style={{
        padding: '14px', background: 'var(--bg-sunken)', borderTop: '2px solid var(--border)',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px',
      }}>
        <div style={{ gridColumn: '1 / -1', font: 'var(--text-body-strong)', color: 'var(--ink)' }}>TOTAL</div>
        {entries.map((c) => (
          <div key={c.id} style={{ minWidth: 0 }}>
            <div style={{
              font: '700 9px \'Inter\', sans-serif', color: 'var(--ink-tertiary)',
              textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 4,
            }}>
              {c.label}
            </div>
            <div style={{ font: 'var(--text-body-strong)', color: byCol[c.id]?.color ?? 'var(--ink)' }}>
              {byCol[c.id]?.value}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{
      ...gridWrapStyle,
      // El `28px` inicial no es decorativo: header y filas de datos tienen esa
      // columna extra para el # de línea que esta fila de totales no usa —
      // sin ella, cada total quedaba una columna completa a la izquierda de
      // donde debía (Efraín, 2026-07-21: "los totales no cuadran con las
      // columnas").
      display: 'grid', gridTemplateColumns: `28px ${colsTemplate(visibleCols)}${showActionsCol ? ' 32px' : ''}`,
      gap: 6, alignItems: 'center', padding: '10px', background: 'var(--bg-sunken)',
      borderTop: '2px solid var(--border)',
    }}>
      <div />
      {visibleCols.map((c, idx) => (
        <div
          key={c.id}
          style={{
            // Los totales son siempre números (o la etiqueta "TOTAL" en la
            // primera celda) — se alinean a la derecha sin importar `c.align`,
            // que es la alineación de la COLUMNA (p.ej. Cant. es 'left' para
            // el input de esa celda en las filas de datos, pero el total de
            // Cant. es un número y se ve raro pegado a la izquierda mientras
            // los demás totales están a la derecha (Efraín, 2026-07-21).
            textAlign: idx === 0 ? 'left' : 'right', font: 'var(--text-body-strong)',
            color: byCol[c.id]?.color ?? 'var(--ink)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            ...(idx === 0 ? { ...STICKY_PRODUCTO_STYLE, background: 'var(--bg-sunken)' } : undefined),
          }}
        >
          {idx === 0 ? 'TOTAL' : (byCol[c.id]?.value ?? '')}
        </div>
      ))}
      {showActionsCol && <div />}
    </div>
  );
}
