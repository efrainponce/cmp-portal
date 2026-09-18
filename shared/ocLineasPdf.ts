// shared/ocLineasPdf.ts — las LÍNEAS de una orden de compra, leídas de su PDF
// (chevron de la Lista de OC, 2026-09-18).
//
// Misma razón que shared/ocMontoPdf.ts: las líneas del Proyecto no dicen a qué
// OC pertenecen, y una OC reemplazada ya no se parece a lo que hay hoy en el
// proyecto. Lo que se le pidió al proveedor en ESA orden solo lo sabe su PDF.
//
// Se lee por GEOMETRÍA, no por orden de lectura: pdfjs entrega cada fragmento
// con su posición, el encabezado de la tabla da la x de cada columna, y los
// números (cantidad/precio/subtotal) van en la primera línea del renglón — el
// texto largo de producto o talla se envuelve HACIA ABAJO desde ahí. Hay 4
// variantes de encabezado (con/sin UNIDAD y MODELO/COLOR); las columnas se
// toman de las que el PDF traiga.

export interface PdfItem { str: string; x: number; y: number; page: number }

export interface OcLineaPdf {
  producto: string;
  modelo: string;
  unidad: string;
  talla: string;
  cantidad: number;
  precio: number;
  descuento: string;
  subtotal: number;
}

export interface OcLineasPdf {
  lineas: OcLineaPdf[];
  /** Σ subtotal de las líneas. Quien llama lo compara con el subtotal de la
   * orden: si no dan, a la tabla le falta algo y hay que avisarlo. */
  suma: number;
}

const COLUMNAS: Record<string, keyof OcLineaPdf | 'moneda'> = {
  'PRODUCTO': 'producto', 'MODELO/COLOR': 'modelo', 'UNIDAD': 'unidad', 'MONEDA': 'moneda', 'TALLA': 'talla',
  'CANTIDAD': 'cantidad', 'PRECIO': 'precio', 'DESCUENTO': 'descuento', 'SUBTOTAL': 'subtotal',
};
/** Lo que viene después de la tabla; de aquí para abajo ya no hay líneas. */
const FIN_DE_TABLA = /^(M[ée]todo de pago|Condiciones de pago|Importe en letras)/i;

function num(s: string): number {
  return Number(s.replace(/[$,\s]/g, ''));
}

/** null = el PDF no trae una tabla de líneas reconocible (OC-200 a 205). Pura. */
export function lineasDeItemsOc(items: PdfItem[]): OcLineasPdf | null {
  const cabeza = items.find(i => i.str.trim() === 'PRODUCTO');
  if (!cabeza) return null;
  const cols = items
    .filter(i => i.page === cabeza.page && Math.abs(i.y - cabeza.y) < 2 && i.str.trim() in COLUMNAS)
    .sort((a, b) => a.x - b.x)
    .map(i => ({ campo: COLUMNAS[i.str.trim()], x: i.x }));
  const tiene = (c: string) => cols.some(k => k.campo === c);
  if (!tiene('cantidad') || !tiene('precio') || !tiene('subtotal')) return null;
  // Los números van centrados bajo su rótulo y pueden arrancar un poco antes.
  const columnaDe = (x: number) => {
    let campo = cols[0].campo;
    for (const c of cols) if (x >= c.x - 12) campo = c.campo;
    return campo;
  };

  // Por página: solo lo que queda entre el encabezado (si la página lo repite)
  // y el bloque de pago/totales.
  const paginas = [...new Set(items.map(i => i.page))].filter(p => p >= cabeza.page).sort((a, b) => a - b);
  const celdas: (PdfItem & { campo: string })[] = [];
  for (const p of paginas) {
    const dePagina = items.filter(i => i.page === p);
    const head = dePagina.find(i => i.str.trim() === 'PRODUCTO');
    const techo = head ? head.y - 2 : Infinity;
    const fin = dePagina.filter(i => FIN_DE_TABLA.test(i.str.trim())).reduce((m, i) => Math.max(m, i.y), -Infinity);
    for (const i of dePagina) if (i.y < techo && i.y > fin) celdas.push({ ...i, campo: columnaDe(i.x) });
    if (fin > -Infinity) break; // la tabla acaba aquí; lo demás son firmas o anexos
  }

  // Ancla de renglón: un importe en SUBTOTAL con su cantidad a la misma altura.
  const anclas = celdas
    .filter(c => c.campo === 'subtotal' && /^\$/.test(c.str.trim())
      && celdas.some(q => q.campo === 'cantidad' && q.page === c.page && Math.abs(q.y - c.y) < 3 && Number.isFinite(num(q.str))))
    .sort((a, b) => a.page - b.page || b.y - a.y);
  if (anclas.length === 0) return null;

  const lineas: OcLineaPdf[] = anclas.map((a, n) => {
    const sig = anclas[n + 1];
    const piso = sig && sig.page === a.page ? sig.y + 5 : -Infinity;
    // El texto envuelto que brincó a la página siguiente, antes de su primer
    // renglón, sigue siendo de este.
    const mias = celdas.filter(c =>
      (c.page === a.page && c.y <= a.y + 5 && c.y > piso)
      || (sig && sig.page !== a.page && c.page === sig.page && c.y > sig.y + 5));
    const texto = (campo: string) => mias.filter(c => c.campo === campo)
      .sort((p, q) => p.page - q.page || q.y - p.y || p.x - q.x).map(c => c.str.trim()).join(' ').replace(/\s+/g, ' ').trim();
    return {
      producto: texto('producto'),
      modelo: texto('modelo').replace(/^,\s*/, ''),
      unidad: texto('unidad'),
      talla: texto('talla'),
      cantidad: num(texto('cantidad')),
      precio: num(texto('precio')),
      descuento: texto('descuento'),
      subtotal: num(a.str),
    };
  });
  if (lineas.some(l => !Number.isFinite(l.cantidad) || !Number.isFinite(l.precio) || !Number.isFinite(l.subtotal))) return null;
  return { lineas, suma: Math.round(lineas.reduce((s, l) => s + l.subtotal, 0) * 100) / 100 };
}

/** ¿Las líneas leídas explican el subtotal de la orden? Un centavo por renglón
 * de holgura por el redondeo. */
export function lineasCuadran(r: OcLineasPdf, subtotal: number | null): boolean {
  return subtotal != null && Math.abs(r.suma - subtotal) <= Math.max(0.02, r.lineas.length * 0.01);
}
