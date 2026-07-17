import type { QuoteVersionDTO } from '../../../../lib/api';
import { fmtMoney } from '../../../../lib/format';
import { MonoTag } from '../../../../components/core/Badges';

/** Instantánea de una versión superada — tabla de solo lectura, sin fórmulas
 * (esas solo existen para la vigente en el mirror de Monday). */
export function SnapshotTable({ version }: { version: QuoteVersionDTO }) {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1.6fr .5fr .7fr .7fr .85fr .85fr',
        padding: '9px 14px', background: 'var(--bg-sunken)', font: '700 9.5px \'Inter\', sans-serif',
        color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '.3px',
      }}>
        <div>Producto</div><div>SKU</div><div>Color</div><div>Cant.</div>
        <div style={{ textAlign: 'right' }}>P. venta C/U</div><div style={{ textAlign: 'right' }}>Subtotal</div>
      </div>
      {version.products.map((p, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '1.6fr .5fr .7fr .7fr .85fr .85fr',
          alignItems: 'center', padding: '9px 14px', background: '#fff', borderTop: '1px solid var(--border-subtle)',
          font: 'var(--text-label)', color: 'var(--ink-secondary)',
        }}>
          <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>
            {p.producto}{p.embellecimiento ? ' 🎨' : ''}
          </div>
          <div>{p.sku ? <MonoTag style={{ display: 'inline-block' }}>{p.sku}</MonoTag> : '—'}</div>
          <div>{p.color || '—'}</div>
          <div>{p.cantidad}</div>
          <div style={{ textAlign: 'right' }}>{p.precioUnitario ? fmtMoney(p.precioUnitario) : '—'}</div>
          <div style={{ textAlign: 'right' }}>{fmtMoney((p.precioUnitario ?? 0) * p.cantidad)}</div>
        </div>
      ))}
    </div>
  );
}
