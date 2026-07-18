// Panel expandible (chevron) con la ficha completa de la línea — Descripción y
// Tallas, que la grid/tarjeta colapsada no muestra. En el board Costeo agrega el
// checkbox de Compras "Descripción y tallas confirmadas": vive en el catálogo de
// Productos por SKU, no por línea (Efraín 2026-07-18 — la ficha es del producto,
// no de la cotización), y bloquea "Mandar a Validación de costeo" mientras falte
// (worker/lib/costeo.ts checkValidacion). Compartido por CotizacionTab (desktop)
// y MobileQuoteRow.
import type { ItemDTO } from '../../../../lib/api';
import {
  DESCRIPCION_COL, TALLAS_COL, PRODUCTO_CONFIRM_COL, CATALOGO_DESCRIPCION_COL, CATALOGO_TALLAS_COL,
  linkedProductoId,
} from './gridMeta';

const fieldLabel: React.CSSProperties = {
  font: '700 9px \'Inter\', sans-serif', color: 'var(--ink-tertiary)',
  textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 4,
};

export function LineDetailPanel({
  product, catalog, variant, canConfirm, saving, error, onToggleConfirm,
}: {
  product: ItemDTO;
  catalog: ItemDTO[];
  variant: 'venta' | 'costeo';
  canConfirm: boolean;
  saving: boolean;
  error?: string;
  onToggleConfirm: (productoId: number, next: boolean) => void;
}) {
  const productoId = linkedProductoId(product);
  const catalogItem = productoId != null ? catalog.find((c) => Number(c.id) === productoId) : undefined;
  const descripcion = product.cols[DESCRIPCION_COL]?.text || catalogItem?.cols[CATALOGO_DESCRIPCION_COL]?.text || '';
  const tallas = product.cols[TALLAS_COL]?.text || catalogItem?.cols[CATALOGO_TALLAS_COL]?.text || '';
  const confirmed = !!catalogItem?.cols[PRODUCTO_CONFIRM_COL]?.text;

  return (
    <div style={{
      padding: '12px 16px', background: 'var(--bg-sunken)', borderTop: '1px solid var(--border-subtle)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div>
        <div style={fieldLabel}>Descripción</div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', whiteSpace: 'pre-wrap' }}>
          {descripcion || '—'}
        </div>
      </div>
      <div>
        <div style={fieldLabel}>Tallas</div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', whiteSpace: 'pre-wrap' }}>
          {tallas || '—'}
        </div>
      </div>
      {variant === 'costeo' && (
        productoId == null ? (
          <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>
            Sin producto de catálogo vinculado — no se puede confirmar.
          </div>
        ) : (
          <div>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              cursor: canConfirm && !saving ? 'pointer' : 'default',
            }}>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={!canConfirm || saving}
                onChange={(e) => onToggleConfirm(productoId, e.target.checked)}
              />
              <span style={{
                font: 'var(--text-label-strong)',
                color: confirmed ? 'var(--status-ganada)' : 'var(--ink-secondary)',
              }}>
                Descripción y tallas confirmadas
              </span>
            </label>
            {!canConfirm && (
              <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 2 }}>
                Solo Compras puede confirmar.
              </div>
            )}
            {error && <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)', marginTop: 2 }}>{error}</div>}
          </div>
        )
      )}
    </div>
  );
}
