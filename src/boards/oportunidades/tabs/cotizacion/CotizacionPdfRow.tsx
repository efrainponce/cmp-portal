// Miniaturas + vista previa embebida de los PDFs de cotización (solicitud de
// costeo / sin firmar / firmada) — mismos archivos que DocumentacionTab
// (file_mm0z6rze / file_mm0fgrzq / file_mm0zjras), pero visibles aquí para no
// tener que cambiar de pestaña.
//
// pdfjs-dist (~370 KB min) se carga de forma diferida: PdfCanvasPreview entra
// vía React.lazy, así el chunk del drawer no arrastra pdf.js. Ni el chunk ni
// los bytes del PDF se piden hasta que alguien da clic en "Ver" — abrir la
// oportunidad no debe costar nada aquí (ver el comentario en CotizacionPdfRow).
import { lazy, Suspense, useEffect, useState, type ChangeEvent } from 'react';
import { Modal } from '../../../../components/core/Modal';
import { useMe } from '../../../../lib/useMe';
import { puedeVerUtilidades } from '../../../../../shared/visibility';
import { uploadOportunidadInventario } from '../../../../lib/api';
import { inventarioFiles } from '../DocumentacionTab';
import type { ItemDetailDTO } from '../../../../lib/api';
import { listDocuments, documentPdfUrl, type DocumentDTO } from '../../../../lib/documentsApi';
import { toast } from '../../../../components/core/Toaster';

const PdfCanvasPreview = lazy(() =>
  import('../../../../components/core/PdfCanvasPreview').then((m) => ({ default: m.PdfCanvasPreview })),
);

// La miniatura es un ícono de documento reconocible, no un render real de la
// página — el clic abre un modal que sí renderiza la página real (ver
// PdfCanvasPreview: un <embed>/<iframe> con el link crudo de Monday
// (protected_static) exige sesión de monday.com y bloquea framing por CSP, y
// el visor de PDF nativo del navegador dentro de un iframe resultó no ser
// confiable ni en Chrome real. El PDF se resuelve vía un endpoint propio que
// transmite los bytes ya resueltos por la API de Monday (mismo
// mecanismo que las imágenes de embellecimiento — worker/lib/cotizacionPdfs.ts).
export function PdfIcon({ color, size = 34 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill={color} opacity=".14" />
      <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" stroke={color} strokeWidth="1.4" />
      <path d="M14 2v5h5" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
      <text x="12" y="17.5" textAnchor="middle" fontSize="6.5" fontWeight="700" fill={color}>PDF</text>
    </svg>
  );
}

type PdfKind = 'solicitud_costeo' | 'sin_firmar' | 'firmada';

/** Cuándo aparece cada PDF. El cuadro vacío lo dice en vez de "Sin PDF": en
 * Clarity la gente le daba clic esperando que hiciera algo (clic muerto). */
const PDF_CUANDO: Record<PdfKind, string> = {
  solicitud_costeo: 'Sale al mandar a costeo',
  sin_firmar: 'Sale al generar la cotización',
  firmada: 'Se firma en Documentación',
};

const PDF_LABEL: Record<PdfKind, string> = {
  solicitud_costeo: 'Cotización — solicitud de costeo',
  sin_firmar: 'Cotización — sin firmar',
  firmada: 'Cotización — firmada',
};

const chipBase = {
  display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 10px', boxSizing: 'border-box',
  borderRadius: 'var(--radius-lg)', font: 'var(--text-label-strong)', whiteSpace: 'nowrap',
} as const;

/** Un documento de la cotización en UN renglón: ícono + nombre (clic = ver) y
 * la flecha de descarga. Antes eran cuadros de 108×92 con "Ver · Descargar"
 * debajo: ~130 px de alto en cada oportunidad, y los vacíos (punteados, "Aún no
 * hay") se veían como botones — en Clarity eran el clic muerto más repetido
 * (2026-10-01). Lo que todavía no existe ahora es texto gris, sin caja. */
