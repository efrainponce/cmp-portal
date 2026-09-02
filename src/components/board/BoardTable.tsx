// Generic Monday-like table: columns come from ColMeta, rows from ItemDTO.cols.
// Powers every board view (Oportunidades, Post-venta, Costeo, Productos,
// Instituciones, Contactos) — nothing here is board-specific.
//
// Dos cosas por las máquinas lentas (medido en prod con CPU 4×, 2026-09-02:
// Instituciones = 3,174 renglones × 15 columnas = 105k nodos y 2.3 s de hilo
// principal congelado en UNA tarea; Productos 58k nodos y 1.35 s):
//  - `Row` memoizado: el poll incremental (src/lib/api.ts) conserva la
//    identidad de los items que no cambiaron, así que un cambio en un
//    registro re-pinta un renglón, no 3,174.
//  - render PROGRESIVO: los primeros PRIMER_LOTE renglones salen en el mismo
//    frame (lo que cabe en pantalla y más) y el resto se agrega en lotes
//    cuando el hilo está libre. El DOM final es idéntico — Ctrl+F sigue
//    encontrando todo en cuanto termina, un par de segundos después — pero la
//    pantalla responde desde el primer lote en vez de quedarse congelada.
import { memo, useEffect, useMemo, useState } from 'react';
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

const PRIMER_LOTE = 150;
const LOTE = 600;

/** Cuántos renglones pintar ya. Crece por lotes en `requestIdleCallback`
 * (o setTimeout donde no exista) hasta cubrir `total`. Si la lista se acorta
 * MUCHO (una búsqueda: de 3,174 a 12) el límite vuelve a arrancar en
 * PRIMER_LOTE, para que al borrar la búsqueda los 3,174 regresen por lotes y
 * no de golpe; un registro borrado o agregado no lo reinicia (reiniciar
 * desmontaría y volvería a montar la cola de la tabla). */
function useRenderProgresivo(total: number): number {
  const [limite, setLimite] = useState(Math.min(total, PRIMER_LOTE));
  useEffect(() => {
    if (total < limite - LOTE) { setLimite(Math.min(total, PRIMER_LOTE)); return; }
    if (limite >= total) return;
    const paso = () => setLimite((l) => Math.min(total, l + LOTE));
    // `timeout`: con el poll de 5 s y el resto de la app el hilo casi nunca
    // está "ocioso" del todo — sin tope, Chrome puede aplazar el lote segundos.
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(paso, { timeout: 200 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(paso, 16);
    return () => window.clearTimeout(handle);
  }, [limite, total]);
  return Math.min(limite, total);
}

export function BoardTable({ cols, items, onRowClick, emptyLabel = 'Sin elementos.' }: BoardTableProps) {
  const visibleCols = useMemo(() => cols.filter((c) => c.id !== 'name' && !HIDDEN_TYPES.has(c.type)), [cols]);
  const limite = useRenderProgresivo(items.length);

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
        {(limite < items.length ? items.slice(0, limite) : items).map((item) => (
          <Row key={item.id} item={item} visibleCols={visibleCols} onRowClick={onRowClick} />
        ))}
      </tbody>
    </table>
  );
}

const Row = memo(function Row({ item, visibleCols, onRowClick }: {
  item: ItemDTO; visibleCols: ColMeta[]; onRowClick?: (item: ItemDTO) => void;
}) {
  return (
    <tr
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
  );
});

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
