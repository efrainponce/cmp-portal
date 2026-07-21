// Tarjeta de línea de producto para mobile — mismo estado/edición que la fila
// de grid de CotizacionTab (comparten RowEditState y callbacks), pero
// apilada en vez de en columnas fijas: en <768px la grid de 9-16 columnas
// obliga a scroll horizontal y celdas ilegibles (Efraín, 2026-07-18: "en
// mobil esta horrible la ventana de cotizacion... quizas en lista").
import type { ItemDTO } from '../../../../lib/api';
import { fmtMoney } from '../../../../lib/format';
import { MonoTag, StatusBadge } from '../../../../components/core/Badges';
import { COL } from '../../../../lib/costeoCalc';
import { LineDetailPanel } from './LineDetailPanel';
import {
  type GridCol, type RowEditState, marginColor, suggestedPrecio23, numFrom, displayProducto, cellValue,
  inputStyle, valueChipStyle, ETAPA_COSTEO_COLORS, getLineWarnings,
  ETAPA_COSTEO_COL, SUGERIDO_COL, MARGEN_COL,
  PRODUCTO_COL, PRODUCTO_TXT_COL, PRODUCTO_REL_COL, COLOR_COL, COLORES_DISP_COL,
  PRODUCTO_COLOR_DROPDOWN_COL, EMB_STATUS_COL, EMB_LABEL_CON, EMB_LABEL_SIN,
  chevronButtonStyle,
} from './gridMeta';

const labelStyle: React.CSSProperties = {
  font: '700 9px \'Inter\', sans-serif', color: 'var(--ink-tertiary)',
  textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 4,
};

export function MobileQuoteRow({
  product: p, partida, state, visibleCols, variant, precioOnly = false, editable, editableCols, writableIds, catalog, catalogLoading,
  onEdit, onBlur, onTextEdit, onColorChange, onEmbellecimientoChange, onEtapaCosteoChange, onProductoBlur,
  expanded, onToggleExpand, canConfirm, confirmSaving, confirmError, onToggleConfirm,
  canDelete, deleting, onDeleteLine,
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
  onTextEdit: (product: ItemDTO, colId: string, raw: string) => void;
  onColorChange: (product: ItemDTO, raw: string) => void;
  onEmbellecimientoChange: (product: ItemDTO, con: boolean) => void;
  onEtapaCosteoChange: (product: ItemDTO, label: string) => void;
  onProductoBlur: (product: ItemDTO) => void;
  /** Chevron de detalle (Descripción/Tallas + confirmación de Compras en Costeo). */
  expanded: boolean;
  onToggleExpand: () => void;
  canConfirm: boolean;
  confirmSaving: boolean;
  confirmError?: string;
  onToggleConfirm: (productoId: number, next: boolean) => void;
  /** Mismo gate que el botón "✕" de desktop (canAddLines). */
  canDelete: boolean;
  deleting: boolean;
  onDeleteLine: (productId: string) => void;
}) {
  const titleCol = visibleCols[0];
  const restCols = visibleCols.slice(1);
  const titleWritable = editable && editableCols.has(titleCol.id)
    && (writableIds.has(PRODUCTO_TXT_COL) || writableIds.has(PRODUCTO_REL_COL));

  const renderField = (c: GridCol) => {
    const writable = c.id === PRODUCTO_COL
      ? titleWritable
      : editable && writableIds.has(c.id) && editableCols.has(c.id);
    const displayVal = state.preview[c.id] ?? p.cols[c.id];

    if (writable && c.id === COLOR_COL) {
      const raw = state.editing[COLOR_COL] ?? (p.cols[COLOR_COL]?.text ?? '');
      const productoNombre = displayProducto(p, state.preview);
      const productoElegido = productoNombre.trim() !== '';
      const productoMatch = catalog.find(
        (c2) => c2.name.trim().toLowerCase() === productoNombre.trim().toLowerCase(),
      );
      const catalogColores = (productoMatch?.cols[PRODUCTO_COLOR_DROPDOWN_COL]?.text ?? '')
        .split(',').map((s) => s.trim()).filter(Boolean);
      const mirrorColores = (p.cols[COLORES_DISP_COL]?.text ?? '')
        .split(',').map((s) => s.trim()).filter(Boolean);
      const disponibles = catalogColores.length > 0 ? catalogColores : mirrorColores;

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
          onChange={(e) => onEtapaCosteoChange(p, e.target.value)}
          style={{ ...inputStyle, textAlign: 'left' }}
        >
          <option value="">Elegir etapa…</option>
          {Object.keys(ETAPA_COSTEO_COLORS).map((k) => <option key={k} value={k}>{k}</option>)}
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
      const label = cellValue(c, displayVal);
      if (label !== '—') return <div style={{ ...valueChipStyle, font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>{label}</div>;
      const costoTotalUnit = numFrom(state, p, COL.costoTotalUnit);
      const margenGobPctVal = Number(state.editing[COL.margenGobPct] ?? p.cols[COL.margenGobPct]?.text ?? 0) || 0;
      const suggested = suggestedPrecio23(costoTotalUnit, margenGobPctVal);
      if (suggested === undefined) return <div style={{ ...valueChipStyle, font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>—</div>;
      return (
        <div style={{ ...valueChipStyle, fontStyle: 'italic', font: 'var(--text-label)', color: 'var(--ink-tertiary)' }} title="Calculado para 23% de margen — sin precio auto de Monday">
          {fmtMoney(suggested)}
        </div>
      );
    }
    // Chip gris (misma pill que desktop) en cualquier otra celda de solo lectura.
    return <div style={{ ...valueChipStyle, font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>{cellValue(c, displayVal)}</div>;
  };

  const lineWarnings = getLineWarnings(p, state, variant, catalog, precioOnly);

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', background: lineWarnings.length > 0 ? '#fdf1f2' : '#fff', padding: '14px' }}>
      {lineWarnings.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <StatusBadge label={`⚠ ${lineWarnings.join(' • ')}`} color="#ce3048" tint="#fbdbdf" />
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
          onClick={onToggleExpand}
          title={expanded ? 'Ocultar detalle' : 'Ver descripción y tallas'}
          style={{ ...chevronButtonStyle(expanded), marginTop: 1, flexShrink: 0 }}
        >
          ▸
        </button>
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
            <input
              list="productos-catalogo-cotizacion"
              value={state.editing[PRODUCTO_COL] ?? displayProducto(p, state.preview)}
              disabled={!!state.saving[PRODUCTO_COL]}
              onChange={(e) => onTextEdit(p, PRODUCTO_COL, e.target.value)}
              onBlur={() => onProductoBlur(p)}
              placeholder="Elegir producto…"
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
          />
        </div>
      )}
    </div>
  );
}
