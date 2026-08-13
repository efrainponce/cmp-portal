// Renderiza TODAS las páginas de un PDF a <canvas>, una debajo de otra — no
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
  const containerRef = useRef<HTMLDivElement>(null);
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
    (async () => {
      try {
        const doc = await loadingTask.promise;
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = '';
        const dpr = Math.min(window.devicePixelRatio || 1, 3);

        for (let i = 1; i <= doc.numPages; i++) {
          const pg = await doc.getPage(i);
          if (cancelled) return;
          const unscaled = pg.getViewport({ scale: 1 });
          const cssScale = maxWidth / unscaled.width;
          const cssViewport = pg.getViewport({ scale: cssScale });
          const renderViewport = pg.getViewport({ scale: cssScale * dpr });

          const canvas = document.createElement('canvas');
          // Backing store a resolución de dispositivo (igual que SignaturePad) —
          // sin esto, en pantallas retina el canvas se dibuja a resolución CSS y
          // el navegador lo estira, saliendo borroso.
          canvas.style.width = `${cssViewport.width}px`;
          canvas.style.height = `${cssViewport.height}px`;
          canvas.style.display = 'block';
          canvas.style.boxShadow = 'var(--shadow-modal)';
          if (i > 1) canvas.style.marginTop = '16px';
          canvas.width = renderViewport.width;
          canvas.height = renderViewport.height;
          container.appendChild(canvas);

          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await pg.render({ canvasContext: ctx, viewport: renderViewport, canvas }).promise;
        }
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'No se pudo cargar el PDF.');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; loadingTask.destroy(); };
  }, [url, data, maxWidth]);

  if (error) {
    return <div style={{ font: 'var(--text-label)', color: 'var(--status-perdida)' }}>No se pudo mostrar el PDF: {error}</div>;
  }
  return (
    <div>
      {loading && <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)', marginBottom: 8 }}>Cargando…</div>}
      <div ref={containerRef} />
    </div>
  );
}
