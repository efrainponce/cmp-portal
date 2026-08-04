// Fila de la grid de cotización en desktop — gemela de MobileQuoteRow (mismo
// contrato de props y los mismos callbacks compartidos de CotizacionTab).
//
// Vivía inline dentro del `products.map()` de CotizacionTab, así que CUALQUIER
// cambio de estado del tab (una tecla en otra línea, un tick del poll de
// costeoReady cada 8s) volvía a ejecutar el render de TODAS las líneas, con su
// getLineWarnings y sus lookups de catálogo. Extraída y memoizada, una tecla en
// la línea 3 solo re-renderiza la línea 3.
//
// El memo depende de que CotizacionTab pase callbacks y colecciones estables
// (useCallback/useMemo allá) — si alguno vuelve a crearse por render, esto deja
// de memoizar en silencio.
import { memo } from 'react';
import type { ItemDTO } from '../../../../lib/api';
import { fmtMoney } from '../../../../lib/format';
import { MonoTag, StatusBadge } from '../../../../components/core/Badges';
import { COL } from '../../../../lib/costeoCalc';
import { LineDetailPanel } from './LineDetailPanel';
import { ProductPicker, type ProductoChoice } from '../../../../components/forms/ProductPicker';
import {
  type GridCol, type RowEditState, marginColor, suggestedPrecio23, numFrom, displayProducto, cellValue,
  inputStyle, valueChipStyle, ETAPA_COSTEO_COLORS, getLineWarnings, gridWrapStyle, colsTemplate,
  ETAPA_COSTEO_COL, SUGERIDO_COL, MARGEN_COL,
  PRODUCTO_COL, PRODUCTO_TXT_COL, PRODUCTO_REL_COL, COLOR_COL,
  EMB_STATUS_COL, EMB_LABEL_CON, EMB_LABEL_SIN,
  MONEDA_COL, MONEDA_LABELS, monedaDe,
  chevronButtonStyle, colorOptions,
} from './gridMeta';

export interface QuoteRowProps {
  product: ItemDTO;
  /** Número 1-based de la línea — mismo orden que los mensajes de validación
   * de costeo (worker/lib/costeo.ts), para identificar cuál línea falla. */
  partida: number;
  state: RowEditState;
  visibleCols: GridCol[];
  variant: 'venta' | 'costeo';
  /** true en Validación de Costeo — el único warning posible es Precio de venta vacío. */
  precioOnly?: boolean;
  editable: boolean;
  editableCols: Set<string>;
  writableIds: Set<string>;
  catalog: ItemDTO[];
  catalogLoading: boolean;
  onEdit: (product: ItemDTO, colId: string, raw: string) => void;
  onBlur: (product: ItemDTO, colId: string) => void;
  onColorChange: (product: ItemDTO, raw: string) => void;
  onEmbellecimientoChange: (product: ItemDTO, con: boolean) => void;
  /** Cualquier columna status de la línea: Etapa Costeo y Moneda (línea). */
  onStatusChange: (product: ItemDTO, colId: string, label: string) => void;
  /** Producto elegido en el picker — del catálogo (relación) o texto libre. */
  onProductoPick: (product: ItemDTO, choice: ProductoChoice) => void;
  expanded: boolean;
  onToggleExpand: (productId: string) => void;
  canConfirm: boolean;
  confirmSaving: boolean;
  confirmError?: string;
  onToggleConfirm: (productoId: number, next: boolean) => void;
  tallasSaving: boolean;
  tallasError?: string;
  onEditTallas: (productoId: number, next: string) => void;
  /** Mismo gate que canAddLines — el botón "✕" de eliminar línea. */
  canDelete: boolean;
  deleting: boolean;
  onDeleteLine: (productId: string) => void;
  /** "Ajustar línea" (Efraín, 2026-07-31): cambiar producto/color/embellecimiento/
   * cantidad sin versión ni costeo — visible fuera del modo de edición inline
   * (stage 4/borrador), incluida la Oportunidad Ganada. */
  canAjustar: boolean;
  onAjustarLinea: (product: ItemDTO) => void;
}

