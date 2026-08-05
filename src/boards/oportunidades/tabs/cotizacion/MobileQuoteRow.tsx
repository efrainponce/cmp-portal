// Tarjeta de línea de producto para mobile — mismo estado/edición que la fila
// de grid de CotizacionTab (comparten RowEditState y callbacks), pero
// apilada en vez de en columnas fijas: en <768px la grid de 9-16 columnas
// obliga a scroll horizontal y celdas ilegibles (Efraín, 2026-07-18: "en
// mobil esta horrible la ventana de cotizacion... quizas en lista").
import { memo } from 'react';
import type { ItemDTO } from '../../../../lib/api';
import { fmtMoney } from '../../../../lib/format';
import { MonoTag, StatusBadge } from '../../../../components/core/Badges';
import { COL } from '../../../../lib/costeoCalc';
import { LineDetailPanel } from './LineDetailPanel';
import { ProductPicker, type ProductoChoice } from '../../../../components/forms/ProductPicker';
import {
  type GridCol, type RowEditState, marginColor, suggestedPrecio23, numFrom, displayProducto, cellValue,
  inputStyle, valueChipStyle, ETAPA_COSTEO_COLORS, getLineWarnings, needsConfirmarTallas, productoProveedorOk,
  ETAPA_COSTEO_COL, SUGERIDO_COL, MARGEN_COL,
  PRODUCTO_COL, PRODUCTO_TXT_COL, PRODUCTO_REL_COL, COLOR_COL,
  EMB_STATUS_COL, EMB_LABEL_CON, EMB_LABEL_SIN,
  MONEDA_COL, MONEDA_LABELS, monedaDe,
  chevronButtonStyle, colorOptions,
} from './gridMeta';

const labelStyle: React.CSSProperties = {
  font: '700 9px \'Inter\', sans-serif', color: 'var(--ink-tertiary)',
  textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 4,
};

