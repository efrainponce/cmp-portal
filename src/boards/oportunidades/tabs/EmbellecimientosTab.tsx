// Read-only embellishment summary per product line — the design's per-zona
// técnica/tamaño editor needs structured zone data that only exists on the
// Subelementos de Proyectos board (out of scope here); this renders the real
// Oportunidades-subitem embellishment status + free-text description instead.
// Per-zone reference images persist to Monday's file_mm5akjy5 column (worker/
// lib/embellecimientoImagenes.ts) — the zone is filename-prefixed since that's
// the only file column on oportunidades_sub, not one per zone.
//
// Versiones: el embellecimiento va pegado a la línea de producto (mismo
// QuoteLineSnapshot que Cotización — cambiar producto, color, cantidad O
// embellecimiento archiva una nueva versión, ver worker/lib/quoteVersions.ts
// linesDiffer). Así que comparte los mismos chips V1/V2… y el mismo botón
// "Enviar a costeo" — no tiene sentido versionar por separado algo que se
// cotiza junto (Efraín, 2026-07-16). Al ver una versión superada se muestra
// su snapshot de zonas (solo lectura); las imágenes de referencia NO se
// versionan (viven en el file column actual del subitem, no hay snapshot
// histórico de archivos), así que solo aparecen en la vigente.
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ColMeta, ItemDTO, QuoteVersionDTO } from '../../../lib/api';
import { getZoneImages, uploadZoneImage } from '../../../lib/api';
import { StatusBadge, MonoTag } from '../../../components/core/Badges';
import { chipFor } from '../../../components/board/cellHelpers';
import { explodeEmbellecimiento } from '../../../lib/embellecimiento';
import { VersionChips } from './CotizacionTab';

const STATUS_COL = 'color_mm1b34bg';
const EMB_LABEL_CON = 'Con Embellecimiento';
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

/** Snapshot de una versión superada: misma forma que SnapshotTable en
 * CotizacionTab, pero mostrando las zonas de embellecimiento por línea en
 * vez del desglose de precio — sin imágenes (esas no se versionan). */
function EmbellecimientoSnapshot({ version }: { version: QuoteVersionDTO }) {
  const embProducts = version.products.filter((p) => p.embellecimiento);
  if (embProducts.length === 0) {
    return (
      <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
        Ninguna línea de esta versión estaba marcada "Con Embellecimiento".
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {embProducts.map((p, i) => {
        const zones = explodeEmbellecimiento(p.descripcionEmbellecimiento, true);
        return (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 14, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{p.producto}</div>
              {p.sku && <MonoTag>{p.sku}</MonoTag>}
              <StatusBadge
                label={p.embellecimiento ? 'Con Embellecimiento' : 'Sin Embellecimiento'}
                color={p.embellecimiento ? '#00b461' : '#68737d'}
                tint={p.embellecimiento ? '#d6f5e6' : '#e6e9eb'}
              />
            </div>
            {zones.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {zones.map((z) => (
                  <div key={z.label} style={{ font: 'var(--text-body)', color: 'var(--ink-secondary)' }}>
                    <span style={{ color: 'var(--ink)' }}>{z.label}:</span> {z.value}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ font: 'var(--text-body)', color: 'var(--ink-faint)' }}>
                — sin descripción de embellecimiento —
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function EmbellecimientosTab({
  subCols, products, versions = [], onNuevaVersion,
}: {
  subCols: ColMeta[]; products: ItemDTO[];
  versions?: QuoteVersionDTO[]; onNuevaVersion?: () => void;
}) {
  const statusCol = subCols.find((c) => c.id === STATUS_COL);
  const [zoneImages, setZoneImages] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const selectedVersion = selectedVersionId != null ? versions.find((v) => v.id === selectedVersionId) : undefined;

  // Solo las líneas marcadas "Con Embellecimiento" en Cotización aparecen aquí
  // (Efraín, 2026-07-16) — el toggle vive en CotizacionTab, esta tab es lectura
  // + captura de zonas/imágenes para las que sí tienen.
  const embProducts = products.filter((p) => p.cols[STATUS_COL]?.text === EMB_LABEL_CON);

  const productIds = embProducts.map((p) => p.id).join(',');
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

  if (selectedVersion) {
    return (
      <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
        <VersionChips versions={versions} selected={selectedVersionId} onSelect={setSelectedVersionId} />
        <EmbellecimientoSnapshot version={selectedVersion} />
      </div>
    );
  }

  if (embProducts.length === 0) {
    return (
      <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
        <VersionChips versions={versions} selected={selectedVersionId} onSelect={setSelectedVersionId} onNuevaVersion={onNuevaVersion} />
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
          {products.length === 0
            ? 'Sin líneas de producto registradas.'
            : 'Ninguna línea está marcada "Con Embellecimiento" — márcalas en la tab Cotizaciones.'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <VersionChips versions={versions} selected={selectedVersionId} onSelect={setSelectedVersionId} onNuevaVersion={onNuevaVersion} />
      {embProducts.map((p) => {
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