function DocChip({ label, color, onView, viewHref, downloadHref, title }: {
  label: string; color: string; onView?: () => void; viewHref?: string; downloadHref?: string; title?: string;
}) {
  const nombre = (
    <>
      <PdfIcon color={color} size={18} />
      <span>{label}</span>
    </>
  );
  return (
    <span style={{ ...chipBase, border: '1px solid var(--border)', background: '#fff', color: 'var(--ink)', padding: 0, overflow: 'hidden' }}>
      {viewHref ? (
        <a href={viewHref} target="_blank" rel="noreferrer" title={title ?? `Ver ${label}`} className="doc-chip-btn"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: '100%', padding: '0 10px', color: 'inherit', textDecoration: 'none' }}>
          {nombre}
        </a>
      ) : (
        <button type="button" onClick={onView} title={title ?? `Ver ${label}`} className="doc-chip-btn"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: '100%', padding: '0 10px', border: 'none', background: 'transparent', font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
          {nombre}
        </button>
      )}
      {downloadHref && (
        <a href={downloadHref} download title={`Descargar ${label}`} aria-label={`Descargar ${label}`} className="doc-chip-btn"
          style={{ display: 'inline-flex', alignItems: 'center', height: '100%', padding: '0 9px', borderLeft: '1px solid var(--border)', color: 'var(--accent)', textDecoration: 'none' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
          </svg>
        </a>
      )}
    </span>
  );
}

/** Documento que todavía no existe: texto, no caja. `cuando` va de tooltip. */
function DocPendiente({ label, cuando }: { label: string; cuando?: string }) {
  return (
    <span title={cuando} style={{ ...chipBase, padding: '0 4px', font: 'var(--text-label)', color: 'var(--ink-faint)', cursor: 'default' }}>
      {label}: aún no
    </span>
  );
}

function PdfThumb({ oppId, kind, available, label, accentColor, onPreview }: {
  oppId: string; kind: PdfKind; available: boolean; label: string; accentColor: string; onPreview: () => void;
}) {
  if (!available) return <DocPendiente label={label} cuando={PDF_CUANDO[kind]} />;
  return <DocChip label={label} color={accentColor} onView={onPreview} downloadHref={`/api/oportunidades/${oppId}/cotizacion-pdf/${kind}`} />;
}

/** Vista previa de la Cotización armada nativa por el portal (2026-08-13, mismo
 * template visual que la OC a Proveedor) — SOLO preview dentro del portal, no
 * reemplaza la cotización oficial que sigue saliendo de Eledo. Se genera al
 * vuelo desde el mirror, así que siempre está disponible en cuanto hay líneas
 * de producto (a diferencia de los PdfThumb de al lado, que dependen de un
 * archivo ya subido a Monday). */
function CotizacionPreviewThumb({ oppId, hasLineas }: { oppId: string; hasLineas: boolean }) {
  const [preview, setPreview] = useState(false);
  const url = `/api/oportunidades/${oppId}/cotizacion-preview/pdf`;
  if (!hasLineas) return null;
  return (
    <>
      <DocChip
        label="Vista previa" color="var(--accent)" onView={() => setPreview(true)}
        title="Vista previa de la cotización armada por el portal — no es la oficial (esa sigue saliendo de Eledo)"
      />
      {preview && (
        <Modal title="Cotización — vista previa (portal)" onClose={() => setPreview(false)} width={760}>
          <Suspense fallback={<div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Generando…</div>}>
            <PdfCanvasPreview url={url} maxWidth={712} />
          </Suspense>
          <a href={url} download style={{ display: 'inline-block', marginTop: 12, font: 'var(--text-label)', color: 'var(--accent)' }}>
            Descargar
          </a>
        </Modal>
      )}
    </>
  );
}

