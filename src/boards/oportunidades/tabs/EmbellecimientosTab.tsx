// Read-only embellishment summary per product line — the design's per-zona
// técnica/tamaño editor needs structured zone data that only exists on the
// Subelementos de Proyectos board (out of scope here); this renders the real
// Oportunidades-subitem embellishment status + free-text description instead.
// Per-zone reference images persist to Monday's file_mm5akjy5 column (worker/
// lib/embellecimientoImagenes.ts) — the zone is filename-prefixed since that's
// the only file column on oportunidades_sub, not one per zone.
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ColMeta, ItemDTO } from '../../../lib/api';
import { getZoneImages, uploadZoneImage } from '../../../lib/api';
import { StatusBadge, MonoTag } from '../../../components/core/Badges';
import { chipFor } from '../../../components/board/cellHelpers';
import { explodeEmbellecimiento } from '../../../lib/embellecimiento';

const STATUS_COL = 'color_mm1b34bg';
const DESC_COL = 'long_text_mm1bj4pt';
const SKU_COL = 'lookup_mkzn7x9a';
const NAME_COL = 'lookup_mm0x4kda';

const ImageIcon = ({ size = 14, color = '#918b7c' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="1.8" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);

function ZoneImage({ imageUrl, uploading, error, onUpload }: {
  imageUrl?: string; uploading: boolean; error?: string; onUpload: (file: File) => void;
}) {
  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    e.target.value = '';
  };

  if (imageUrl) {
    return (
      <label style={{ cursor: uploading ? 'default' : 'pointer', flex: 'none', opacity: uploading ? 0.6 : 1 }} title={error || 'Cambiar imagen'}>
        <img
          src={imageUrl}
          alt=""
          style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid ' + (error ? 'var(--status-perdida)' : 'var(--border)') }}
        />
        <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} disabled={uploading} />
      </label>
    );
  }

  return (
    <label
      title={error}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, cursor: uploading ? 'default' : 'pointer', flex: 'none',
        border: '1px dashed ' + (error ? 'var(--status-perdida)' : 'var(--ink-faint)'), borderRadius: 'var(--radius-md)',
        padding: '3px 7px', opacity: uploading ? 0.6 : 1,
      }}
    >
      <ImageIcon size={12} />
      <span style={{ font: 'var(--text-caption)', color: error ? 'var(--status-perdida)' : 'var(--ink-tertiary)' }}>
        {uploading ? 'Subiendo…' : error ? 'Error — reintentar' : '+ imagen'}
      </span>
      <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} disabled={uploading} />
    </label>
  );
}

export function EmbellecimientosTab({ subCols, products }: { subCols: ColMeta[]; products: ItemDTO[] }) {
  const statusCol = subCols.find((c) => c.id === STATUS_COL);
  const [zoneImages, setZoneImages] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const productIds = products.map((p) => p.id).join(',');
  useEffect(() => {
    let cancelled = false;
    for (const id of productIds ? productIds.split(',') : []) {
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
  }, [productIds]);

  const handleUpload = async (productId: string, zone: string, file: File) => {
    const key = `${productId}:${zone}`;
    setUploading((u) => ({ ...u, [key]: true }));
    setErrors((e) => { const next = { ...e }; delete next[key]; return next; });

    const res = await uploadZoneImage(productId, zone, file);

    setUploading((u) => ({ ...u, [key]: false }));
    if (res.ok && res.url) {
      setZoneImages((imgs) => ({ ...imgs, [key]: res.url! }));
    } else {
      setErrors((e) => ({ ...e, [key]: res.error ?? 'No se pudo subir la imagen.' }));
    }
  };

  if (products.length === 0) {
    return (
      <div style={{ padding: '24px 32px 40px', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
        Sin líneas de producto registradas.
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {products.map((p) => {
        const statusVal = statusCol ? p.cols[STATUS_COL] : undefined;
        const zones = explodeEmbellecimiento(p.cols[DESC_COL]?.text, true);
        return (
          <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 14, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{p.cols[NAME_COL]?.text || p.name}</div>
              {p.cols[SKU_COL]?.text && <MonoTag>{p.cols[SKU_COL].text}</MonoTag>}
              {statusVal?.text && statusCol && (() => {
                const { label, color, tint } = chipFor(statusCol, statusVal);
                return <StatusBadge label={label} color={color} tint={tint} />;
              })()}
            </div>
            {zones.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {zones.map((z) => {
                  const key = `${p.id}:${z.label}`;
                  return (
                    <div key={z.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ font: 'var(--text-body)', color: 'var(--ink-secondary)', flex: 1 }}>
                        <span style={{ color: 'var(--ink)' }}>{z.label}:</span> {z.value}
                      </div>
                      <ZoneImage
                        imageUrl={zoneImages[key]}
                        uploading={!!uploading[key]}
                        error={errors[key]}
                        onUpload={(file) => handleUpload(p.id, z.label, file)}
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
            <div style={{ marginTop: 10, font: 'var(--text-small-strong)', color: 'var(--ink-faint)', cursor: 'default' }}>
              + Agregar posición (próximamente)
            </div>
          </div>
        );
      })}
    </div>
  );
}
