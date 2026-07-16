// Read-only embellishment summary per product line — the design's per-zona
// técnica/tamaño editor needs structured zone data that only exists on the
// Subelementos de Proyectos board (out of scope here); this renders the real
// Oportunidades-subitem embellishment status + free-text description instead.
// The oportunidades_sub board has no file column for embellecimiento reference
// images, so the per-zone image attach below is client-state only — a visual
// placeholder, lost on refresh, until a real column + upload endpoint exist.
import { useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ColMeta, ItemDTO } from '../../../lib/api';
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

function ZoneImage({ imageUrl, onChange }: { imageUrl?: string; onChange: (dataUrl: string) => void }) {
  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') onChange(reader.result); };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  if (imageUrl) {
    return (
      <label style={{ cursor: 'pointer', flex: 'none' }} title="Cambiar imagen">
        <img src={imageUrl} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }} />
        <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
      </label>
    );
  }

  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', flex: 'none',
      border: '1px dashed var(--ink-faint)', borderRadius: 'var(--radius-md)', padding: '3px 7px',
    }}>
      <ImageIcon size={12} />
      <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>+ imagen</span>
      <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
    </label>
  );
}

export function EmbellecimientosTab({ subCols, products }: { subCols: ColMeta[]; products: ItemDTO[] }) {
  const statusCol = subCols.find((c) => c.id === STATUS_COL);
  const [zoneImages, setZoneImages] = useState<Record<string, string>>({});

  const setZoneImage = (key: string, dataUrl: string) => setZoneImages((imgs) => ({ ...imgs, [key]: dataUrl }));

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
                      <ZoneImage imageUrl={zoneImages[key]} onChange={(dataUrl) => setZoneImage(key, dataUrl)} />
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
