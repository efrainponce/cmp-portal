// Miniaturas + vista previa embebida de los PDFs de cotización (solicitud de
// costeo / sin firmar / firmada) — mismos archivos que DocumentacionTab
// (file_mm0z6rze / file_mm0fgrzq / file_mm0zjras), pero visibles aquí para no
// tener que cambiar de pestaña.
//
// pdfjs-dist (~370 KB min) se carga de forma diferida: PdfCanvasPreview entra
// vía React.lazy y warmPdfWorker vía import() dinámico, así el chunk del
// drawer no arrastra pdf.js para oportunidades sin PDF. La precarga en el
// useEffect de abajo dispara la descarga del chunk + worker + bytes del PDF en
// cuanto se sabe que hay PDF que ver, no al clic — misma latencia percibida
// (~500 ms) que cuando era import estático.
import { lazy, Suspense, useEffect, useState } from 'react';
import { Modal } from '../../../../components/core/Modal';

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
function PdfIcon({ color }: { color: string }) {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
      <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill={color} opacity=".14" />
      <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" stroke={color} strokeWidth="1.4" />
      <path d="M14 2v5h5" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
      <text x="12" y="17.5" textAnchor="middle" fontSize="6.5" fontWeight="700" fill={color}>PDF</text>
    </svg>
  );
}

type PdfKind = 'solicitud_costeo' | 'sin_firmar' | 'firmada';

const PDF_LABEL: Record<PdfKind, string> = {
  solicitud_costeo: 'Cotización — solicitud de costeo',
  sin_firmar: 'Cotización — sin firmar',
  firmada: 'Cotización — firmada',
};

/** Miniatura de un PDF de cotización — tarjeta de ícono clicable. "Ver" abre
 * la vista previa embebida (modal); "Descargar" fuerza la descarga del mismo
 * endpoint, sin depender del link crudo de Monday. */
function PdfThumb({ oppId, kind, available, label, accentColor, onPreview }: {
  oppId: string; kind: PdfKind; available: boolean; label: string; accentColor: string; onPreview: () => void;
}) {
  const href = `/api/oportunidades/${oppId}/cotizacion-pdf/${kind}`;
  return (
    <div style={{ width: 108 }}>
      <div style={{
        font: '600 10px \'Inter\', sans-serif', color: accentColor, textTransform: 'uppercase',
        letterSpacing: '.3px', marginBottom: 6,
      }}>
        {label}
      </div>
      {available ? (
        <>
          <div
            onClick={onPreview}
            style={{
              cursor: 'pointer', width: 108, height: 92, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <PdfIcon color={accentColor} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 4 }}>
            <span onClick={onPreview} style={{ cursor: 'pointer', font: 'var(--text-caption)', color: 'var(--accent)' }}>Ver</span>
            <span style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>·</span>
            <a href={href} download style={{ font: 'var(--text-caption)', color: 'var(--accent)', textDecoration: 'none' }}>Descargar</a>
          </div>
        </>
      ) : (
        <div style={{
          width: 108, height: 92, border: '1px dashed var(--ink-faint)', borderRadius: 'var(--radius-lg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 8,
        }}>
          <span style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>Sin PDF</span>
        </div>
      )}
    </div>
  );
}

/** Solicitud de costeo, y cotización sin firmar / firmada por el vendedor, lado a lado. */
export function CotizacionPdfRow({ oppId, hasSolicitud, hasSinFirmar, hasFirmada }: {
  oppId?: string; hasSolicitud: boolean; hasSinFirmar: boolean; hasFirmada: boolean;
}) {
  const [preview, setPreview] = useState<PdfKind | null>(null);
  const [bytes, setBytes] = useState<Partial<Record<PdfKind, ArrayBuffer>>>({});

  // Precarga en cuanto se sabe que hay PDF que ver — no espera al clic en
  // "Ver". Así, cuando el usuario abre el modal, el chunk de pdf.js, su worker
  // y los bytes del PDF ya están listos (o casi) en vez de arrancar la
  // descarga ahí mismo, que es lo que hacía sentir lenta la primera apertura.
  useEffect(() => {
    if (!oppId || (!hasSolicitud && !hasSinFirmar && !hasFirmada)) return;
    import('../../../../components/core/PdfCanvasPreview').then((m) => m.warmPdfWorker()).catch(() => {});
    let cancelled = false;
    const kinds: PdfKind[] = [];
    if (hasSolicitud) kinds.push('solicitud_costeo');
    if (hasSinFirmar) kinds.push('sin_firmar');
    if (hasFirmada) kinds.push('firmada');
    kinds.forEach((kind) => {
      fetch(`/api/oportunidades/${oppId}/cotizacion-pdf/${kind}`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((buf) => { if (buf && !cancelled) setBytes((b) => ({ ...b, [kind]: buf })); })
        .catch(() => { /* PdfCanvasPreview reintenta por URL si no hubo prefetch */ });
    });
    return () => { cancelled = true; };
  }, [oppId, hasSolicitud, hasSinFirmar, hasFirmada]);

  if (!oppId || (!hasSolicitud && !hasSinFirmar && !hasFirmada)) return null;
  return (
    <>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <PdfThumb oppId={oppId} kind="solicitud_costeo" available={hasSolicitud} label="Solicitud de costeo" accentColor="var(--status-en-coste)" onPreview={() => setPreview('solicitud_costeo')} />
        <PdfThumb oppId={oppId} kind="sin_firmar" available={hasSinFirmar} label="Sin firmar" accentColor="var(--status-esperando)" onPreview={() => setPreview('sin_firmar')} />
        <PdfThumb oppId={oppId} kind="firmada" available={hasFirmada} label="Firmada" accentColor="var(--status-ganada)" onPreview={() => setPreview('firmada')} />
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
              data={bytes[preview]}
              maxWidth={712}
            />
          </Suspense>
        </Modal>
      )}
    </>
  );
}