/** Hoja de costeo en horizontal (todas las columnas de Costeo) que sale sola al
 * dar "Mandar a Validación de costeo" — ESTE chip solo lo monta compras/admin
 * (ver el filtro en CotizacionPdfRow más abajo), y el server la vuelve a filtrar
 * igual por rol (`DOC_TEMPLATES['validacion-costeo'].view`, worker/lib/documents.ts):
 * un vendedor nunca ve costos ni utilidad (Efraín, 2026-08-14).
 * La búsqueda es solo metadata (GET /api/documents), nunca los bytes del PDF —
 * esos se piden hasta dar clic, mismo criterio que el resto de la fila. Mientras
 * busca (o si no existe) no pinta nada: va al final de la fila, así que no
 * empuja a nadie al aparecer. */
function ValidacionCosteoThumb({ oppId }: { oppId: string }) {
  const [doc, setDoc] = useState<DocumentDTO | null | undefined>(undefined);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    let alive = true;
    listDocuments('oportunidad', oppId)
      .then((docs) => { if (alive) setDoc(docs.find((d) => d.templateId === 'validacion-costeo') ?? null); })
      .catch(() => { if (alive) setDoc(null); });
    return () => { alive = false; };
  }, [oppId]);

  if (!doc) return null;
  const url = documentPdfUrl(doc, false);
  return (
    <>
      <DocChip
        label="Validación" color="var(--status-esperando)" onView={() => setPreview(true)} downloadHref={url}
        title="Hoja de costeo completa (todas las columnas), generada sola al mandar a validación"
      />
      {preview && (
        <Modal title="Costeo — Validación" onClose={() => setPreview(false)} width={760}>
          <Suspense fallback={<div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Cargando…</div>}>
            <PdfCanvasPreview url={url} maxWidth={712} />
          </Suspense>
          <a href={url} download style={{ display: 'inline-block', marginTop: 12, font: 'var(--text-label)', color: 'var(--accent)' }}>
            Descargar
          </a>
        </Modal>
      )}
    </>
  );
}

/** "Inventario Actual (Imagen)" — upload real (Compras/admin, `w: WAC` en
 * shared/visibility.ts): sin archivo, el chip ES el botón de subir; con archivo
 * ya subido, se ve como link directo (no siempre es PDF, así que sin el preview
 * de pdf.js) y al lado queda "Reemplazar". */
function InventarioThumb({ oppId, item, onUploaded }: { oppId: string; item: ItemDetailDTO; onUploaded?: () => void }) {
  const me = useMe();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canUpload = me?.role === 'compras' || me?.role === 'admin';
  const files = inventarioFiles(item);
  const latest = files[files.length - 1];

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    const res = await uploadOportunidadInventario(oppId, file);
    setUploading(false);
    if (!res.ok) { setError(res.error ?? 'No se pudo subir.'); toast(res.error ?? 'No se pudo subir el inventario.', 'error'); return; }
    toast('Inventario subido');
    onUploaded?.();
  };

  const subir = (texto: string) => (
    <label
      title={error ?? undefined}
      style={{
        ...chipBase, cursor: uploading ? 'default' : 'pointer',
        border: `1px dashed ${error ? 'var(--status-perdida)' : 'var(--accent)'}`,
        color: error ? 'var(--status-perdida)' : 'var(--accent)',
      }}
    >
      {uploading ? 'Subiendo…' : error ? 'No se subió — reintentar' : texto}
      <input type="file" onChange={handleFile} style={{ display: 'none' }} disabled={uploading} />
    </label>
  );

  if (latest) {
    return (
      <>
        <DocChip label="Inventario" color="var(--status-en-coste)" viewHref={latest.url} />
        {canUpload && subir('Reemplazar inventario')}
      </>
    );
  }
  return canUpload ? subir('+ Subir inventario') : null;
}

/** Solicitud de costeo, y cotización sin firmar / firmada por el vendedor, lado a lado
 * + Inventario (Efraín, 2026-08-10). */
