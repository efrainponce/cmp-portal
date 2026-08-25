// Cotizaciones/solicitudes de costeo son columnas de Oportunidades, aún sin
// endpoint de upload — dropzone deshabilitada "(próximamente)". OC/contrato
// firmado por el cliente sí vive en el Proyecto ligado (file_mm0hayh4) y ya
// tiene upload real — único caso habilitado por ahora (Efraín, 2026-07-17).
//
// 2026-07-25/26: aquí vive la capa de documentos del portal. Dos caminos:
//  · un PDF que YA existe (cotización de Eledo/cmp-tallas) se sella y se le emite
//    una constancia de firma — el original no se puede modificar;
//  · la SOLICITUD DE COSTEO la genera el portal (líneas sin precios) y sale
//    acusada sola por quien la generó, sin pedir firma — también se dispara
//    automáticamente al dar "Mandar a costeo" (ver shared/documents.ts).
// Las cotizaciones al cliente NO las genera el portal: siguen saliendo de Eledo
// (Efraín, 2026-07-26).
import { useState, type ChangeEvent } from 'react';
import type { ItemDetailDTO } from '../../../lib/api';
import { uploadProyectoDocumento, borrarProyectoDocumento, useBoards, colForBoard } from '../../../lib/api';
import { patchItem } from '../../../lib/apiClient';
import { useMe } from '../../../lib/useMe';
import { P_OC_CLIENTE, type ProyectoState } from '../ProyectoSection';
import { DocumentsPanel } from '../../../components/documents/DocumentsPanel';

export const SOLICITUDES_COL = 'file_mm0z6rze'; // Cotizaciones sin precio
export const NO_FIRMADAS_COL = 'file_mm0fgrzq'; // Cotizaciones generadas
export const FIRMADAS_COL = 'file_mm0zjras';    // Cotizaciones Firmadas
export const INVENTARIO_COL = 'file_mm0hpefr';  // Inventario Actual (Imagen)
const FECHA_ENTREGA_COL = 'date_mm0m1vfv';

interface DocFile { url: string; name: string; key?: string; assetId?: number }

/** El `text` de una columna file son las URLs de Monday
 * (…/resources/<assetId>/<nombre>). El assetId se conserva porque es lo único
 * que distingue dos archivos con el MISMO nombre — el caso que originó "quitar"
 * (la misma OC subida dos veces, Efraín 2026-08-19). En items nativos el text
 * es el puro nombre y no hay assetId. */
function parseFiles(text?: string): DocFile[] {
  if (!text) return [];
  return text.split(',').map((s) => s.trim()).filter(Boolean).map((url) => ({
    url,
    name: decodeURIComponent(url.split('/').pop() || url),
    assetId: Number(/\/resources\/(\d+)\//.exec(url)?.[1]) || 0,
  }));
}

/** Última URL subida a una columna de archivo (Monday las agrega en orden de subida). */
export function latestFileUrl(text?: string): string | undefined {
  const files = parseFiles(text);
  return files.length ? files[files.length - 1].url : undefined;
}

/** Archivos de Inventario de una oportunidad, con la URL propia de /api/files/...
 * (durable, no la firmada de Monday) — usado por CotizacionPdfRow para pintar
 * la miniatura junto a Costeo/Sin firmar/Firmada (Efraín, 2026-08-10: "se va a
 * poner a lado de la cotización firmada, con el mismo template"). */
export function inventarioFiles(item: ItemDetailDTO): DocFile[] {
  return toR2Files(parseFiles(item.cols[INVENTARIO_COL]?.text), item.id, 'inventario');
}

/** Reconstruye el key de R2 (durable, sin expirar) en vez de la URL firmada de
 * Monday que trae el mirror — GET /api/files/... cae de vuelta a Monday por sí
 * solo si el archivo (generado por cmp-tallas) aún no está en R2 (ver
 * worker/routes/oportunidades.ts). Estas 3 columnas son de la propia
 * Oportunidad, así que el key usa item.id directo, sin lookup de Proyecto. */
function toR2Files(files: DocFile[], oppId: string, categoria: string): DocFile[] {
  return files.map((f) => {
    // El assetId va al frente del nombre SOLO en las categorías que suben
    // personas (worker/lib/r2.ts, 2026-08-25): ahí dos archivos distintos sí
    // pueden llamarse igual y hasta entonces compartían objeto en R2. Las
    // cotizaciones y solicitudes son GENERADAS: su nombre lleva folio y
    // regenerarlas con el mismo nombre es un reemplazo. Además su key es la
    // identidad del archivo para la firma electrónica (`sourceId` de
    // FileSignature) — cambiarlo desligaría las constancias ya asentadas.
    const prefijo = categoria === 'inventario' && f.assetId ? `${f.assetId}-` : '';
    const key = `oportunidades/${oppId}/${categoria}/${prefijo}${encodeURIComponent(f.name)}`;
    return { ...f, key, url: `/api/files/${key}` };
  });
}

export function DocumentacionTab({ item, proyecto }: { item: ItemDetailDTO; proyecto?: ProyectoState }) {
  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <DocSection title="Solicitudes de costeo" signable files={toR2Files(parseFiles(item.cols[SOLICITUDES_COL]?.text), item.id, 'solicitud-costeo')} uploadLabel="Subir solicitud de costeo" />

      <div>
        <SectionTitle>Cotizaciones</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 10 }}>
          {/* Las generadas se pueden firmar electrónicamente aquí mismo: el PDF
              se sella (SHA-256) y la firma queda en su constancia. */}
          <DocSection title={null} accentColor="var(--status-esperando)" label="No firmadas por vendedor" signable files={toR2Files(parseFiles(item.cols[NO_FIRMADAS_COL]?.text), item.id, 'cotizacion-no-firmada')} uploadLabel="Subir cotización" />
          <DocSection title={null} accentColor="var(--status-ganada)" label="Firmadas por vendedor" files={toR2Files(parseFiles(item.cols[FIRMADAS_COL]?.text), item.id, 'cotizacion-firmada')} uploadLabel="Subir cotización firmada" />
        </div>
      </div>

      <FechaEntregaField proyecto={proyecto} />

      <OcContratoSection proyecto={proyecto} oppId={item.id} />

      <div>
        <SectionTitle>Documentos del portal</SectionTitle>
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 2, marginBottom: 8 }}>
          La solicitud de costeo la genera el portal con las líneas de esta oportunidad, sin precios. Se acusa
          sola con la cuenta de quien la genera — también sale automáticamente al dar "Mandar a costeo".
        </div>
        <DocumentsPanel
          sourceKind="oportunidad"
          sourceId={item.id}
          templates={['solicitud-costeo']}
          filter={PORTAL_DOCS_ONLY}
        />
      </div>
    </div>
  );
}

