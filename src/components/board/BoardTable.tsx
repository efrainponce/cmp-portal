// Generic Monday-like table: columns come from ColMeta, rows from ItemDTO.cols.
// Powers every board view (Oportunidades, Post-venta, Costeo, Productos,
// Instituciones, Contactos) — nothing here is board-specific.
import type { ColMeta, ItemDTO } from '../../lib/api';
import { CellContent } from './cells';
import { cellAlign, renderCellText } from './cellHelpers';

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
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...thStyle('left'), maxWidth: NAME_COL_MAX_WIDTH }}>Nombre</th>
          {visibleCols.map((c) => <th key={c.id} style={{ ...thStyle(cellAlign(c)), maxWidth: COL_MAX_WIDTH }}>{c.title}</th>)}
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
            <td style={{ ...tdStyle('left'), maxWidth: NAME_COL_MAX_WIDTH, overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.name}>
              <span style={{ font: '600 13px \'Inter\', sans-serif', color: 'var(--ink)' }}>{item.name}</span>
              {item.pendingWrite && <span title="guardado, sincronizando…" style={{ marginLeft: 6 }}>⏳</span>}
            </td>
            {visibleCols.map((c) => (
              <td
                key={c.id}
                style={{ ...tdStyle(cellAlign(c)), maxWidth: COL_MAX_WIDTH, overflow: 'hidden', textOverflow: 'ellipsis' }}
                title={renderCellText(c, item.cols[c.id])}
              >
                <CellContent col={c} val={item.cols[c.id]} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const NAME_COL_MAX_WIDTH = 280;
const COL_MAX_WIDTH = 280;

const thStyle = (align: 'left' | 'right'): React.CSSProperties => ({
  textAlign: align, padding: '6px 14px', font: 'var(--text-micro)',
  color: 'var(--ink-quiet)', textTransform: 'uppercase', letterSpacing: '.4px',
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
});

const tdStyle = (align: 'left' | 'right'): React.CSSProperties => ({
  textAlign: align, padding: '5px 14px', font: 'var(--text-label)',
  color: 'var(--ink-secondary)', whiteSpace: 'nowrap',
});