function QuoteRowInner({
  product: p, partida, state, visibleCols, variant, precioOnly = false, editable,
  editableCols, writableIds, catalog, catalogLoading,
  onEdit, onBlur, onColorChange, onEmbellecimientoChange, onStatusChange, onProductoPick,
  expanded, onToggleExpand, canConfirm, confirmSaving, confirmError, onToggleConfirm,
  tallasSaving, tallasError, onEditTallas,
  canDelete, deleting, onDeleteLine, canAjustar, onAjustarLinea,
}: QuoteRowProps) {
  const lineWarnings = getLineWarnings(p, state, variant, catalog, precioOnly);

  // Chevron + eliminar. Se renderizaban solo en la celda de Producto de solo
  // lectura, pero en Nueva oportunidad (justo donde canDelete es true) Producto
  // siempre es <input>, así que el botón de eliminar quedaba invisible en el
  // único caso donde hace falta (Efraín, 2026-07-20) — por eso va en ambos.
  const lineControls = (
    <div style={{ display: 'inline-flex', gap: 4, marginRight: 4 }}>
      <button
        type="button"
        onClick={() => onToggleExpand(p.id)}
        title={expanded ? 'Ocultar detalle' : 'Ver descripción y tallas'}
        style={chevronButtonStyle(expanded)}
      >
        ▸
      </button>
      {canAjustar && (
        <button
          type="button"
          onClick={() => onAjustarLinea(p)}
          title="Cambiar producto, color, embellecimiento o cantidad sin versión ni costeo"
          style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', padding: 0, color: 'var(--accent)' }}
        >
          ✎
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={() => onDeleteLine(p.id)}
          disabled={deleting}
          title="Eliminar línea"
          style={{
            background: 'none',
            border: 'none',
            cursor: deleting ? 'wait' : 'pointer',
            font: 'inherit',
            padding: 0,
            color: 'var(--status-perdida)',
            opacity: deleting ? 0.6 : 1,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );

  return (
    <div style={{ ...gridWrapStyle, background: lineWarnings.length > 0 ? '#fdf1f2' : '#fff' }}>
      <div style={{
        ...gridWrapStyle,
        display: 'grid', gridTemplateColumns: `28px ${colsTemplate(visibleCols)}`,
        gap: 6, alignItems: 'center', padding: '8px 10px',
      }}>
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', fontWeight: 700 }}>{partida}</div>
        {visibleCols.map((c, idx) => {
          // lookup_mm0x4kda es un mirror — Monday nunca lo deja escribir
          // directo, así que no está en writableIds. Lo real editable son
          // sus dos posibles destinos de escritura (texto libre o relación).
          const writable = c.id === PRODUCTO_COL
            ? editable && editableCols.has(c.id) && (writableIds.has(PRODUCTO_TXT_COL) || writableIds.has(PRODUCTO_REL_COL))
            : editable && writableIds.has(c.id) && editableCols.has(c.id);
          // Moneda de solo lectura (Validación, o un rol sin escritura): si la
          // línea no tiene la suya, se muestra la heredada del catálogo — con
          // el valor crudo saldría "—" aunque el producto sí traiga moneda.
          const displayVal = c.id === MONEDA_COL
            ? { text: monedaDe(p, state.preview).label, type: 'status' }
            : state.preview[c.id] ?? p.cols[c.id];

          if (writable && c.id === PRODUCTO_COL) {
            return (
              <div key={c.id} style={{ textAlign: c.align, display: 'flex', alignItems: 'center' }}>
                {lineControls}
                <ProductPicker
                  value={displayProducto(p, state.preview)}
                  catalog={catalog}
                  catalogLoading={catalogLoading}
                  saving={!!state.saving[PRODUCTO_COL]}
                  onPick={(choice) => onProductoPick(p, choice)}
                  style={{ ...inputStyle, textAlign: 'left', width: '100%' }}
                />
              </div>
            );
          }
          if (writable && c.id === COLOR_COL) {
            const raw = state.editing[COLOR_COL] ?? (p.cols[COLOR_COL]?.text ?? '');
            const { productoElegido, disponibles } = colorOptions(p, state.preview, catalog);

            // Sin lista de colores para este producto (no configurada en el
            // catálogo) — se deja en blanco, deshabilitado. Nada de texto libre:
            // el vendedor no debe "inventar" un color que el catálogo no define
            // (Efraín, 2026-07-16). Mientras el catálogo todavía no llega
            // (catalogLoading), se distingue de "sin colores configurados" —
            // antes se veían idénticos y parecía que el selector estaba roto.
            if (disponibles.length === 0) {
              return (
                <div key={c.id} style={{ textAlign: c.align }}>
                  <input
                    value=""
                    disabled
                    placeholder={catalogLoading ? 'Cargando colores…' : (productoElegido ? 'Sin colores configurados' : 'Elige un producto primero')}
                    style={{ ...inputStyle, textAlign: 'left' }}
                  />
                </div>
              );
            }
            return (
              <div key={c.id} style={{ textAlign: c.align }}>
                <select
                  value={raw}
                  disabled={!!state.saving[COLOR_COL]}
                  onChange={(e) => onColorChange(p, e.target.value)}
                  style={{ ...inputStyle, textAlign: 'left' }}
                >
                  <option value="">Elegir color…</option>
                  {disponibles.map((d) => <option key={d} value={d}>{d}</option>)}
                  {/* si el color guardado ya no está en la lista (cambiaron de producto), no lo escondas en silencio */}
                  {raw && !disponibles.includes(raw) && <option value={raw}>{raw}</option>}
                </select>
              </div>
            );
          }
          if (writable && c.id === COL.cantidad) {
            const raw = state.editing[c.id] ?? (p.cols[c.id]?.text ?? '');
            return (
              <div key={c.id} style={{ textAlign: c.align }}>
                <input
                  type="number"
                  className="cmp-grid-num-input"
                  value={raw}
                  disabled={!!state.saving[c.id]}
                  onChange={(e) => onEdit(p, c.id, e.target.value)}
                  onBlur={() => onBlur(p, c.id)}
                  style={inputStyle}
                />
              </div>
            );
          }
          if (writable && c.id === EMB_STATUS_COL) {
            const label = state.preview[EMB_STATUS_COL]?.text ?? p.cols[EMB_STATUS_COL]?.text ?? '';
            const checked = label === EMB_LABEL_CON;
            return (
              <div key={c.id} style={{ textAlign: c.align }}>
                <select
                  value={checked ? EMB_LABEL_CON : EMB_LABEL_SIN}
                  disabled={!!state.saving[EMB_STATUS_COL]}
                  onChange={(e) => onEmbellecimientoChange(p, e.target.value === EMB_LABEL_CON)}
                  style={{ ...inputStyle, textAlign: 'left' }}
                >
                  <option value={EMB_LABEL_SIN}>{EMB_LABEL_SIN}</option>
                  <option value={EMB_LABEL_CON}>{EMB_LABEL_CON}</option>
                </select>
              </div>
            );
          }
          if (writable && c.id === ETAPA_COSTEO_COL) {
            const raw = state.preview[ETAPA_COSTEO_COL]?.text ?? p.cols[ETAPA_COSTEO_COL]?.text ?? '';
            return (
              <div key={c.id} style={{ textAlign: c.align }}>
                <select
                  value={raw}
                  disabled={!!state.saving[ETAPA_COSTEO_COL]}
                  onChange={(e) => onStatusChange(p, ETAPA_COSTEO_COL, e.target.value)}
                  style={{ ...inputStyle, textAlign: 'left' }}
                >
                  <option value="">Elegir etapa…</option>
                  {Object.keys(ETAPA_COSTEO_COLORS).map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            );
          }
          if (writable && c.id === MONEDA_COL) {
            // El valor guardado es el de la LÍNEA; vacío se muestra como la
            // heredada del catálogo ("USD (catálogo)") en vez de fingir que la
            // línea ya la eligió — elegir del selector la vuelve explícita.
            const propia = state.preview[MONEDA_COL]?.text ?? p.cols[MONEDA_COL]?.text ?? '';
            const heredada = monedaDe(p, state.preview);
            return (
              <div key={c.id} style={{ textAlign: c.align }}>
                <select
                  value={propia}
                  disabled={!!state.saving[MONEDA_COL]}
                  onChange={(e) => onStatusChange(p, MONEDA_COL, e.target.value)}
                  style={{ ...inputStyle, textAlign: 'left' }}
                >
                  <option value="">{heredada.label ? `${heredada.label} (cat.)` : 'Elegir moneda…'}</option>
                  {MONEDA_LABELS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            );
          }
          if (writable) {
            const raw = state.editing[c.id] ?? (p.cols[c.id]?.text ?? '');
            return (
              <div key={c.id} style={{ textAlign: c.align }}>
                <input
                  type="number"
                  className="cmp-grid-num-input"
                  value={raw}
                  disabled={!!state.saving[c.id]}
                  onChange={(e) => onEdit(p, c.id, e.target.value)}
                  onBlur={() => onBlur(p, c.id)}
                  style={inputStyle}
                />
              </div>
            );
          }
          // Chip gris (misma pill que los inputs editables) en toda celda de
          // solo lectura salvo Producto (idx 0), SKU y las columnas de status
          // (ya son su propio badge/chip) — imita la referencia de diseño
          // simple que pidió Efraín (2026-07-20): valores "flotando" en una
          // pastilla gris en vez de texto plano contra bordes de fila.
          const isChip = idx > 0 && c.id !== 'lookup_mkzn7x9a'
            && c.id !== ETAPA_COSTEO_COL && c.id !== EMB_STATUS_COL;
          return (
            <div key={c.id} style={{
              textAlign: c.align,
              font: idx === 0 ? 'var(--text-body-strong)' : 'var(--text-label)',
              color: idx === 0 ? 'var(--ink)' : 'var(--ink-secondary)',
              ...(idx === 0 ? { display: 'flex', alignItems: 'center', minWidth: 0 } : undefined),
              ...(isChip ? valueChipStyle : undefined),
            }}>
              {idx === 0 && lineControls}
              {idx === 0 && p.pendingWrite && <span title="guardado, sincronizando…" style={{ marginRight: 6, color: 'var(--accent)', flex: 'none' }}>⏳</span>}
              {c.id === PRODUCTO_COL && (
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                  {displayProducto(p, state.preview) || '—'}
                </span>
              )}
              {c.id === 'lookup_mkzn7x9a' && (
                <MonoTag style={{ display: 'inline-block' }}>{cellValue(c, displayVal)}</MonoTag>
              )}
              {c.id === ETAPA_COSTEO_COL && (() => {
                const label = cellValue(c, displayVal);
                const colors = ETAPA_COSTEO_COLORS[label] ?? ETAPA_COSTEO_COLORS['No iniciado'];
                return label === '—'
                  ? '—'
                  : <StatusBadge label={label} color={colors.color} tint={colors.tint} />;
              })()}
              {c.id === EMB_STATUS_COL && (() => {
                const label = state.preview[EMB_STATUS_COL]?.text ?? p.cols[EMB_STATUS_COL]?.text;
                const con = label === EMB_LABEL_CON;
                return (
                  <StatusBadge
                    label={con ? EMB_LABEL_CON : EMB_LABEL_SIN}
                    color={con ? '#00b461' : '#68737d'}
                    tint={con ? '#d6f5e6' : '#e6e9eb'}
                  />
                );
              })()}
              {c.id === MARGEN_COL && (() => {
                const label = cellValue(c, displayVal);
                if (label === '—') return '—';
                const n = Number(displayVal?.value ?? displayVal?.text);
                return <span style={{ color: Number.isFinite(n) ? marginColor(n) : undefined, fontWeight: 600 }}>{label}</span>;
              })()}
              {c.id === SUGERIDO_COL && (() => {
                const costoTotalUnit = numFrom(state, p, COL.costoTotalUnit);
                const margenGobPctVal = Number(state.editing[COL.margenGobPct] ?? p.cols[COL.margenGobPct]?.text ?? 0) || 0;
                const suggested = suggestedPrecio23(costoTotalUnit, margenGobPctVal);
                if (suggested === undefined) return '—';
                return (
                  <span style={{ fontStyle: 'italic', color: 'var(--ink-tertiary)' }} title="Calculado para 23% de utilidad (Margen Gob ya tomado como costo)">
                    {fmtMoney(suggested)}
                  </span>
                );
              })()}
              {c.id !== PRODUCTO_COL && c.id !== 'lookup_mkzn7x9a' && c.id !== ETAPA_COSTEO_COL && c.id !== EMB_STATUS_COL
                && c.id !== MARGEN_COL && c.id !== SUGERIDO_COL && cellValue(c, displayVal)}
            </div>
          );
        })}
        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          {lineWarnings.length > 0 && (
            <StatusBadge label={`⚠ ${lineWarnings.join(' • ')}`} color="#ce3048" tint="#fbdbdf" />
          )}
        </div>
      </div>
      {state.error && (
        <div style={{ padding: '0 14px 8px', font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>
          {state.error}
        </div>
      )}
      {expanded && (
        <LineDetailPanel
          product={p}
          catalog={catalog}
          variant={variant}
          canConfirm={canConfirm}
          saving={confirmSaving}
          error={confirmError}
          onToggleConfirm={onToggleConfirm}
          tallasSaving={tallasSaving}
          tallasError={tallasError}
          onEditTallas={onEditTallas}
        />
      )}
    </div>
  );
}

export const QuoteRow = memo(QuoteRowInner);
