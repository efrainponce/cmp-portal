// Read-only key/value grid for an item's header columns — used by detail
// panels (Oportunidades, Post-venta) before/instead of a full table.
import type { ColMeta, ItemDTO } from '../../lib/api';
import { CellContent } from './cells';

export function InfoGrid({ cols, item }: { cols: ColMeta[]; item: ItemDTO }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
      {cols.map((c) => (
        <div key={c.id}>
          <div style={{ font: 'var(--text-micro)', color: 'var(--ink-quiet)', textTransform: 'uppercase', letterSpacing: '.4px' }}>{c.title}</div>
          <div style={{ marginTop: 4, font: 'var(--text-body)', color: 'var(--ink)' }}>
            <CellContent col={c} val={item.cols[c.id]} />
          </div>
        </div>
      ))}
    </div>
  );
}
