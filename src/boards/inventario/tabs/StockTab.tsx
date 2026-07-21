// Stock tab: current stock per (producto, almacén), split Bodegas primero /
// Vendedores después so the team sees physical storage vs. samples in hand at a
// glance (a salesperson holding samples shows stock > 0 there).
import { useEffect, useState } from 'react';
import { getStock, AccessError, type StockRowDTO } from '../../../lib/inventoryApi';

type Status = 'loading' | 'ready' | 'denied' | 'error';

export function StockTab({ refreshToken }: { refreshToken: number }) {
  const [status, setStatus] = useState<Status>('loading');
  const [rows, setRows] = useState<StockRowDTO[]>([]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    getStock()
      .then((data) => { if (!cancelled) { setRows(data); setStatus('ready'); } })
      .catch((e) => { if (!cancelled) setStatus(e instanceof AccessError ? 'denied' : 'error'); });
    return () => { cancelled = true; };
  }, [refreshToken]);

  if (status === 'loading') return <Centered>Cargando…</Centered>;
  if (status === 'denied') return <Centered>No tienes acceso a Inventario. Pide acceso a un administrador.</Centered>;
  if (status === 'error') return <Centered>No se pudo cargar el stock.</Centered>;

  const bodegas = rows.filter((r) => r.warehouseType === 'bodega');
  const vendedores = rows.filter((r) => r.warehouseType === 'person');

  return (
    <div style={{ padding: '20px 32px 32px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <StockGroup title="Bodegas" rows={bodegas} emptyLabel="Sin stock en bodegas." />
      <StockGroup title="Vendedores" rows={vendedores} emptyLabel="Ningún vendedor tiene muestras en su poder." />
    </div>
  );
}

function StockGroup({ title, rows, emptyLabel }: { title: string; rows: StockRowDTO[]; emptyLabel: string }) {
  return (
    <div>
      <div style={{ font: 'var(--text-eyebrow)', color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>
        {title} <span style={{ color: 'var(--ink-quiet)' }}>({rows.length})</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)', padding: '4px 0 10px' }}>{emptyLabel}</div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-2xl)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle('left')}>Producto</th>
                <th style={thStyle('left')}>Almacén</th>
                <th style={thStyle('right')}>Stock</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.productName}:${r.warehouseId}`} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={tdStyle('left')}>{r.productName}</td>
                  <td style={tdStyle('left')}>{r.warehouseName}</td>
                  <td style={{ ...tdStyle('right'), font: 'var(--text-label-strong)', color: r.stock < 0 ? 'var(--status-perdida)' : 'var(--ink)' }}>
                    {r.stock.toLocaleString('es-MX')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
  color: 'var(--ink-secondary)',
});

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 200, padding: 24, textAlign: 'center', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
      {children}
    </div>
  );
}
