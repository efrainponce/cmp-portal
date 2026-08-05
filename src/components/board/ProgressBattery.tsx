// Barra segmentada de avance para "Ejecución" (post-venta): un vistazo de si un
// proyecto va bien o mal, mismo espíritu que la batería nativa de Monday
// (lookup_mm20g4n6, sumType allStatuses) pero calculada del lado del portal para
// poder mostrarla en `compact` (fila de lista) y `full` (header del tab, con
// leyenda). Datos: src/lib/estadoProductoBuckets.ts (lógica pura, testeada aparte).
import type { BatteryData } from '../../lib/estadoProductoBuckets';

interface Props {
  data: BatteryData;
  size?: 'compact' | 'full';
}

export function ProgressBattery({ data, size = 'compact' }: Props) {
  const height = size === 'full' ? 10 : 6;
  const entregado = data.segments.find(s => s.bucket.key === 'entregado')?.weight ?? 0;

  if (data.total === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
        <div style={{ height, borderRadius: height / 2, background: 'var(--bg-sunken)', width: '100%' }} />
        {size === 'full' && (
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>Sin líneas capturadas todavía.</div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: size === 'full' ? 8 : 4, width: '100%' }}>
      <div
        title={data.segments.filter(s => s.weight > 0).map(s => `${s.bucket.label}: ${s.weight}`).join(' · ')}
        style={{ display: 'flex', height, borderRadius: height / 2, overflow: 'hidden', width: '100%', background: 'var(--bg-sunken)' }}
      >
        {data.segments.filter(s => s.weight > 0).map(s => (
          <div key={s.bucket.key} style={{ width: `${s.pct}%`, background: s.bucket.color }} />
        ))}
      </div>
      {size === 'full' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink)' }}>
            {entregado} de {data.total} piezas entregadas
          </div>
          {data.incidencias > 0 && (
            <div style={{
              font: 'var(--text-caption-strong)', color: '#df2f4a', background: '#df2f4a1a',
              padding: '2px 8px', borderRadius: 'var(--radius-pill)',
            }}>
              {data.incidencias} en incidencia/retraso
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginLeft: 'auto' }}>
            {data.segments.filter(s => s.weight > 0).map(s => (
              <div key={s.bucket.key} style={{ display: 'flex', alignItems: 'center', gap: 4, font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: s.bucket.color, flex: 'none' }} />
                {s.bucket.label} ({s.weight})
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