/** El listado de una oportunidad trae también las constancias de sus archivos
 * (comparten prefijo de source_id); esas se muestran junto a su archivo, no aquí. */
const PORTAL_DOCS_ONLY = (doc: { sourceKind: string }) => doc.sourceKind === 'oportunidad';

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)' }}>{children}</div>;
}

function DocSection({ title, subtitle, label, accentColor, files, uploadLabel, signable }: {
  title: string | null; subtitle?: string; label?: string; accentColor?: string;
  files: DocFile[]; uploadLabel: string; signable?: boolean;
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
      {signable && files.map((f) => (
        f.key ? <FileSignature key={f.key} file={{ ...f, key: f.key }} /> : null
      ))}
    </div>
  );
}

/** Firma electrónica de un PDF que el portal no generó: se sella una copia en R2
 * y la firma vive en su constancia (shared/documents.ts explica por qué el
 * original no se toca). */
function FileSignature({ file }: { file: DocFile & { key: string } }) {
  return (
    <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 6 }}>
        Firma electrónica de <strong style={{ color: 'var(--ink-secondary)' }}>{file.name}</strong>
      </div>
      <DocumentsPanel
        sourceKind="archivo"
        sourceId={file.key}
        sourceLabel={file.name}
        templates={['constancia-firma']}
      />
    </div>
  );
}