export function CotizacionPdfRow({ oppId, item, hasSolicitud, hasSinFirmar, hasFirmada, hasLineas = false, onInventarioUploaded }: {
  oppId?: string; item?: ItemDetailDTO; hasSolicitud: boolean; hasSinFirmar: boolean; hasFirmada: boolean;
  /** true si la oportunidad ya tiene líneas de producto — habilita "Vista previa"
   * (portal), que no depende de ningún archivo subido a Monday. */
  hasLineas?: boolean;
  onInventarioUploaded?: () => void;
}) {
  const me = useMe();
  const [preview, setPreview] = useState<PdfKind | null>(null);
  const hasInventario = !!item && inventarioFiles(item).length > 0;
  // Compras siempre ve su cuadro de upload aunque todavía no exista ningún PDF
  // de cotización — si no, no tiene dónde subir el inventario en una
  // oportunidad recién creada (Efraín reportó "no veo donde subir el inventario").
  const canUploadInventario = me?.role === 'compras' || me?.role === 'admin';
  const showInventario = !!(item && (hasInventario || canUploadInventario));
  // Hoja de costeo de Validación: compras/admin (Efraín, 2026-08-14) Y, desde el
  // 2026-08-27, solo la whitelist de utilidades — la hoja lleva utilidad,
  // utilidad % y margen gob por línea, así que sin esto sería la puerta de atrás
  // a lo que las columnas de la grid ya no enseñan. El server manda igual
  // (DOC_TEMPLATES['validacion-costeo'].requiereUtilidades → 404); esto es solo
  // no ofrecer un botón que va a fallar.
  const showValidacionCosteo = (me?.role === 'compras' || me?.role === 'admin')
    && puedeVerUtilidades(me?.email);

  // Los PDFs se bajan al DAR CLIC en "Ver", no al abrir la oportunidad.
  //
  // Antes esto precargaba los tres PDFs completos (arrayBuffer) en cuanto el
  // drawer montaba, para que el modal abriera instantáneo. Medido en una
  // máquina lenta con red de 1.5 Mbps (scripts/perf-bench.mjs), eso costaba
  // 1.83 MB y ~10 s en CADA apertura de oportunidad — y la miniatura ni
  // siquiera usa esos bytes: es un ícono SVG (ver PdfIcon), no un render del
  // PDF. O sea, se pagaba el ancho de banda de tres PDFs para dibujar tres
  // íconos, y quien nunca daba clic en "Ver" los bajaba igual (Efraín,
  // 2026-08-13). PdfCanvasPreview ya sabe bajar por `url` cuando no recibe
  // `data`, así que el modal se encarga solo.

  if (!oppId || (!hasSolicitud && !hasSinFirmar && !hasFirmada && !hasLineas && !showInventario && !showValidacionCosteo)) return null;
  return (
    <>
      {/* flexWrap: en mobile (390px) los chips bajan a una segunda línea en vez
          de desbordarse (Efraín, 2026-08-14: "en mobil la barra de archivos
          esta un poco rota"). */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <PdfThumb oppId={oppId} kind="solicitud_costeo" available={hasSolicitud} label="Costeo" accentColor="var(--status-en-coste)" onPreview={() => setPreview('solicitud_costeo')} />
        <PdfThumb oppId={oppId} kind="sin_firmar" available={hasSinFirmar} label="Sin firmar" accentColor="var(--status-esperando)" onPreview={() => setPreview('sin_firmar')} />
        <PdfThumb oppId={oppId} kind="firmada" available={hasFirmada} label="Firmada" accentColor="var(--status-ganada)" onPreview={() => setPreview('firmada')} />
        <CotizacionPreviewThumb oppId={oppId} hasLineas={hasLineas} />
        {showValidacionCosteo && <ValidacionCosteoThumb oppId={oppId} />}
        {showInventario && item && <InventarioThumb oppId={oppId} item={item} onUploaded={onInventarioUploaded} />}
      </div>
      {preview && (
        <Modal
          title={PDF_LABEL[preview]}
          onClose={() => setPreview(null)}
          width={760}
        >
          <Suspense fallback={<div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Cargando…</div>}>
            <PdfCanvasPreview
              url={`/api/oportunidades/${oppId}/cotizacion-pdf/${preview}`}
              maxWidth={712}
            />
          </Suspense>
        </Modal>
      )}
    </>
  );
}
