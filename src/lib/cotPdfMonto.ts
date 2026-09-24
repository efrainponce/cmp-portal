// Lee Fecha / Subtotal / IVA / Total del PDF de una cotización, en el navegador
// (pdfjs no corre en el Worker). Arrastra pdfjs-dist: se importa SIEMPRE con
// import() dinámico desde CotListaBoard, nunca estático.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fechaDeTextoCot, montoDeTextoCot, type CotMontoPdf } from '../../shared/cotMontoPdf';

GlobalWorkerOptions.workerSrc = workerUrl;

export interface CotPdfDatos { fecha: string | null; monto: CotMontoPdf | null }

/** Truena si el PDF no se pudo bajar o abrir — eso sí se reintenta en otra visita. */
export async function leerDatosDeCotizacion(url: string): Promise<CotPdfDatos> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`PDF ${res.status}`);
  const tarea = getDocument({ data: new Uint8Array(await res.arrayBuffer()) });
  try {
    const doc = await tarea.promise;
    let texto = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const contenido = await (await doc.getPage(i)).getTextContent();
      texto += contenido.items.map(it => ('str' in it ? it.str : '')).filter(s => s.trim()).join(' | ') + '\n';
    }
    return { fecha: fechaDeTextoCot(texto), monto: montoDeTextoCot(texto) };
  } finally {
    void tarea.destroy();
  }
}
