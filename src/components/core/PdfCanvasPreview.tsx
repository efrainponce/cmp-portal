// Renderiza la primera página de un PDF a un <canvas> con pdfjs-dist — no
// depende del visor de PDF nativo del navegador. Se probó primero un
// <iframe>/<embed> apuntando directo al PDF, pero incluso en Chrome real
// (no solo Chromium headless) la carga se queda colgada sin renderizar nada;
// el comportamiento del visor nativo dentro de un iframe resultó no ser
// confiable, así que esto lo dibuja nosotros mismos con JS puro.
import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, PDFWorker } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

let sharedWorker: PDFWorker | null = null;
/** Arranca la descarga/inicio del worker de pdf.js (~1.2 MB) por adelantado.
 * Llamarla apenas se sepa que hay un PDF que ver (montar la tab), no esperar
 * al clic — así el worker ya está listo cuando se abre el modal, en vez de
 * sumar esa descarga al tiempo de espera percibido. */
export function warmPdfWorker(): PDFWorker {
  if (!sharedWorker) sharedWorker = new PDFWorker();
  return sharedWorker;
}

export function PdfCanvasPreview({ url, data, maxWidth = 700 }: { url: string; data?: ArrayBuffer; maxWidth?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    // getDocument({data}) transfiere el buffer al worker (lo deja inutilizable
    // para una próxima apertura) — se manda una copia, no el buffer prefetched
    // original, para poder reabrir el mismo PDF varias veces sin re-descargar.
    const loadingTask = getDocument(
      data ? { data: data.slice(0), worker: warmPdfWorker() } : { url, worker: warmPdfWorker() },
    );
    loadingTask.promise
      .then((doc) => doc.getPage(1))
      .then((pg) => {
        if (cancelled) return;
        const unscaled = pg.getViewport({ scale: 1 });
        const viewport = pg.getViewport({ scale: maxWidth / unscaled.width });
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        return pg.render({ canvasContext: ctx, viewport, canvas }).promise;
      })
      .then(() => { if (!cancelled) setLoading(false); })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'No se pudo cargar el PDF.');
        setLoading(false);
      });
    return () => { cancelled = true; loadingTask.destroy(); };
  }, [url, data, maxWidth]);

  if (error) {
    return <div style={{ font: 'var(--text-label)', color: 'var(--status-perdida)' }}>No se pudo mostrar el PDF: {error}</div>;
  }
  return (
    <div>
      {loading && <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)', marginBottom: 8 }}>Cargando…</div>}
      <canvas ref={canvasRef} style={{ maxWidth: '100%', display: 'block', boxShadow: 'var(--shadow-modal)' }} />
    </div>
  );
}