function FileListOrEmpty({ files, onDelete, borrando }: {
  files: DocFile[]; onDelete?: (f: DocFile) => void; borrando?: string | null;
}) {
  if (files.length === 0) return <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>Sin documentos.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
      {files.map((f, i) => {
        const enCurso = borrando === fileKey(f);
        return (
          <div
            key={i}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', background: '#fff' }}
          >
            <a
              href={f.url}
              target="_blank"
              rel="noreferrer"
              style={{ flex: 1, minWidth: 0, font: 'var(--text-body-strong)', color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}
            >
              {f.name}
            </a>
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(f)}
                disabled={enCurso}
                title="Borrar el documento (también en Monday)"
                style={{
                  border: 'none', background: 'none', padding: '2px 4px', cursor: enCurso ? 'default' : 'pointer',
                  font: 'var(--text-caption-strong)', color: enCurso ? 'var(--ink-faint)' : 'var(--ink-quiet)', flex: 'none',
                }}
              >
                {enCurso ? 'Borrando…' : 'Borrar'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Identidad de una fila de la lista: el assetId cuando lo hay (dos archivos se
 * pueden llamar igual), el nombre en items nativos. */
function fileKey(f: DocFile): string {
  return f.assetId ? String(f.assetId) : f.name;
}

/** Fecha de entrega del proyecto — obligatoria, la captura el vendedor
 * (Efraín, 2026-08-05). Guarda al cambiar el date picker, sin botón de
 * submit; mientras esté vacía se marca en rojo como pendiente. */
export function FechaEntregaField({ proyecto }: { proyecto?: ProyectoState }) {
  const me = useMe();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const p = proyecto?.proyecto;
  const stored = p?.cols[FECHA_ENTREGA_COL]?.text ?? '';
  const canEdit = me?.role === 'vendedor' || me?.role === 'admin';
  const isEmpty = stored.trim() === '';

  const save = async (raw: string) => {
    if (!p || raw === stored) return;
    setSaving(true);
    setError(null);
    try {
      await patchItem('proyectos', p.id, { [FECHA_ENTREGA_COL]: raw });
      proyecto?.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  if (!p) return null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <SectionTitle>Fecha de entrega del proyecto *</SectionTitle>
        {saving && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>guardando…</span>}
      </div>
      {canEdit ? (
        <input
          type="date"
          defaultValue={stored}
          key={stored}
          onChange={(e) => void save(e.target.value)}
          style={{
            padding: '8px 10px', border: `1px solid ${isEmpty ? 'var(--status-perdida)' : 'var(--border)'}`,
            borderRadius: 'var(--radius-lg)', background: 'var(--bg)', color: 'var(--ink)', font: 'var(--text-label)',
          }}
        />
      ) : (
        <div style={{ font: 'var(--text-label)', color: isEmpty ? 'var(--ink-faint)' : 'var(--ink-secondary)' }}>
          {isEmpty ? 'Sin definir' : stored}
        </div>
      )}
      {isEmpty && (
        <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)', marginTop: 4 }}>
          Este campo es obligatorio.
        </div>
      )}
      {error && (
        <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)', marginTop: 4 }}>{error}</div>
      )}
    </div>
  );
}

/** Único upload real de esta pestaña: sube al Proyecto ligado (file_mm0hayh4),
 * no a la Oportunidad — el resto de las secciones se queda deshabilitado. */
export function OcContratoSection({ proyecto, oppId }: { proyecto?: ProyectoState; oppId: string | null }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  // Refleja ColMeta.w (shared/visibility.ts) en vez de repetir la whitelist aquí.
  const { boards } = useBoards();
  const canDelete = !!colForBoard(boards, 'proyectos').find((c) => c.id === P_OC_CLIENTE)?.w;

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

  // Borra en el portal y en Monday a la vez (worker/lib/archivoBorrado.ts, que
  // respalda los bytes antes). El server solo deja borrar lo que uno subió — si
  // fue alguien más responde con ese mensaje y se muestra tal cual.
  const handleDelete = async (f: DocFile) => {
    const p = proyecto?.proyecto;
    if (!p) return;
    if (!confirm(`¿Borrar "${f.name}"?\n\nSe quita del portal y de Monday. El portal guarda una copia de respaldo.`)) return;
    setBorrando(fileKey(f));
    setError(null);
    const res = await borrarProyectoDocumento(p.id, { assetId: f.assetId ?? 0, nombre: f.name });
    setBorrando(null);
    if (!res.ok) { setError(res.error ?? 'No se pudo borrar el documento.'); return; }
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
  // Obligatorio antes de "Validar tallas (vendedor)" — el server ya lo bloquea
  // (worker/lib/proyectoTallas.ts checkOcCliente), esto es el warning en el
  // board mismo para que no se descubra hasta que el botón truene (Efraín, 2026-08-10).
  const isMissing = !!p && files.length === 0;

  return (
    <div>
      <SectionTitle>
        Órdenes de compra / contrato firmado{isMissing && <span style={{ color: 'var(--status-perdida)' }}> *</span>}
      </SectionTitle>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 2, marginBottom: 4 }}>
        Orden de compra, cotización firmada por el cliente o contrato firmado.
      </div>
      <label style={{
        display: 'flex', alignItems: 'center', gap: 10, border: `1px dashed ${error || isMissing ? 'var(--status-perdida)' : 'var(--ink-faint)'}`,
        borderRadius: 'var(--radius-lg)', padding: '10px 12px', marginTop: 6, marginBottom: 10, background: 'var(--bg)',
        cursor: canUpload && !uploading ? 'pointer' : 'default', opacity: canUpload ? 1 : .6,
      }}>
        <span style={{ font: 'var(--text-label)', color: error ? 'var(--status-perdida)' : 'var(--ink-secondary)' }}>
          {uploading ? 'Subiendo…' : error ? `Error — reintentar (${error})` : hint ?? 'Subir orden de compra o contrato'}
        </span>
        <input type="file" onChange={handleFile} style={{ display: 'none' }} disabled={!canUpload || uploading} />
      </label>
      <FileListOrEmpty files={files} onDelete={canDelete ? handleDelete : undefined} borrando={borrando} />
      {isMissing && (
        <div style={{
          marginTop: 8, padding: '8px 10px', border: '1px solid var(--status-perdida)', borderRadius: 'var(--radius-lg)',
          background: 'var(--status-perdida-tint)', font: 'var(--text-caption-strong)', color: 'var(--status-perdida)',
        }}>
          Obligatorio: sin este documento no se puede enviar a validación de tallas.
        </div>
      )}
    </div>
  );
}
