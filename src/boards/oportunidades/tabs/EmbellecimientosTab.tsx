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
import { patchItem } from '../../../lib/apiClient';
import { StatusBadge, MonoTag } from '../../../components/core/Badges';
import { Button } from '../../../components/core/Button';
import { chipFor } from '../../../components/board/cellHelpers';
import { EMBELL_TEMPLATE_KEYS, explodeEmbellecimiento, upsertEmbellZone } from '../../../lib/embellecimiento';
import { VersionChips } from './cotizacion/VersionChips';

const STATUS_COL = 'color_mm1b34bg';
const EMB_LABEL_CON = 'Con Embellecimiento';
const DESC_COL = 'long_text_mm1bj4pt';
const FILE_COL = 'file_mm5akjy5';
const SKU_COL = 'lookup_mkzn7x9a';
const NAME_COL = 'lookup_mm0x4kda';

const ImageIcon = ({ size = 14, color = '#918b7c' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="1.8" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);

const FileIcon = ({ size = 14, color = '#918b7c' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
);

// file_mm5akjy5 es una columna de archivo genérica de Monday, no solo imágenes
// (Efraín, 2026-07-16) — sin restricción de accept en el input. Si la URL no
// carga como <img> (PDF, .docx…), cae a un link "Ver archivo" en vez de intentar
// previsualizarlo.
function ZoneImage({ imageUrl, uploading, error, onUpload, canUpload }: {
  imageUrl?: string; uploading: boolean; error?: string; onUpload: (file: File) => void; canUpload: boolean;
}) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    e.target.value = '';
  };

  if (imageUrl) {
    const thumb = previewFailed ? (
      <div style={{
        width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 'var(--radius-md)', border: '1px solid ' + (error ? 'var(--status-perdida)' : 'var(--border)'), background: 'var(--bg-sunken)',
      }}>
        <FileIcon size={14} />
      </div>
    ) : (
      <img
        src={imageUrl}
        alt=""
        onError={() => setPreviewFailed(true)}
        style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid ' + (error ? 'var(--status-perdida)' : 'var(--border)') }}
      />
    );
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
        {canUpload ? (
          <label style={{ cursor: uploading ? 'default' : 'pointer', flex: 'none', opacity: uploading ? 0.6 : 1 }} title={error || 'Cambiar imagen o archivo'}>
            {thumb}
            <input type="file" onChange={handleFile} style={{ display: 'none' }} disabled={uploading} />
          </label>
        ) : thumb}
        <a href={imageUrl} target="_blank" rel="noreferrer" title="Ver archivo" style={{ color: 'var(--ink-tertiary)', display: 'flex' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <path d="M15 3h6v6" /><path d="M10 14 21 3" />
          </svg>
        </a>
      </div>
    );
  }

  if (!canUpload) return null;

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
        {uploading ? 'Subiendo…' : error ? 'Error — reintentar' : '+ imagen o archivo'}
      </span>
      <input type="file" onChange={handleFile} style={{ display: 'none' }} disabled={uploading} />
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

interface AddPositionState {
  productId: string;
  zone: string;
  desc: string;
  saving: boolean;
  error?: string;
}

export function EmbellecimientosTab({
  subCols, products, versions = [], onNuevaVersion, onSaved, editable = true, readOnly = false,
}: {
  subCols: ColMeta[]; products: ItemDTO[];
  versions?: QuoteVersionDTO[]; onNuevaVersion?: () => void;
  onSaved?: () => void;
  /** false en Ganada/Perdida — sin nuevas posiciones ni imágenes, igual que Cotización. */
  editable?: boolean;
  /** true en el board Costeo — solo lectura, agregar posiciones/imágenes es trabajo de Ventas. */
  readOnly?: boolean;
}) {
  const statusCol = subCols.find((c) => c.id === STATUS_COL);
  const descWritable = editable && !readOnly && !!subCols.find((c) => c.id === DESC_COL)?.w;
  const fileWritable = editable && !readOnly && !!subCols.find((c) => c.id === FILE_COL)?.w;
  const [zoneImages, setZoneImages] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const selectedVersion = selectedVersionId != null ? versions.find((v) => v.id === selectedVersionId) : undefined;
  // Preview local del texto de zonas recién guardado — igual patrón que
  // CotizacionTab: el PATCH ya se aplicó, pero onSaved()/refetch tarda un
  // round-trip; sin esto la zona recién agregada parpadea/desaparece.
  const [descPreview, setDescPreview] = useState<Record<string, string>>({});
  const [addForm, setAddForm] = useState<AddPositionState | null>(null);

  const onStartAdd = (productId: string, zone: string) => setAddForm({ productId, zone, desc: '', saving: false });

  const onSaveZone = async () => {
    if (!addForm) return;
    const { productId, zone } = addForm;
    const desc = addForm.desc.trim();
    if (!desc) { setAddForm({ ...addForm, error: 'Escribe una descripción para la posición.' }); return; }
    setAddForm({ ...addForm, saving: true, error: undefined });
    const product = products.find((p) => p.id === productId);
    const currentRaw = descPreview[productId] ?? product?.cols[DESC_COL]?.text;
    const newRaw = upsertEmbellZone(currentRaw, zone, desc);
    try {
      await patchItem('oportunidades_sub', productId, { [DESC_COL]: newRaw });
    } catch (e) {
      setAddForm({ productId, zone, desc, saving: false, error: e instanceof Error ? e.message : 'No se pudo guardar.' });
      return;
    }
    setDescPreview((cur) => ({ ...cur, [productId]: newRaw }));
    setAddForm(null);
    onSaved?.();
  };

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
        const rawDesc = descPreview[p.id] ?? p.cols[DESC_COL]?.text;
        const zones = explodeEmbellecimiento(rawDesc, true);
        const filledLabels = new Set(zones.map((z) => z.label));
        const availableZones = EMBELL_TEMPLATE_KEYS.filter((k) => !filledLabels.has(k));
        const isAdding = addForm?.productId === p.id;
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
                        canUpload={fileWritable}
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

            {isAdding ? (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 'var(--radius-lg)', background: 'var(--bg-sunken)' }}>
                <select
                  value={addForm.zone}
                  onChange={(e) => setAddForm({ ...addForm, zone: e.target.value })}
                  style={{ font: 'var(--text-label)', color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 7px' }}
                >
                  {availableZones.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
                <textarea
                  value={addForm.desc}
                  onChange={(e) => setAddForm({ ...addForm, desc: e.target.value })}
                  placeholder="Descripción de la posición (técnica, tamaño, referencia)…"
                  rows={2}
                  autoFocus
                  style={{ font: 'var(--text-label)', color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', resize: 'vertical' }}
                />
                {addForm.error && <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>{addForm.error}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="primary" onClick={addForm.saving ? undefined : onSaveZone} style={addForm.saving ? { opacity: 0.6 } : undefined}>
                    {addForm.saving ? 'Guardando…' : 'Guardar posición'}
                  </Button>
                  <Button variant="ghost" onClick={() => setAddForm(null)}>Cancelar</Button>
                </div>
              </div>
            ) : descWritable && availableZones.length > 0 ? (
              <div
                onClick={() => onStartAdd(p.id, availableZones[0])}
                style={{ marginTop: 10, font: 'var(--text-small-strong)', color: 'var(--accent)', cursor: 'pointer' }}
              >
                + Agregar posición
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
