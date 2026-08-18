// Visor de archivos dentro del portal. Los PDFs de cotización ya se veían así
// (Modal + PdfCanvasPreview); esto extiende el mismo trato a las imágenes:
// antes, ver la imagen de referencia de un embellecimiento significaba abrir
// /api/files/... en otra pestaña, y como esos assets salen de Monday sin tipo
// (application/octet-stream) el navegador los DESCARGABA (Efraín, 2026-08-18).
// El Content-Type ya se corrige en el worker (worker/lib/mime.ts), pero abrir
// aquí evita la pestaña extra y deja la imagen junto a la posición que describe.
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Modal } from './Modal';

// pdf.js (~370 KB) sigue siendo lazy — un archivo de embellecimiento casi
// siempre es imagen, no hay por qué cargar el visor de PDF para eso.
const PdfCanvasPreview = lazy(() =>
  import('./PdfCanvasPreview').then((m) => ({ default: m.PdfCanvasPreview })),
);

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'heic', 'heif'];

function extOf(name: string): string {
  const base = name.split('?')[0].split('#')[0].split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase();
}

/** Nombre legible a partir de la URL — los keys de R2 vienen url-encoded
 * (`.../Frente/logo%20frente.png`). */
function fileNameFromUrl(url: string): string {
  const last = url.split('?')[0].split('#')[0].split('/').pop() ?? '';
  try {
    return decodeURIComponent(last) || 'archivo';
  } catch {
    return last || 'archivo';
  }
}

const linkStyle = { font: 'var(--text-label)', color: 'var(--accent)', textDecoration: 'none' } as const;

/** Modal de vista previa. `name` solo decide cómo se dibuja y qué nombre lleva
 * la descarga; por default sale de la URL, y los bytes siempre salen de `url`. */
export function FilePreviewModal({ url, name, onClose }: {
  url: string;
  name?: string;
  onClose: () => void;
}) {
  const fileName = name ?? fileNameFromUrl(url);
  const ext = extOf(fileName);
  const [imgFailed, setImgFailed] = useState(false);

  let body: ReactNode;
  if (ext === 'pdf') {
    body = (
      <Suspense fallback={<div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Cargando…</div>}>
        <PdfCanvasPreview url={url} maxWidth={712} />
      </Suspense>
    );
  } else if (IMAGE_EXT.includes(ext) && !imgFailed) {
    body = (
      <img
        src={url}
        alt={fileName}
        onError={() => setImgFailed(true)}
        style={{ display: 'block', maxWidth: '100%', maxHeight: 'calc(100vh - 260px)', margin: '0 auto', borderRadius: 'var(--radius-lg)' }}
      />
    );
  } else {
    // Formatos que el navegador no dibuja (HEIC de iPhone en Chrome, .ai,
    // .cdr…) — el archivo existe, solo no se puede previsualizar aquí.
    body = (
      <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)', textAlign: 'center', padding: '24px 0' }}>
        No se puede mostrar este archivo aquí. Descárgalo para verlo.
      </div>
    );
  }

  return (
    <Modal
      title={fileName}
      onClose={onClose}
      width={760}
      footer={
        <>
          <a href={url} target="_blank" rel="noreferrer" style={linkStyle}>Abrir en pestaña</a>
          <a href={url} download={fileName} style={linkStyle}>Descargar</a>
        </>
      }
    >
      {body}
    </Modal>
  );
}
