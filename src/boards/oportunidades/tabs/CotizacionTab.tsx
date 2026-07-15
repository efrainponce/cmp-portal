// Cotización / línea de producto grid — mirrors the design's fixed-column
// table. Each column is keyed to its real Monday column id; columns the
// viewer's role can't see simply aren't in `cols` and are skipped (server
// already strips them — see docs/dev-contracts.md).
import type { ColMeta, ItemDTO } from '../../../lib/api';
import { fmtMoney } from '../../../lib/format';
import { MonoTag } from '../../../components/core/Badges';

interface GridCol {
  id: string;
  label: string;
  align: 'left' | 'right';
  kind: 'text' | 'money' | 'percent';
}

const GRID_COLS_COSTEO: GridCol[] = [
  { id: 'lookup_mm0x4kda', label: 'Producto', align: 'left', kind: 'text' },
  { id: 'lookup_mkzn7x9a', label: 'SKU', align: 'left', kind: 'text' },
  { id: 'numeric_mkzm6399', label: 'Cant.', align: 'left', kind: 'text' },
  { id: 'lookup_mm11t8gj', label: 'Moneda', align: 'left', kind: 'text' },
  { id: 'numeric_mm0bph99', label: 'Costo distr. C/U', align: 'right', kind: 'money' },
  { id: 'numeric_mkzn2q51', label: 'Desc. %', align: 'right', kind: 'percent' },
  { id: 'formula_mkzngnjm', label: 'Costo real C/U', align: 'right', kind: 'money' },
  { id: 'numeric_mm0rvhgs', label: 'Conversión', align: 'right', kind: 'text' },
  { id: 'numeric_mkzngs9x', label: 'Gastos %', align: 'right', kind: 'percent' },
  { id: 'numeric_mm0gxvpa', label: 'Costo embell. C/U', align: 'right', kind: 'money' },
  { id: 'formula_mkznpfgg', label: 'Costo total C/U', align: 'right', kind: 'money' },
  { id: 'numeric_mkzneg3d', label: 'P. venta', align: 'right', kind: 'money' },
  { id: 'formula_mkznpw5p', label: 'Margen', align: 'right', kind: 'percent' },
];

// Ventas-side view: no cost breakdown, just what the customer is quoted.
const GRID_COLS_VENTA: GridCol[] = [
  { id: 'lookup_mm0x4kda', label: 'Producto', align: 'left', kind: 'text' },
  { id: 'lookup_mkzn7x9a', label: 'SKU', align: 'left', kind: 'text' },
  { id: 'numeric_mkzm6399', label: 'Cant.', align: 'left', kind: 'text' },
  { id: 'numeric_mkzneg3d', label: 'P. venta C/U', align: 'right', kind: 'money' },
  { id: 'formula_mkznmjh6', label: 'Subtotal', align: 'right', kind: 'money' },
  { id: 'formula_mm0rtdqp', label: 'IVA', align: 'right', kind: 'money' },
  { id: 'formula_mm00xy0n', label: 'Total c/IVA', align: 'right', kind: 'money' },
];

function cellValue(col: GridCol, val?: { text: string; value?: unknown }): string {
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

export function CotizacionTab({ subCols, products, variant = 'venta' }: { subCols: ColMeta[]; products: ItemDTO[]; variant?: 'venta' | 'costeo' }) {
  const gridCols = variant === 'costeo' ? GRID_COLS_COSTEO : GRID_COLS_VENTA;
  const visibleCols = gridCols.filter((gc) => subCols.some((c) => c.id === gc.id));

  if (products.length === 0) {
    return (
      <div style={{ padding: '24px 32px 40px', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
        Sin líneas de producto registradas.
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px 40px', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)' }}>
        <div style={variant === 'costeo' ? { minWidth: 900 } : undefined}>
          <div style={{
            display: 'grid', gridTemplateColumns: `1.6fr ${visibleCols.slice(1).map(() => '.85fr').join(' ')}`,
            padding: '9px 14px', background: 'var(--bg-sunken)', font: '700 9.5px \'Inter\', sans-serif',
            color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '.3px',
          }}>
            {visibleCols.map((c) => (
              <div key={c.id} style={{ textAlign: c.align }}>{c.label}</div>
            ))}
          </div>
          {products.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'grid', gridTemplateColumns: `1.6fr ${visibleCols.slice(1).map(() => '.85fr').join(' ')}`,
                alignItems: 'center', padding: '9px 14px', background: '#fff', borderTop: '1px solid var(--border-subtle)',
              }}
            >
              {visibleCols.map((c, idx) => (
                <div key={c.id} style={{
                  textAlign: c.align,
                  font: idx === 0 ? 'var(--text-body-strong)' : 'var(--text-label)',
                  color: idx === 0 ? 'var(--ink)' : 'var(--ink-secondary)',
                }}>
                  {c.id === 'lookup_mkzn7x9a'
                    ? <MonoTag style={{ display: 'inline-block' }}>{cellValue(c, p.cols[c.id])}</MonoTag>
                    : cellValue(c, p.cols[c.id])}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
