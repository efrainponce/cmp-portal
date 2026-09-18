// Lee Subtotal / IVA / Total del PDF de una orden de compra, en el navegador
// (pdfjs no corre en el Worker). Este módulo arrastra pdfjs-dist: se importa
// SIEMPRE con import() dinámico desde OcListaBoard, nunca estático.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fechaDeTextoOc, montoDeTextoOc, type OcMontoPdf } from '../../shared/ocMontoPdf';
import { lineasDeItemsOc, type OcLineasPdf, type PdfItem } from '../../shared/ocLineasPdf';

GlobalWorkerOptions.workerSrc = workerUrl;

export interface OcPdfDatos { fecha: string | null; monto: OcMontoPdf | null }

/** Fecha y totales impresos en la orden. Cada uno puede venir null (OC-200 a
 * 205 traen fecha pero no el bloque de totales). Truena si el PDF no se pudo
 * bajar o abrir — eso sí se reintenta en otra visita. */
export async function leerDatosDeOc(url: string): Promise<OcPdfDatos> {
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
    return { fecha: fechaDeTextoOc(texto), monto: montoDeTextoOc(texto) };
  } finally {
    void tarea.destroy();
  }
}

/** Las líneas de la orden, leídas de la tabla de su PDF (chevron de la Lista de
 * OC). null = el PDF no trae una tabla reconocible. */
export async function leerLineasDeOc(url: string): Promise<OcLineasPdf | null> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`No se pudo bajar el PDF (${res.status}).`);
  const tarea = getDocument({ data: new Uint8Array(await res.arrayBuffer()) });
  try {
    const doc = await tarea.promise;
    const items: PdfItem[] = [];
    for (let page = 1; page <= doc.numPages; page++) {
      const contenido = await (await doc.getPage(page)).getTextContent();
      for (const it of contenido.items) {
        if ('str' in it && it.str.trim()) items.push({ str: it.str, x: it.transform[4], y: it.transform[5], page });
      }
    }
    return lineasDeItemsOc(items);
  } finally {
    void tarea.destroy();
  }
}
