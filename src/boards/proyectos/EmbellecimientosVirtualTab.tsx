// Embellecimientos del Proyecto (Efraín, 2026-08-12): mismo criterio que
// CotizacionVirtualTab — se leen las líneas vigentes de la Oportunidad ligada
// (con los ajustes virtuales del Proyecto ya aplicados, mismo endpoint
// GET .../cotizacion-virtual) y se muestran igual que en Oportunidades
// (zonas + imagen de referencia por zona), pero SOLO LECTURA: capturar zonas
// o subir imágenes sigue siendo exclusivo de la Oportunidad (por eso no hay
// controles de editar/borrar/subir aquí, a diferencia de EmbellecimientosTab).
// Incluye precio unitario y subtotal por línea — Oportunidades no lo muestra
// en esta tab, pero aquí sí se pidió (Efraín, 2026-08-12).
import { useEffect, useState } from 'react';
import type { QuoteLineSnapshot } from '../../lib/api';
import { getCotizacionVirtual, getZoneImages } from '../../lib/apiClient';
import { useMe } from '../../lib/useMe';
import { fmtMoney } from '../../lib/format';
import { StatusBadge, MonoTag, AjusteLabelBadge } from '../../components/core/Badges';
import { explodeEmbellecimiento } from '../../lib/embellecimiento';
import { ZoneImage } from '../oportunidades/tabs/EmbellecimientosTab';

export function EmbellecimientosVirtualTab({ proyectoId }: { proyectoId: string }) {
  const me = useMe();
  const [lines, setLines] = useState<QuoteLineSnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoneImages, setZoneImages] = useState<Record<string, string>>({});

  useEffect(() => {
    setError(null);
    setLines(null);
    getCotizacionVirtual(proyectoId)
      .then((data) => setLines(data.lines))
      .catch(() => setError('No se pudo cargar los embellecimientos.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoId]);

  const embProducts = (lines ?? []).filter((l) => l.embellecimiento);
  // Líneas virtuales (nacidas de un "dividir" en el Proyecto, id negativo) no
  // tienen subitem real en Monday — no hay imágenes que buscar para ellas.
  const realIds = embProducts.map((l) => l.subitemId).filter((id): id is number => id != null && id > 0);
  const realIdsKey = realIds.join(',');

  useEffect(() => {
    let cancelled = false;
    for (const id of realIdsKey ? realIdsKey.split(',') : []) {
      getZoneImages(id).then((imgs) => {
        if (cancelled) return;
        setZoneImages((cur) => {
          const next = { ...cur };
          for (const [zone, url] of Object.entries(imgs)) next[`${id}:${zone}`] = url;
          return next;
        });
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [realIdsKey]);

  // Precio de Venta: solo vendedor/compras/admin lo ven (shared/visibility.ts,
  // grupo V) — mismo criterio que CotizacionVirtualTab.
  const showPrice = me?.role === 'vendedor' || me?.role === 'compras' || me?.role === 'admin';

  if (error) return <div style={{ padding: 24, color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>;
  if (lines === null) return <div style={{ padding: 24, color: 'var(--ink-quiet)', font: 'var(--text-label)' }}>Cargando…</div>;

  if (embProducts.length === 0) {
    return (
      <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
          {lines.length === 0
            ? 'Sin líneas de cotización.'
            : 'Ninguna línea está marcada "Con Embellecimiento".'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 6 }}>
        Embellecimiento de la Oportunidad ligada, solo lectura. Para capturar
        zonas o subir imágenes de referencia usa la Oportunidad ligada.
      </div>
      {embProducts.map((p, i) => {
        const zones = explodeEmbellecimiento(p.descripcionEmbellecimiento, true);
        const subtotal = (p.precioUnitario ?? 0) * p.cantidad;
        return (
          <div key={p.subitemId ?? i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 14, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{p.producto}</div>
              {p.sku && <MonoTag>{p.sku}</MonoTag>}
              {p.color && <span style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>{p.color}</span>}
              <StatusBadge label="Con Embellecimiento" color="#00b461" tint="#d6f5e6" />
              {p.ajusteLabel && <AjusteLabelBadge label={p.ajusteLabel} />}
            </div>
            {zones.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {zones.map((z) => {
                  const key = `${p.subitemId}:${z.label}`;
                  return (
                    <div key={z.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ font: 'var(--text-body)', color: 'var(--ink-secondary)', flex: 1 }}>
                        <span style={{ color: 'var(--ink)' }}>{z.label}:</span> {z.value}
                      </div>
                      <ZoneImage
                        imageUrl={zoneImages[key]}
                        uploading={false}
                        onUpload={() => {}}
                        canUpload={false}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ font: 'var(--text-body)', color: 'var(--ink-faint)' }}>
                — sin descripción de embellecimiento —
              </div>
            )}
            {showPrice && (
              <div style={{ display: 'flex', gap: 16, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>
                <div>Cantidad: <span style={{ color: 'var(--ink)' }}>{p.cantidad}</span></div>
                <div>Precio: <span style={{ color: 'var(--ink)' }}>{fmtMoney(p.precioUnitario ?? 0)}</span></div>
                <div>Subtotal: <span style={{ color: 'var(--ink)' }}>{fmtMoney(subtotal)}</span></div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
