// Cotizaciones/solicitudes de costeo son columnas de Oportunidades, aún sin
// endpoint de upload — dropzone deshabilitada "(próximamente)". OC/contrato
// firmado por el cliente sí vive en el Proyecto ligado (file_mm0hayh4) y ya
// tiene upload real — único caso habilitado por ahora (Efraín, 2026-07-17).
import { useState, type ChangeEvent } from 'react';
import type { ItemDetailDTO } from '../../../lib/api';
import { uploadProyectoDocumento } from '../../../lib/api';
import { P_OC_CLIENTE, type ProyectoState } from '../ProyectoSection';

const SOLICITUDES_COL = 'file_mm0z6rze';       // Cotizaciones sin precio
export const NO_FIRMADAS_COL = 'file_mm0fgrzq'; // Cotizaciones generadas
export const FIRMADAS_COL = 'file_mm0zjras';    // Cotizaciones Firmadas

interface DocFile { url: string; name: string }

function parseFiles(text?: string): DocFile[] {
  if (!text) return [];
  return text.split(',').map((s) => s.trim()).filter(Boolean).map((url) => ({
    url,
    name: decodeURIComponent(url.split('/').pop() || url),
  }));
}

/** Última URL subida a una columna de archivo (Monday las agrega en orden de subida). */
export function latestFileUrl(text?: string): string | undefined {
  const files = parseFiles(text);
  return files.length ? files[files.length - 1].url : undefined;
}

/** Reconstruye el key de R2 (durable, sin expirar) en vez de la URL firmada de
 * Monday que trae el mirror — GET /api/files/... cae de vuelta a Monday por sí
 * solo si el archivo (generado por cmp-tallas) aún no está en R2 (ver
 * worker/routes/oportunidades.ts). Estas 3 columnas son de la propia
 * Oportunidad, así que el key usa item.id directo, sin lookup de Proyecto. */
function toR2Files(files: DocFile[], oppId: string, categoria: string): DocFile[] {
  return files.map((f) => ({ ...f, url: `/api/files/oportunidades/${oppId}/${categoria}/${encodeURIComponent(f.name)}` }));
}

export function DocumentacionTab({ item, proyecto }: { item: ItemDetailDTO; proyecto?: ProyectoState }) {
  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <DocSection title="Solicitudes de costeo" files={toR2Files(parseFiles(item.cols[SOLICITUDES_COL]?.text), item.id, 'solicitud-costeo')} uploadLabel="Subir solicitud de costeo" />

      <div>
        <SectionTitle>Cotizaciones</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 10 }}>
          <DocSection title={null} accentColor="var(--status-esperando)" label="No firmadas por vendedor" files={toR2Files(parseFiles(item.cols[NO_FIRMADAS_COL]?.text), item.id, 'cotizacion-no-firmada')} uploadLabel="Subir cotización" />
          <DocSection title={null} accentColor="var(--status-ganada)" label="Firmadas por vendedor" files={toR2Files(parseFiles(item.cols[FIRMADAS_COL]?.text), item.id, 'cotizacion-firmada')} uploadLabel="Subir cotización firmada" />
        </div>
      </div>

      <OcContratoSection proyecto={proyecto} oppId={item.id} />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)' }}>{children}</div>;
}

function DocSection({ title, subtitle, label, accentColor, files, uploadLabel }: {
  title: string | null; subtitle?: string; label?: string; accentColor?: string; files: DocFile[]; uploadLabel: string;
}) {
  return (
    <div>
      {title && <SectionTitle>{title}</SectionTitle>}
      {subtitle && <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 2, marginBottom: 4 }}>{subtitle}</div>}
      {label && (
        <div style={{ font: '600 10.5px \'Inter\', sans-serif', color: accentColor, textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 8 }}>
          {label}
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, border: '1px dashed var(--ink-faint)', borderRadius: 'var(--radius-lg)',
        padding: '10px 12px', marginTop: title || label ? 6 : 0, marginBottom: 10, background: 'var(--bg)', opacity: .6,
      }}>
        <span style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>{uploadLabel} (próximamente)</span>
      </div>
      <FileListOrEmpty files={files} />
    </div>
  );
}

function FileListOrEmpty({ files }: { files: DocFile[] }) {
  if (files.length === 0) return <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>Sin documentos.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
      {files.map((f, i) => (
        <a
          key={i}
          href={f.url}
          target="_blank"
          rel="noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', background: '#fff', textDecoration: 'none' }}
        >
          <div style={{ font: 'var(--text-body-strong)', color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
        </a>
      ))}
    </div>
  );
}

/** Único upload real de esta pestaña: sube al Proyecto ligado (file_mm0hayh4),
 * no a la Oportunidad — el resto de las secciones se queda deshabilitado. */
export function OcContratoSection({ proyecto, oppId }: { proyecto?: ProyectoState; oppId: string | null }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const p = proyecto?.proyecto;
    if (!file || !p) return;
    setUploading(true);
    setError(null);
    const res = await uploadProyectoDocumento(p.id, file);
    setUploading(false);
    if (!res.ok) { setError(res.error ?? 'No se pudo subir el archivo.'); return; }
    proyecto?.reload();
  };

  const p = proyecto?.proyecto;
  // Reconstruye el key de R2 (durable, sin expirar) en vez de usar la URL
  // firmada de Monday que trae el mirror — GET /api/files/... cae de vuelta
  // a Monday por sí solo si el archivo aún no se migró (ver worker/routes/oportunidades.ts).
  const files = p && oppId ? parseFiles(p.cols[P_OC_CLIENTE]?.text).map((f) => ({
    ...f, url: `/api/files/oportunidades/${oppId}/documento/${encodeURIComponent(f.name)}`,
  })) : [];
  const canUpload = !!p;
  const hint = !proyecto || proyecto.loading ? 'Buscando el proyecto ligado…'
    : !p ? 'Esta oportunidad aún no tiene Proyecto en Monday — se crea al GANAR la oportunidad.'
    : null;

  return (
    <div>
      <SectionTitle>Órdenes de compra / contrato firmado</SectionTitle>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 2, marginBottom: 4 }}>
        Orden de compra, cotización firmada por el cliente o contrato firmado.
      </div>
      <label style={{
        display: 'flex', alignItems: 'center', gap: 10, border: `1px dashed ${error ? 'var(--status-perdida)' : 'var(--ink-faint)'}`,
        borderRadius: 'var(--radius-lg)', padding: '10px 12px', marginTop: 6, marginBottom: 10, background: 'var(--bg)',
        cursor: canUpload && !uploading ? 'pointer' : 'default', opacity: canUpload ? 1 : .6,
      }}>
        <span style={{ font: 'var(--text-label)', color: error ? 'var(--status-perdida)' : 'var(--ink-secondary)' }}>
          {uploading ? 'Subiendo…' : error ? `Error — reintentar (${error})` : hint ?? 'Subir orden de compra o contrato'}
        </span>
        <input type="file" onChange={handleFile} style={{ display: 'none' }} disabled={!canUpload || uploading} />
      </label>
      <FileListOrEmpty files={files} />
    </div>
  );
}
