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

function bucketDe(estado: string): EstadoBucketKey | undefined {
  return LABEL_TO_BUCKET[estado];
}

/** Colapsa las líneas por talla en renglones por producto+color, en el orden en
 * que aparecen. El estatus junta los estados con sus piezas cuando las tallas
 * van en pasos distintos ("Entregado 15 · En tránsito 5") y luego el resumen
 * del producto; sin resumen, los comentarios por talla. */
export function agruparPorProductoColor(lineas: EstatusLinea[], resumenes: Record<string, string>): EstatusGrupo[] {
  const resumenPorLlave = new Map<string, string>();
  for (const [k, v] of Object.entries(resumenes)) {
    const [producto, color = ''] = k.split('|');
    if (v.trim()) resumenPorLlave.set(llaveGrupo(producto, color), v.trim());
  }

  const grupos = new Map<string, EstatusLinea[]>();
  for (const l of lineas) {
    const key = llaveGrupo(l.producto, l.color);
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(l);
  }

  return [...grupos.entries()].map(([key, rows]) => {
    const piezasPorEstado = new Map<string, number>();
    for (const r of rows) {
      const estado = r.estado.trim() || ESTADO_DEFAULT;
      piezasPorEstado.set(estado, (piezasPorEstado.get(estado) ?? 0) + r.cantidad);
    }
    const estados = [...piezasPorEstado.entries()];
    const estadoTxt = estados.length === 1
      ? estados[0][0]
      : estados.map(([e, n]) => `${e} ${n}`).join(' · ');
    const detalle = resumenPorLlave.get(key) || unicos(rows.map(r => r.comentario)).join(' / ');

    const buckets = estados.map(([e]) => bucketDe(e));
    const tono: EstatusTono = buckets.includes('incidencia') ? 'incidencia'
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
    };
  });
}

