// shared/estatusProyecto.ts — lógica PURA del "Estatus de proyecto" (Efraín,
// 2026-09-21): UN renglón por PRODUCTO + COLOR, nunca por talla. La comparten la
// tab "Resumen" del drawer (src/boards/oportunidades/proyecto/ResumenSection.tsx)
// y el PDF (worker/lib/pdf/estatusProyecto.ts): si divergen, lo que se ve en
// pantalla no es lo que se imprime. Anclado en worker/lib/pdf/estatusProyecto.test.ts.
import { LABEL_TO_BUCKET, type EstadoBucketKey } from './estadoProductoBuckets';

/** Una línea del Proyecto (proyectos_sub) = un producto+color+TALLA. */
export interface EstatusLinea {
  producto: string;
  sku: string;
  color: string;
  cantidad: number;
  unidad: string;
  /** Vacío para quien no puede ver proveedores (ventas): la columna no sale. */
  proveedor: string;
  estado: string;
  comentario: string;
  /** Fecha estimada de entrega del proveedor, YYYY-MM-DD o ''. */
  entrega: string;
  /** Nombre del subitem: "✨ <zona>" marca una línea de EMBELLECIMIENTO (su
   * Producto trae el texto de la posición, no un producto). */
  nombre?: string;
  /** Texto de cada zona de embellecimiento de la línea de producto, llave =
   * id de columna (ZONAS_EMBELL). Vacío en las líneas ✨. */
  zonas?: Record<string, string>;
}

/** Columnas de zona de embellecimiento del subitem del Proyecto (título en
 * Monday, shared/column-meta.gen.ts). Import de tallas copia el MISMO texto a la
 * línea "✨ <zona>" que arma la OC al bordador — así se ligan. */
export const ZONAS_EMBELL: readonly { col: string; label: string }[] = [
  { col: 'long_text_mm1cqh8e', label: 'Espalda' },
  { col: 'long_text_mm1cyqts', label: 'Frente derecho' },
  { col: 'long_text_mm1c59cg', label: 'Frente izquierdo' },
  { col: 'long_text_mm1c2eyf', label: 'Manga derecha' },
  { col: 'long_text_mm1cyq91', label: 'Manga izquierda' },
  { col: 'long_text_mm1c6ya0', label: 'Etiqueta del fabricante' },
  { col: 'long_text_mm1cnbbr', label: 'Etiqueta de propiedad' },
  { col: 'long_text_mm2077h1', label: 'Otros' },
];

/** Una zona de embellecimiento de un producto, con el estado de su línea ✨. */
export interface EstatusEmbell {
  zona: string;
  texto: string;
  /** Estado de la línea ✨ ligada; '' si el proyecto no tiene línea para ella. */
  estado: string;
}

export interface EstatusProyecto {
  folio: string;
  nombre: string;
  institucion: string;
  vendedor: string;
  zona: string;
  estadoProyecto: string;
  /** Fecha Entrega del Proyecto (la que sube el vendedor), YYYY-MM-DD o ''. */
  fechaEntrega: string;
  documentacion: string;
  lineas: EstatusLinea[];
  /** Resumen libre por producto+color (producto_resumen), llave `producto|color`. */
  resumenes: Record<string, string>;
}


export type EstatusTono = 'entregado' | 'proceso' | 'incidencia' | 'pendiente';

export interface EstatusGrupo {
  producto: string;
  sku: string;
  color: string;
  proveedor: string;
  cantidad: number;
  unidad: string;
  estatus: string;
  /** Ya formateada ("24-sep-26"); vacía si todo el producto ya se entregó. */
  entrega: string;
  tono: EstatusTono;
  entregadas: number;
  /** Una por zona con texto, en el orden de ZONAS_EMBELL. */
  embellecimientos: EstatusEmbell[];
}

// Mismo default que el chip del tab Ejecución: una línea sin estado todavía no
// tiene OC al proveedor.
const ESTADO_DEFAULT = 'Pendiente OC al Prov';

