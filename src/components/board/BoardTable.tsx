// Generic Monday-like table: columns come from ColMeta, rows from ItemDTO.cols.
// Powers every board view (Oportunidades, Post-venta, Costeo, Productos,
// Instituciones, Contactos) — nothing here is board-specific.
import type { ColMeta, ItemDTO } from '../../lib/api';
import { CellContent } from './cells';
import { cellAlign } from './cellHelpers';

interface BoardTableProps {
  cols: ColMeta[];
  items: ItemDTO[];
  onRowClick?: (item: ItemDTO) => void;
  emptyLabel?: string;
}

const HIDDEN_TYPES = new Set(['subtasks', 'button']);

export function BoardTable({ cols, items, onRowClick, emptyLabel = 'Sin elementos.' }: BoardTableProps) {
  const visibleCols = cols.filter((c) => c.id !== 'name' && !HIDDEN_TYPES.has(c.type));

  if (items.length === 0) {
    return <div style={{ padding: '28px 24px', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>{emptyLabel}</div>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle('left')}>Nombre</th>
            {visibleCols.map((c) => <th key={c.id} style={thStyle(cellAlign(c))}>{c.title}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className={onRowClick ? 'row-hover' : undefined}
              onClick={() => onRowClick?.(item)}
              style={{ cursor: onRowClick ? 'pointer' : 'default', borderTop: '1px solid var(--border-subtle)' }}
            >
              <td style={tdStyle('left')}>
                <span style={{ font: '600 13px \'Inter\', sans-serif', color: 'var(--ink)' }}>{item.name}</span>
                {item.pendingWrite && <span title="guardado, sincronizando…" style={{ marginLeft: 6 }}>⏳</span>}
              </td>
              {visibleCols.map((c) => (
                <td key={c.id} style={tdStyle(cellAlign(c))}>
                  <CellContent col={c} val={item.cols[c.id]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle = (align: 'left' | 'right'): React.CSSProperties => ({
  textAlign: align, padding: '9px 14px', font: 'var(--text-micro)',
  color: 'var(--ink-quiet)', textTransform: 'uppercase', letterSpacing: '.4px',
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
});

const tdStyle = (align: 'left' | 'right'): React.CSSProperties => ({
  textAlign: align, padding: '10px 14px', font: 'var(--text-label)',
  color: 'var(--ink-secondary)', whiteSpace: 'nowrap',
});