function MobileQuoteRowInner({
  product: p, partida, state, visibleCols, variant, precioOnly = false, editable, editableCols, writableIds, catalog, catalogLoading,
  onEdit, onBlur, onColorChange, onEmbellecimientoChange, onStatusChange, onProductoPick,
  expanded, onToggleExpand, canConfirm, confirmSaving, confirmError, onToggleConfirm,
  tallasSaving, tallasError, onEditTallas,
  proveedorSaving, proveedorError, onEditProveedor,
  canDelete, deleting, onDeleteLine, canAjustar, onAjustarLinea,
}: {
  product: ItemDTO;
  /** Número 1-based de la línea en la grid — mismo orden que usan los mensajes
   * de validación de costeo (worker/lib/costeo.ts), para poder identificar
   * cuál línea tiene el problema. */
  partida: number;
  state: RowEditState; visibleCols: GridCol[]; variant: 'venta' | 'costeo';
  /** true en Validación de Costeo — el único warning posible es Precio de venta vacío. */
  precioOnly?: boolean;
  editable: boolean;
  editableCols: Set<string>; writableIds: Set<string>; catalog: ItemDTO[]; catalogLoading: boolean;
  onEdit: (product: ItemDTO, colId: string, raw: string) => void;
  onBlur: (product: ItemDTO, colId: string) => void;
  onColorChange: (product: ItemDTO, raw: string) => void;
  onEmbellecimientoChange: (product: ItemDTO, con: boolean) => void;
  /** Cualquier columna status de la línea: Etapa Costeo y Moneda (línea). */
  onStatusChange: (product: ItemDTO, colId: string, label: string) => void;
  /** Producto elegido en el picker — del catálogo (relación) o texto libre. */
  onProductoPick: (product: ItemDTO, choice: ProductoChoice) => void;
  /** Chevron de detalle (Descripción/Tallas + confirmación de Compras en Costeo). */
  expanded: boolean;
  onToggleExpand: (productId: string) => void;
  canConfirm: boolean;
  confirmSaving: boolean;
  confirmError?: string;
  onToggleConfirm: (productoId: number, next: boolean) => void;
  tallasSaving: boolean;
  tallasError?: string;
  onEditTallas: (productoId: number, next: string) => void;
  proveedorSaving: boolean;
  proveedorError?: string;
  onEditProveedor: (productoId: number, proveedorId: string, proveedorNombre: string) => void;
  /** Mismo gate que el botón "✕" de desktop (canAddLines). */
  canDelete: boolean;
  deleting: boolean;
  onDeleteLine: (productId: string) => void;
  /** "Ajustar línea" (Efraín, 2026-07-31) — ver QuoteRow.tsx. */
  canAjustar: boolean;
  onAjustarLinea: (product: ItemDTO) => void;
}) {
  const titleCol = visibleCols[0];
  const restCols = visibleCols.slice(1);
  const titleWritable = editable && editableCols.has(titleCol.id)
    && (writableIds.has(PRODUCTO_TXT_COL) || writableIds.has(PRODUCTO_REL_COL));

  const renderField = (c: GridCol) => {
    const writable = c.id === PRODUCTO_COL
      ? titleWritable
      : editable && writableIds.has(c.id) && editableCols.has(c.id);
    // Igual que en desktop: sin moneda propia, se muestra la del catálogo.
    const displayVal = c.id === MONEDA_COL
      ? { text: monedaDe(p, state.preview).label, type: 'status' }
      : state.preview[c.id] ?? p.cols[c.id];

    if (writable && c.id === COLOR_COL) {
      const raw = state.editing[COLOR_COL] ?? (p.cols[COLOR_COL]?.text ?? '');
      const { productoElegido, disponibles } = colorOptions(p, state.preview, catalog);

      if (disponibles.length === 0) {
        return (
          <input
            value=""
            disabled
            placeholder={catalogLoading ? 'Cargando colores…' : (productoElegido ? 'Sin colores configurados' : 'Elige un producto primero')}
            style={{ ...inputStyle, textAlign: 'left' }}
          />
        );
      }
      return (
        <select
          value={raw}
          disabled={!!state.saving[COLOR_COL]}
          onChange={(e) => onColorChange(p, e.target.value)}
          style={{ ...inputStyle, textAlign: 'left' }}
        >
          <option value="">Elegir color…</option>
          {disponibles.map((d) => <option key={d} value={d}>{d}</option>)}
          {raw && !disponibles.includes(raw) && <option value={raw}>{raw}</option>}
        </select>
      );
    }
    if (writable && c.id === COL.cantidad) {
      const raw = state.editing[c.id] ?? (p.cols[c.id]?.text ?? '');
      return (
        <input
          type="number"
          className="cmp-grid-num-input"
          value={raw}
          disabled={!!state.saving[c.id]}
          onChange={(e) => onEdit(p, c.id, e.target.value)}
          onBlur={() => onBlur(p, c.id)}
          style={{ ...inputStyle, textAlign: 'left' }}
        />
      );
    }
    if (writable && c.id === EMB_STATUS_COL) {
      const label = state.preview[EMB_STATUS_COL]?.text ?? p.cols[EMB_STATUS_COL]?.text ?? '';
      const checked = label === EMB_LABEL_CON;
      return (
        <select
          value={checked ? EMB_LABEL_CON : EMB_LABEL_SIN}
          disabled={!!state.saving[EMB_STATUS_COL]}
          onChange={(e) => onEmbellecimientoChange(p, e.target.value === EMB_LABEL_CON)}
          style={{ ...inputStyle, textAlign: 'left' }}
        >
          <option value={EMB_LABEL_SIN}>{EMB_LABEL_SIN}</option>
          <option value={EMB_LABEL_CON}>{EMB_LABEL_CON}</option>
        </select>
      );
    }
    if (writable && c.id === ETAPA_COSTEO_COL) {
      const raw = state.preview[ETAPA_COSTEO_COL]?.text ?? p.cols[ETAPA_COSTEO_COL]?.text ?? '';
      return (
        <select
          value={raw}
          disabled={!!state.saving[ETAPA_COSTEO_COL]}
          onChange={(e) => onStatusChange(p, ETAPA_COSTEO_COL, e.target.value)}
          style={{ ...inputStyle, textAlign: 'left' }}
        >
          <option value="">Elegir etapa…</option>
          {Object.keys(ETAPA_COSTEO_COLORS).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      );
    }
    if (writable && c.id === MONEDA_COL) {
      const propia = state.preview[MONEDA_COL]?.text ?? p.cols[MONEDA_COL]?.text ?? '';
      const heredada = monedaDe(p, state.preview);
      return (
        <select
          value={propia}
          disabled={!!state.saving[MONEDA_COL]}
          onChange={(e) => onStatusChange(p, MONEDA_COL, e.target.value)}
          style={{ ...inputStyle, textAlign: 'left' }}
        >
          <option value="">{heredada.label ? `${heredada.label} (cat.)` : 'Elegir moneda…'}</option>
          {MONEDA_LABELS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      );
    }
    if (writable) {
      const raw = state.editing[c.id] ?? (p.cols[c.id]?.text ?? '');
      return (
        <input
          type="number"
          className="cmp-grid-num-input"
          value={raw}
          disabled={!!state.saving[c.id]}
          onChange={(e) => onEdit(p, c.id, e.target.value)}
          onBlur={() => onBlur(p, c.id)}
          style={{ ...inputStyle, textAlign: 'left' }}
        />
      );
    }

    // Solo lectura
    if (c.id === 'lookup_mkzn7x9a') return <MonoTag style={{ display: 'inline-block' }}>{cellValue(c, displayVal)}</MonoTag>;
    if (c.id === ETAPA_COSTEO_COL) {
      const label = cellValue(c, displayVal);
      if (label === '—') return <span style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>—</span>;
      const colors = ETAPA_COSTEO_COLORS[label] ?? ETAPA_COSTEO_COLORS['No iniciado'];
      return <StatusBadge label={label} color={colors.color} tint={colors.tint} />;
    }
    if (c.id === EMB_STATUS_COL) {
      const label = state.preview[EMB_STATUS_COL]?.text ?? p.cols[EMB_STATUS_COL]?.text;
      const con = label === EMB_LABEL_CON;
      return (
        <StatusBadge
          label={con ? EMB_LABEL_CON : EMB_LABEL_SIN}
          color={con ? '#00b461' : '#68737d'}
          tint={con ? '#d6f5e6' : '#e6e9eb'}
        />
      );
    }
    if (c.id === MARGEN_COL) {
      const label = cellValue(c, displayVal);
      if (label === '—') return <div style={{ ...valueChipStyle, font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>—</div>;
      const n = Number(displayVal?.value ?? displayVal?.text);
      return <div style={{ ...valueChipStyle, font: 'var(--text-label)', color: Number.isFinite(n) ? marginColor(n) : undefined, fontWeight: 600 }}>{label}</div>;
    }
    if (c.id === SUGERIDO_COL) {
      const costoTotalUnit = numFrom(state, p, COL.costoTotalUnit);
      const margenGobPctVal = Number(state.editing[COL.margenGobPct] ?? p.cols[COL.margenGobPct]?.text ?? 0) || 0;
      const suggested = suggestedPrecio23(costoTotalUnit, margenGobPctVal);
      if (suggested === undefined) return <div style={{ ...valueChipStyle, font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>—</div>;
      return (
        <div style={{ ...valueChipStyle, fontStyle: 'italic', font: 'var(--text-label)', color: 'var(--ink-tertiary)' }} title="Calculado para 23% de utilidad (Margen Gob ya tomado como costo)">
          {fmtMoney(suggested)}
        </div>
      );
    }
    // Chip gris (misma pill que desktop) en cualquier otra celda de solo lectura.
    return <div style={{ ...valueChipStyle, font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>{cellValue(c, displayVal)}</div>;
  };

  const lineWarnings = getLineWarnings(p, state, variant, catalog, precioOnly);
  // Aparte del resto: se pinta como texto explícito arriba del nombre del
  // producto en vez de perderse mezclado en el badge genérico de warnings.
  const needsTallas = !precioOnly && needsConfirmarTallas(p, variant, catalog);
  const needsProveedor = needsTallas && !productoProveedorOk(p, catalog);
  const otherWarnings = lineWarnings.filter((w) => w !== 'Sin confirmar' && w !== 'Sin tallas' && w !== 'Sin proveedor');

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', background: lineWarnings.length > 0 ? '#fdf1f2' : '#fff', padding: '14px' }}>
      {needsTallas && (
        <div style={{ font: '700 11px \'Inter\', sans-serif', color: '#ce3048', marginBottom: 6 }}>
          ⚠ HAY QUE CONFIRMAR TALLAS{needsProveedor ? ' Y PROVEEDOR' : ''}
        </div>
      )}
      {otherWarnings.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <StatusBadge label={`⚠ ${otherWarnings.join(' • ')}`} color="#ce3048" tint="#fbdbdf" />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span style={{
          font: '700 10px \'Inter\', sans-serif', color: 'var(--ink-tertiary)', marginTop: 4, flexShrink: 0,
        }} title="Partida">
          #{partida}
        </span>
        <button
          type="button"
          onClick={() => onToggleExpand(p.id)}
          title={expanded ? 'Ocultar detalle' : 'Ver descripción y tallas'}
          style={{ ...chevronButtonStyle(expanded), marginTop: 1, flexShrink: 0 }}
        >
          ▸
        </button>
        {canAjustar && (
          <button
            type="button"
            onClick={() => onAjustarLinea(p)}
            title="Cambiar producto, color, embellecimiento o cantidad sin versión ni costeo"
            style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', padding: 0, marginTop: 3, flexShrink: 0, color: 'var(--accent)' }}
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
              background: 'none', border: 'none', cursor: deleting ? 'wait' : 'pointer',
              font: 'inherit', padding: 0, marginTop: 3, flexShrink: 0,
              color: 'var(--status-perdida)', opacity: deleting ? 0.6 : 1,
            }}
          >
            ✕
          </button>
        )}
        {p.pendingWrite && <span title="guardado, sincronizando…" style={{ color: 'var(--accent)' }}>⏳</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          {titleWritable ? (
            <ProductPicker
              value={displayProducto(p, state.preview)}
              catalog={catalog}
              catalogLoading={catalogLoading}
              saving={!!state.saving[PRODUCTO_COL]}
              onPick={(choice) => onProductoPick(p, choice)}
              style={{ ...inputStyle, textAlign: 'left', font: 'var(--text-body-strong)' }}
            />
          ) : (
            <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>
              {displayProducto(p, state.preview) || '—'}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', marginTop: 10 }}>
        {restCols.map((c) => (
          <div key={c.id} style={{ minWidth: 0 }}>
            <div style={labelStyle}>{c.label}</div>
            {renderField(c)}
          </div>
        ))}
      </div>
      {state.error && (
        <div style={{ marginTop: 8, font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>{state.error}</div>
      )}
      {expanded && (
        <div style={{ margin: '10px -14px -14px' }}>
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
            proveedorSaving={proveedorSaving}
            proveedorError={proveedorError}
            onEditProveedor={onEditProveedor}
          />
        </div>
      )}
    </div>
  );
}

export const MobileQuoteRow = memo(MobileQuoteRowInner);