/** Fondo del renglón por avance — mismos tonos en pantalla y en el PDF. */
export const TONO_FILL: Record<EstatusTono, string | null> = {
  entregado: '#d9f2d0',
  proceso: '#d6ecfa',
  incidencia: '#fbdada',
  pendiente: null,
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2026-09-24" → "24-sep-26". Lo que no parezca fecha se devuelve tal cual. */
export function fechaCorta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso.trim();
  const mes = MESES[Number(m[2]) - 1];
  return mes ? `${m[3]}-${mes}-${m[1].slice(2)}` : iso.trim();
}

/** Misma llave que groupByProductoColor (TallasSection.tsx) — con ella cuadra
 * también el resumen guardado desde el tab Ejecución. */
export function llaveGrupo(producto: string, color: string): string {
  return `${producto.trim().toLowerCase()}|${color.trim().toLowerCase()}`;
}

function unicos(valores: string[]): string[] {
  return [...new Set(valores.map(v => v.trim()).filter(Boolean))];
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** "N/A", "NA", "-", "no aplica" = la zona no lleva nada. */
function zonaVacia(texto: string): boolean {
  const n = norm(texto);
  return !n || n === 'na' || n === 'n a' || n === 'no aplica' || n === 'ninguno' || n === 'sin';
}

export function esLineaEmbell(l: EstatusLinea): boolean {
  return (l.nombre ?? '').trimStart().startsWith('✨');
}

function zonaDeNombre(nombre: string): string {
  return nombre.trim().replace(/^✨\s*/, '').trim();
}

function mismaZona(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  return x === y || (x.length > 3 && y.startsWith(x)) || (y.length > 3 && x.startsWith(y));
}

/** Estados de varias líneas en un texto: uno solo tal cual, mezclados con sus piezas. */
function textoEstados(rows: EstatusLinea[]): string {
  const piezas = new Map<string, number>();
  for (const r of rows) {
    const e = r.estado.trim() || ESTADO_DEFAULT;
    piezas.set(e, (piezas.get(e) ?? 0) + r.cantidad);
  }
  const estados = [...piezas.entries()];
  return estados.length === 1 ? estados[0][0] : estados.map(([e, n]) => `${e} ${n}`).join(' · ');
}

function bucketDe(estado: string): EstadoBucketKey | undefined {
  return LABEL_TO_BUCKET[estado];
}

/** Colapsa las líneas por talla en renglones por producto+color, en el orden en
 * que aparecen. El estatus junta los estados con sus piezas cuando las tallas
 * van en pasos distintos ("Entregado 15 · En tránsito 5") y luego el resumen
 * del producto; sin resumen, los comentarios por talla. */
export function agruparPorProductoColor(lineas: EstatusLinea[], resumenes: Record<string, string>): EstatusGrupo[] {
  return estatusDeLineas(lineas, resumenes).grupos;
}

/** Embellecimientos (Efraín, 2026-09-29): NO son renglones aparte. Cada línea
 * "✨ <zona>" se liga a los productos cuya columna de zona trae el mismo texto
 * (así las crea Importar tallas) y su estado sale en la celda del producto, una
 * línea por zona. Si dos ✨ comparten texto, desempata el nombre de la zona.
 * Las ✨ con texto real que ningún producto reclama salen en `sueltos` para no
 * perderlas; las "N/A" no se muestran. */
export function estatusDeLineas(
  lineas: EstatusLinea[], resumenes: Record<string, string>,
): { grupos: EstatusGrupo[]; sueltos: EstatusEmbell[] } {
  const embells = lineas.filter(esLineaEmbell);
  const usadas = new Set<EstatusLinea>();
  const embellDe = (rows: EstatusLinea[]) => {
    const out: EstatusEmbell[] = [];
    let incidencia = false;
    for (const z of ZONAS_EMBELL) {
      const texto = rows.map(r => (r.zonas?.[z.col] ?? '').trim()).find(t => t && !zonaVacia(t));
      if (!texto) continue;
      let match = embells.filter(e => norm(e.producto) === norm(texto));
      if (match.length > 1) {
        const porZona = match.filter(e => mismaZona(zonaDeNombre(e.nombre ?? ''), z.label));
        if (porZona.length) match = porZona;
      }
      match.forEach(m => usadas.add(m));
      if (match.some(m => bucketDe(m.estado.trim()) === 'incidencia')) incidencia = true;
      out.push({
        zona: match.length ? zonaDeNombre(match[0].nombre ?? '') || z.label : z.label,
        texto,
        estado: match.length ? textoEstados(match) : '',
      });
    }
    return { out, incidencia };
  };

  const resumenPorLlave = new Map<string, string>();
  for (const [k, v] of Object.entries(resumenes)) {
    const [producto, color = ''] = k.split('|');
    if (v.trim()) resumenPorLlave.set(llaveGrupo(producto, color), v.trim());
  }

  const grupos = new Map<string, EstatusLinea[]>();
  for (const l of lineas) {
    if (esLineaEmbell(l)) continue;
    const key = llaveGrupo(l.producto, l.color);
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(l);
  }

  const resultado = [...grupos.entries()].map(([key, rows]) => {
    const estados = [...new Set(rows.map(r => r.estado.trim() || ESTADO_DEFAULT))];
    const estadoTxt = textoEstados(rows);
    const { out: embellecimientos, incidencia: incidenciaEmbell } = embellDe(rows);
    const detalle = resumenPorLlave.get(key) || unicos(rows.map(r => r.comentario)).join(' / ');

    const buckets = estados.map(e => bucketDe(e));
    // Una incidencia en el bordado también pinta de rojo al producto.
    const tono: EstatusTono = buckets.includes('incidencia') || incidenciaEmbell ? 'incidencia'
      : buckets.every(b => b === 'entregado') ? 'entregado'
      : buckets.every(b => b === 'por_surtir' || b === undefined) ? 'pendiente'
      : 'proceso';

    // La fecha que importa es la de lo que FALTA: la más tardía entre las
    // tallas sin entregar. Todo entregado ⇒ vacía, como en la hoja original.
    const fechas = rows
      .filter(r => bucketDe(r.estado.trim() || ESTADO_DEFAULT) !== 'entregado')
      .map(r => r.entrega.trim()).filter(Boolean).sort();
    const entregadas = rows
      .filter(r => bucketDe(r.estado.trim()) === 'entregado')
      .reduce((s, r) => s + r.cantidad, 0);

    return {
      producto: rows[0].producto,
      sku: rows.find(r => r.sku)?.sku ?? '',
      color: rows[0].color,
      proveedor: unicos(rows.map(r => r.proveedor)).join(', '),
      cantidad: rows.reduce((s, r) => s + r.cantidad, 0),
      unidad: unicos(rows.map(r => r.unidad))[0] ?? '',
      estatus: detalle ? `${estadoTxt}. ${detalle}` : estadoTxt,
      entrega: fechas.length ? fechaCorta(fechas[fechas.length - 1]) : '',
      tono,
      entregadas,
      embellecimientos,
    };
  });

  const sueltos = embells
    .filter(e => !usadas.has(e) && !zonaVacia(e.producto) && e.producto !== '—')
    .map(e => ({ zona: zonaDeNombre(e.nombre ?? ''), texto: e.producto, estado: textoEstados([e]) }));
  return { grupos: resultado, sueltos };
}

/** Celda de embellecimientos: UNA línea por zona, "• Zona: texto — estado".
 * El texto se recorta: identifica la posición, el detalle vive en la OC. */
export function textoEmbellecimientos(embs: EstatusEmbell[], max = 45): string {
  if (embs.length === 0) return '—';
  return embs.map(e => {
    const t = e.texto.replace(/\s+/g, ' ').trim();
    const corto = t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
    return `• ${e.zona}: ${corto} — ${e.estado || 'sin línea en el proyecto'}`;
  }).join('\n');
}

