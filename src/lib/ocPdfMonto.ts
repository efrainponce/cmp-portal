// Lee Subtotal / IVA / Total del PDF de una orden de compra, en el navegador
// (pdfjs no corre en el Worker). Este módulo arrastra pdfjs-dist: se importa
// SIEMPRE con import() dinámico desde OcListaBoard, nunca estático.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { montoDeTextoOc, type OcMontoPdf } from '../../shared/ocMontoPdf';

GlobalWorkerOptions.workerSrc = workerUrl;

/** null = el PDF se abrió pero no trae un bloque de totales que cuadre.
 * Truena si el PDF no se pudo bajar o abrir (eso sí se reintenta otro día). */
export async function leerMontoDeOc(url: string): Promise<OcMontoPdf | null> {
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
    return montoDeTextoOc(texto);
  } finally {
    void tarea.destroy();
  }
}
