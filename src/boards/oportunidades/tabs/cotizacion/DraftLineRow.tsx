// Fila local para una línea nueva TODAVÍA sin crear en Monday — producto,
// color y cantidad se capturan aquí sin ningún PATCH ni POST de por medio.
// Solo cuando la línea queda completa (producto elegido + color, si el
// producto tiene colores configurados + cantidad > 0) CotizacionTab manda UNA
// sola llamada de creación con los tres valores juntos.
//
// Antes "+ Agregar línea" creaba el subitem vacío al primer clic y cada campo
// (producto, color, cantidad) disparaba su propio PATCH + refetch por
// separado — si el usuario los llenaba rápido, esas tres escrituras
// concurrentes se cruzaban y la más lenta en resolver podía pisar en el
// estado local del front la elección que el usuario acababa de hacer en otro
// campo (Efraín, 2026-07-31: "elijo producto, color y cantidad, de repente se
// quita el producto y el color"). Sin red de por medio mientras se captura,
// no hay con qué cruzarse.
import type { ItemDTO } from '../../../../lib/api';
import { MonoTag } from '../../../../components/core/Badges';
import { ProductPicker, type ProductoChoice } from '../../../../components/forms/ProductPicker';
import { productoSku } from '../../../../lib/productSearch';
import {
  type GridCol, inputStyle, valueChipStyle, colsTemplate, catalogIndex,
  PRODUCTO_COL, COLOR_COL, PRODUCTO_COLOR_DROPDOWN_COL,
} from './gridMeta';
import { COL } from '../../../../lib/costeoCalc';

const SKU_COL = 'lookup_mkzn7x9a';

export interface DraftLine {
  key: string;
  choice?: ProductoChoice;
  color: string;
  cantidad: string;
  saving: boolean;
  error?: string;
}

export function emptyDraftLine(key: string): DraftLine {
  return { key, color: '', cantidad: '', saving: false };
}

export function draftProductoNombre(d: DraftLine): string {
  if (!d.choice) return '';
  return 'item' in d.choice ? d.choice.item.name : d.choice.freeText.trim();
}

/** Colores del catálogo para el producto elegido — vacío si es texto libre o
 * el producto no tiene colores configurados (mismo criterio que gridMeta's
 * colorOptions, pero directo del choice: todavía no hay ItemDTO de línea). */
export function draftColorOptions(choice: ProductoChoice | undefined, catalog: ItemDTO[]): string[] {
  if (!choice || !('item' in choice)) return [];
  const match = catalogIndex(catalog).byId.get(Number(choice.item.id));
  return (match?.cols[PRODUCTO_COLOR_DROPDOWN_COL]?.text ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function isDraftComplete(d: DraftLine, catalog: ItemDTO[]): boolean {
  if (!draftProductoNombre(d)) return false;
  const cant = parseFloat(d.cantidad);
  if (!Number.isFinite(cant) || cant <= 0) return false;
  const colores = draftColorOptions(d.choice, catalog);
  if (colores.length > 0 && !d.color) return false;
  return true;
}

interface Props {
  draft: DraftLine;
  visibleCols: GridCol[];
  catalog: ItemDTO[];
  catalogLoading: boolean;
  /** true = tarjeta apilada (mobile o "sin líneas todavía", donde no hay
   * header de grid contra el cual alinear columnas); false = fila de grid. */
  stacked: boolean;
  onChange: (patch: Partial<DraftLine>) => void;
  onCancel: () => void;
  onRetry: () => void;
}

export function DraftLineRow({ draft: d, visibleCols, catalog, catalogLoading, stacked, onChange, onCancel, onRetry }: Props) {
  const nombre = draftProductoNombre(d);
  const colores = draftColorOptions(d.choice, catalog);
  const skuChip = d.choice && 'item' in d.choice ? productoSku(d.choice.item) : undefined;
  const disabled = d.saving;

  const colorField = colores.length === 0 ? (
    <input
      value=""
      disabled
      placeholder={!d.choice ? 'Elige un producto primero' : 'Sin colores configurados'}
      style={{ ...inputStyle, textAlign: 'left' }}
    />
  ) : (
    <select
      value={d.color}
      disabled={disabled}
      onChange={(e) => onChange({ color: e.target.value })}
      style={{ ...inputStyle, textAlign: 'left' }}
    >
      <option value="">Elegir color…</option>
      {colores.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );

  const cantidadField = (
    <input
      type="number"
      className="cmp-grid-num-input"
      value={d.cantidad}
      disabled={disabled}
      onChange={(e) => onChange({ cantidad: e.target.value })}
      style={inputStyle}
    />
  );

  const productoField = (
    <ProductPicker
      value={nombre}
      catalog={catalog}
      catalogLoading={catalogLoading}
      saving={disabled}
      onPick={(choice) => onChange({ choice, color: '' })}
      style={{ ...inputStyle, textAlign: 'left', width: '100%' }}
    />
  );

  const cancelBtn = (
    <button
      type="button"
      onClick={onCancel}
      disabled={disabled}
      title="Quitar línea"
      style={{
        background: 'none', border: 'none', cursor: disabled ? 'wait' : 'pointer',
        color: 'var(--status-perdida)', font: 'inherit', padding: 0,
      }}
    >
      ✕
    </button>
  );

  const status = d.saving
    ? <span style={{ color: 'var(--accent)' }}>⏳ Guardando…</span>
    : d.error
      ? (
        <span style={{ color: 'var(--status-perdida)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {d.error}
          <button
            type="button"
            onClick={onRetry}
            style={{ font: 'inherit', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Reintentar
          </button>
        </span>
      )
      : null;

  if (stacked) {
    return (
      <div style={{
        padding: 14, borderTop: '1px solid var(--border-subtle)', background: '#faf8f6',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', fontWeight: 700 }}>Nueva línea</span>
          {cancelBtn}
        </div>
        {productoField}
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>{colorField}</div>
          <div style={{ width: 90 }}>{cantidadField}</div>
        </div>
        {status}
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', background: '#faf8f6' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: `28px ${colsTemplate(visibleCols)}`,
        gap: 6, alignItems: 'center', padding: '8px 10px',
      }}>
        <div />
        {visibleCols.map((c) => {
          if (c.id === PRODUCTO_COL) {
            return <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{cancelBtn}{productoField}</div>;
          }
          if (c.id === SKU_COL) return <div key={c.id}>{skuChip ? <MonoTag>{skuChip}</MonoTag> : <span style={valueChipStyle}>—</span>}</div>;
          if (c.id === COLOR_COL) return <div key={c.id}>{colorField}</div>;
          if (c.id === COL.cantidad) return <div key={c.id}>{cantidadField}</div>;
          return <div key={c.id} style={valueChipStyle}>—</div>;
        })}
        <div>{status}</div>
      </div>
    </div>
  );
}
