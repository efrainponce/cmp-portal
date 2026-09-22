// worker/lib/pdf/estatusProyecto.ts — "Estatus de proyecto" (Efraín, 2026-09-21):
// la hoja imprimible que Compras armaba a mano en Excel para contarle al
// vendedor/cliente cómo va cada producto. UN renglón por PRODUCTO + COLOR —
// nunca por talla: las tallas se suman— con proveedor, cantidad, unidad,
// estatus y fecha estimada de entrega, pintado según el avance.
//
// No se captura nada nuevo: todo sale de lo que ya vive en el tab Ejecución
// (Estado del producto y su comentario por talla, el resumen por producto+color
// de producto_resumen) y de la fecha estimada del proveedor. Funciones puras —
// la lectura del mirror vive en worker/lib/estatusProyectoPdf.ts. Se arma al
// vuelo, igual que la vista previa de cotización: no se guarda ni se firma.
import type { Block, DocumentMeta, TableColumn } from './layout';
import { renderDocument } from './layout';
import type { PdfImageData } from './png';
import { LOGO_JPG_BASE64, CMP_ORANGE } from './logo';
import { LABEL_TO_BUCKET, type EstadoBucketKey } from '../../../shared/estadoProductoBuckets';

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

export interface EstatusProyectoInput {
  proyectos: EstatusProyecto[];
  /** Qué se pidió cuando son varios ("Zona Sureste", "lo filtrado en pantalla"). */
  alcance?: string;
  fecha: string;
  /** Foto de catálogo por SKU (la misma que la OC con imágenes), llave = SKU tal
   * cual viene en la línea. Ausente ⇒ la columna Foto no sale. Un SKU sin foto
   * en el mapa sale con el recuadro "Sin foto". */
  imagenes?: Map<string, PdfImageData>;
  /** Cuántos SKUs se quedaron sin buscar foto por el tope por corrida (>0 se
   * avisa en la nota, para que nadie crea que el catálogo no las tiene). */
  fotosOmitidas?: number;
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

const TONO_FILL: Record<EstatusTono, string | null> = {
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

function bloquesDeProyecto(p: EstatusProyecto, imagenes?: Map<string, PdfImageData>): Block[] {
  const grupos = agruparPorProductoColor(p.lineas, p.resumenes);
  const conProveedor = grupos.some(g => g.proveedor);
  const conFoto = imagenes !== undefined;
  const total = grupos.reduce((s, g) => s + g.cantidad, 0);
  const entregadas = grupos.reduce((s, g) => s + g.entregadas, 0);
  const avance = total > 0
    ? `${entregadas} de ${total} piezas entregadas (${Math.round((entregadas / total) * 100)}%)`
    : '—';

  const blocks: Block[] = [
    { kind: 'heading', text: [p.folio, p.nombre].filter(Boolean).join(' — ') },
    {
      kind: 'kv',
      columns: 2,
      rows: [
        ['Institución', p.institucion || '—'],
        ['Vendedor', p.vendedor || '—'],
        ['Zona', p.zona || '—'],
        ['Estado del proyecto', p.estadoProyecto || '—'],
        ['Fecha de entrega', p.fechaEntrega ? fechaCorta(p.fechaEntrega) : 'Sin fecha'],
        ['Documentación', p.documentacion || 'Sin cargar'],
        ['Avance', avance],
      ],
    },
  ];

  if (grupos.length === 0) {
    blocks.push({ kind: 'text', text: 'Este proyecto todavía no tiene productos (faltan las tallas).', size: 9, color: '#5b6472' });
    blocks.push({ kind: 'spacer', height: 10 });
    return blocks;
  }

  // Anchos que suman 1 en las 4 combinaciones (foto × proveedor); la foto se
  // lleva un poco de Producto y de Estatus, nunca de Cant./Entrega.
  const foto: TableColumn[] = conFoto ? [{ header: 'Foto', width: 0.09, align: 'center' }] : [];
  const extraTxt = conFoto ? 0 : 0.045;
  const columns: TableColumn[] = conProveedor
    ? [
        { header: '#', width: 0.04 },
        ...foto,
        { header: 'Producto y color', width: 0.22 + extraTxt },
        { header: 'Proveedor', width: 0.14 },
        { header: 'Cant.', width: 0.07, align: 'right' },
        { header: 'Unidad', width: 0.07, align: 'center' },
        { header: 'Estatus', width: 0.25 + extraTxt },
        { header: 'Entrega', width: 0.12, align: 'center' },
      ]
    : [
        { header: '#', width: 0.04 },
        ...foto,
        { header: 'Producto y color', width: 0.28 + extraTxt },
        { header: 'Cant.', width: 0.07, align: 'right' },
        { header: 'Unidad', width: 0.07, align: 'center' },
        { header: 'Estatus', width: 0.33 + extraTxt },
        { header: 'Entrega', width: 0.12, align: 'center' },
      ];
  const iProducto = conFoto ? 2 : 1;
  const iEstatus = columns.findIndex(c => c.header === 'Estatus');
  const iProveedor = columns.findIndex(c => c.header === 'Proveedor');

  const rows = grupos.map((g, i) => {
    const descripcion = [g.producto + (g.sku ? ` (${g.sku})` : ''), g.color].filter(Boolean).join(' · ');
    const base = [String(i + 1)];
    if (conFoto) base.push('');
    base.push(descripcion);
    if (conProveedor) base.push(g.proveedor || '—');
    base.push(String(g.cantidad), g.unidad || '—', g.estatus, g.entrega);
    return base;
  });

  blocks.push({
    kind: 'wrapTable',
    columns,
    rows,
    // Producto, Proveedor y Estatus envuelven; lo demás es corto.
    wrapCols: [iProducto, iProveedor, iEstatus].filter(i => i >= 0),
    rowFills: grupos.map(g => TONO_FILL[g.tono]),
    ...(conFoto ? { imageCol: 1, rowImages: grupos.map(g => imagenes?.get(g.sku.trim()) ?? null) } : {}),
    headerFill: CMP_ORANGE,
    headerTextColor: '#ffffff',
    cellSize: 8,
  });
  blocks.push({ kind: 'spacer', height: 8 });
  return blocks;
}

export function buildEstatusProyectoBlocks(input: EstatusProyectoInput): Block[] {
  const blocks: Block[] = [
    {
      kind: 'note',
      text: `Un renglón por producto y color (las tallas van sumadas). Corte al ${input.fecha}. Verde = entregado al cliente · Azul = en proceso · Rojo = incidencia o retraso · Sin color = pendiente de surtir.`
        + (input.fotosOmitidas ? ` Fotos: se buscaron las de los primeros productos; ${input.fotosOmitidas} más salen sin foto en esta corrida — filtra a menos proyectos para verlas todas.` : ''),
    },
    { kind: 'spacer', height: 4 },
  ];
  for (const p of input.proyectos) blocks.push(...bloquesDeProyecto(p, input.imagenes));
  return blocks;
}

export function buildEstatusProyectoPdf(input: EstatusProyectoInput): Uint8Array {
  const uno = input.proyectos.length === 1 ? input.proyectos[0] : null;
  const meta: DocumentMeta = {
    title: uno ? 'Estatus de proyecto' : 'Estatus de proyectos',
    subtitle: uno
      ? uno.nombre
      : [input.alcance, `${input.proyectos.length} proyectos`].filter(Boolean).join(' · '),
    folio: uno?.folio || undefined,
    docId: `estatus-${uno?.folio || 'varios'}`,
    generatedAt: input.fecha,
    logo: base64ToBytes(LOGO_JPG_BASE64),
    hideGeneratedByLine: true,
  };
  return renderDocument(meta, buildEstatusProyectoBlocks(input));
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
