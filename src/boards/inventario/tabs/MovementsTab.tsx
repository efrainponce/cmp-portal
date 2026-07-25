// Movimientos tab: full ledger, newest first. Origin/destination are ids on the DTO —
// resolved to warehouse names client-side (GET /api/inventario/warehouses is cheap and
// cached for the tab's lifetime, no need to bake names into every movement row).
import { Fragment, useEffect, useState } from 'react';
import { StatusBadge } from '../../../components/core/Badges';
import { getMovements, getWarehouses, AccessError, type MovementDTO, type MovementType, type WarehouseDTO } from '../../../lib/inventoryApi';
import { DocumentsPanel } from '../../../components/documents/DocumentsPanel';

type Status = 'loading' | 'ready' | 'denied' | 'error';

const TYPE_STYLE: Record<MovementType, { color: string; tint: string }> = {
  Entrada: { color: 'var(--status-ganada)', tint: 'var(--status-ganada-tint)' },
  Salida: { color: 'var(--status-perdida)', tint: 'var(--status-perdida-tint)' },
  Transferencia: { color: 'var(--status-seguimiento)', tint: 'var(--status-seguimiento-tint)' },
  'Consolidación': { color: 'var(--status-en-coste)', tint: 'var(--status-en-coste-tint)' },
};

function fmtDateTime(raw: string): string {
  // SQLite datetime('now') is UTC without a timezone suffix — append Z so the browser
  // renders it in the viewer's local time instead of misreading it as local-already.
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

export function MovementsTab({ refreshToken }: { refreshToken: number }) {
  const [status, setStatus] = useState<Status>('loading');
  const [movements, setMovements] = useState<MovementDTO[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseDTO[]>([]);
  // Movimiento cuya remisión está desplegada (una a la vez: la fila expandida
  // ocupa todo el ancho de la tabla).
  const [openRemision, setOpenRemision] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    Promise.all([getMovements(), getWarehouses()])
      .then(([m, w]) => { if (!cancelled) { setMovements(m); setWarehouses(w); setStatus('ready'); } })
      .catch((e) => { if (!cancelled) setStatus(e instanceof AccessError ? 'denied' : 'error'); });
    return () => { cancelled = true; };
  }, [refreshToken]);

  if (status === 'loading') return <Centered>Cargando…</Centered>;
  if (status === 'denied') return <Centered>No tienes acceso a Inventario. Pide acceso a un administrador.</Centered>;
  if (status === 'error') return <Centered>No se pudo cargar la bitácora de movimientos.</Centered>;
  if (movements.length === 0) return <Centered>Todavía no hay movimientos registrados.</Centered>;

  const nameOf = (id: number | null) => (id == null ? '—' : warehouses.find((w) => w.id === id)?.name ?? `#${id}`);

  return (
    <div style={{ padding: '20px 32px 32px', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Fecha', 'Tipo', 'Producto', 'Cant.', 'De', 'A', 'Capturó', 'Folio', 'Notas', 'Remisión'].map((h, i) => (
              <th key={h} style={thStyle(i === 3 ? 'right' : 'left')}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => {
            const style = TYPE_STYLE[m.type];
            const open = openRemision === m.id;
            return (
              <Fragment key={m.id}>
                <tr style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={tdStyle('left')}>{fmtDateTime(m.createdAt)}</td>
                  <td style={tdStyle('left')}><StatusBadge label={m.type} color={style.color} tint={style.tint} /></td>
                  <td style={tdStyle('left')}>{m.productName}</td>
                  <td style={{ ...tdStyle('right'), font: 'var(--text-label-strong)' }}>{m.quantity.toLocaleString('es-MX')}</td>
                  <td style={tdStyle('left')}>{nameOf(m.originId)}</td>
                  <td style={tdStyle('left')}>{nameOf(m.destinationId)}</td>
                  <td style={tdStyle('left')}>{m.capturedBy}</td>
                  <td style={tdStyle('left')}>{m.folio || '—'}</td>
                  {/* Notas se recorta: sin tope empuja la acción de Remisión
                      fuera de la pantalla en el scroll horizontal. */}
                  <td style={{ ...tdStyle('left'), color: 'var(--ink-tertiary)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={m.notes || undefined}>
                    {m.notes || '—'}
                  </td>
                  <td
                    onClick={() => setOpenRemision(open ? null : m.id)}
                    style={{ ...tdStyle('left'), color: 'var(--accent)', cursor: 'pointer', userSelect: 'none' }}
                  >
                    {open ? 'Cerrar' : 'Generar / firmar'}
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={10} style={{ padding: '12px 14px 18px', background: 'var(--bg)' }}>
                      <DocumentsPanel
                        sourceKind="movimiento"
                        sourceId={String(m.id)}
                        templates={['remision-inventario']}
                        title={`Remisión del movimiento #${m.id}`}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const thStyle = (align: 'left' | 'right'): React.CSSProperties => ({
  textAlign: align, padding: '6px 14px', font: 'var(--text-micro)',
  color: 'var(--ink-quiet)', textTransform: 'uppercase', letterSpacing: '.4px',
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
});

const tdStyle = (align: 'left' | 'right'): React.CSSProperties => ({
  textAlign: align, padding: '5px 14px', font: 'var(--text-label)',
  color: 'var(--ink-secondary)', whiteSpace: 'nowrap',
});

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 200, padding: 24, textAlign: 'center', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
      {children}
    </div>
  );
}
