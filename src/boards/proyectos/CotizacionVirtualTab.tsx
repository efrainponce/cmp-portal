// Cotización virtual del Proyecto (Efraín, 2026-08-10): mismas líneas vigentes
// de la Oportunidad ligada, con ajustes de división/edición encima que viven
// SOLO en D1 (worker/lib/proyectoCotizacionVirtual.ts) — nunca se escribe nada
// a Monday desde aquí. No hay selector de versión mayor ni "+ Nueva versión":
// solo retoques V{n}.{m}, mismo espíritu que "Ajustar línea" en Oportunidades
// pero sin tocar el mirror. No reusa CotizacionTab/QuoteRow (están duros a
// ItemDTO + escrituras directas a Monday) — grid propio y liviano sobre
// QuoteLineSnapshot.
import { useEffect, useState } from 'react';
import type { AjusteDTO, CostoDivergenciaDTO, ItemDTO, QuoteLineSnapshot } from '../../lib/api';
import { getCotizacionVirtual, listItems } from '../../lib/apiClient';
import { useMe } from '../../lib/useMe';
import { fmtMoney } from '../../lib/format';
import { AjustarLineaVirtualModal } from './AjustarLineaVirtualModal';

function rowStyle(kind: 'header' | 'body' | 'footer'): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 8,
    borderBottom: kind === 'body' ? '1px solid var(--border)' : 'none',
    background: kind === 'body' ? 'transparent' : 'var(--bg-sunken)',
    padding: '9px 12px',
  };
}

const cellStyle: React.CSSProperties = { flex: 1, font: 'var(--text-label)', color: 'var(--ink)', minWidth: 0 };

export function CotizacionVirtualTab({ proyectoId }: { proyectoId: string }) {
  const me = useMe();
  const [lines, setLines] = useState<QuoteLineSnapshot[] | null>(null);
  const [ajustes, setAjustes] = useState<AjusteDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ItemDTO[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [target, setTarget] = useState<{ lineaId: number; linea: QuoteLineSnapshot } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    setError(null);
    getCotizacionVirtual(proyectoId)
      .then((data) => { setLines(data.lines); setAjustes(data.ajustes); })
      .catch(() => setError('No se pudo cargar la cotización.'));
  };

  useEffect(() => {
    load();
    listItems('productos').then(setCatalog).catch(() => {}).finally(() => setCatalogLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoId]);

  if (error) return <div style={{ padding: 24, color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>;
  if (lines === null) return <div style={{ padding: 24, color: 'var(--ink-quiet)', font: 'var(--text-label)' }}>Cargando…</div>;

  // Precio de Venta: solo vendedor/compras/admin lo ven (shared/visibility.ts,
  // grupo V) — mismo criterio aquí para almacen/otros roles del Proyecto.
  const canAjustar = me?.role === 'vendedor' || me?.role === 'compras' || me?.role === 'admin';
  const total = lines.reduce((sum, l) => sum + (l.precioUnitario ?? 0) * l.cantidad, 0);

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 16 }}>
        Cotización de la Oportunidad ligada. Dividir o editar una línea aquí vive
        solo en este Proyecto — nunca se escribe en Monday ni cambia lo que ve
        Ventas en la Oportunidad.
      </div>

      {notice && (
        <div style={{
          marginBottom: 16, padding: '10px 14px', border: '1px solid var(--accent)',
          borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)',
          font: 'var(--text-label)', color: 'var(--ink-secondary)',
        }}>
          {notice}
        </div>
      )}

      {lines.length === 0 ? (
        <div style={{ padding: 24, color: 'var(--ink-quiet)', font: 'var(--text-label)' }}>Sin líneas de cotización.</div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <div style={rowStyle('header')}>
            <div style={{ ...cellStyle, fontWeight: 700 }}>Producto</div>
            <div style={{ ...cellStyle, fontWeight: 700 }}>Color</div>
            <div style={{ ...cellStyle, fontWeight: 700 }}>Cantidad</div>
            <div style={{ ...cellStyle, fontWeight: 700 }}>Embellecimiento</div>
            <div style={{ ...cellStyle, fontWeight: 700 }}>Precio</div>
            <div style={{ ...cellStyle, fontWeight: 700 }}>Subtotal</div>
            <div style={{ ...cellStyle, flex: '0 0 110px' }} />
          </div>
          {lines.map((l) => (
            <div key={l.subitemId} style={rowStyle('body')}>
              <div style={cellStyle}>
                {l.producto}
                {l.sku ? <span style={{ color: 'var(--ink-quiet)' }}> · {l.sku}</span> : null}
              </div>
              <div style={cellStyle}>{l.color || '—'}</div>
              <div style={cellStyle}>{l.cantidad}</div>
              <div style={cellStyle}>{l.embellecimiento ? 'Con' : 'Sin'}</div>
              <div style={cellStyle}>{fmtMoney(l.precioUnitario ?? 0)}</div>
              <div style={cellStyle}>{fmtMoney((l.precioUnitario ?? 0) * l.cantidad)}</div>
              <div style={{ ...cellStyle, flex: '0 0 110px', textAlign: 'right' }}>
                {canAjustar && l.subitemId != null && (
                  <button
                    type="button"
                    onClick={() => setTarget({ lineaId: l.subitemId!, linea: l })}
                    title="Cambiar producto, color, embellecimiento o cantidad"
                    style={{ border: 'none', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', font: 'var(--text-label-strong)', textDecoration: 'underline' }}
                  >
                    Editar/Dividir
                  </button>
                )}
              </div>
            </div>
          ))}
          <div style={rowStyle('footer')}>
            <div style={{ ...cellStyle, fontWeight: 700 }}>Total</div>
            <div style={cellStyle} />
            <div style={cellStyle} />
            <div style={cellStyle} />
            <div style={cellStyle} />
            <div style={{ ...cellStyle, fontWeight: 700 }}>{fmtMoney(total)}</div>
            <div style={{ ...cellStyle, flex: '0 0 110px' }} />
          </div>
        </div>
      )}

      {ajustes.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {ajustes.map((a) => (
            <div
              key={a.subversion}
              title={`${a.resumen} — ${a.viewerEmail}, ${a.createdAt}`}
              style={{
                padding: '3px 8px', borderRadius: 999, border: '1px dashed var(--border)',
                font: 'var(--text-caption)', color: 'var(--ink-tertiary)',
              }}
            >
              .{a.subversion}
            </div>
          ))}
        </div>
      )}

      {target && (
        <AjustarLineaVirtualModal
          proyectoId={proyectoId}
          lineaId={target.lineaId}
          linea={target.linea}
          catalog={catalog}
          catalogLoading={catalogLoading}
          onClose={() => setTarget(null)}
          onSaved={(divergencia: CostoDivergenciaDTO | undefined) => {
            setNotice(divergencia
              ? `Costo distribuidor cambió ${Math.round(divergencia.pctDiff * 100)}% — se avisó a Compras.`
              : null);
            load();
          }}
        />
      )}
    </div>
  );
}
