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
import { llaveFotoOc } from '../../../shared/ocFotoLlave';
import {
  diasParaEntregar, estatusDeLineas, fechaCorta, textoEmbellecimientos, TONO_FILL,
  type EstatusProyecto,
} from '../../../shared/estatusProyecto';

// La lógica de agrupado vive en shared/estatusProyecto.ts (la tab Resumen la
// usa igual); se re-exporta para que el test y estatusProyectoPdf.ts no cambien.
export {
  agruparPorProductoColor, estatusDeLineas, fechaCorta, llaveGrupo, textoEmbellecimientos,
  type EstatusLinea, type EstatusProyecto, type EstatusGrupo, type EstatusTono,
} from '../../../shared/estatusProyecto';

export interface EstatusProyectoInput {
  proyectos: EstatusProyecto[];
  /** Qué se pidió cuando son varios ("Zona Sureste", "lo filtrado en pantalla"). */
  alcance?: string;
  fecha: string;
  /** Hoy en CDMX, YYYY-MM-DD — para "Faltan N días". Ausente ⇒ no se calcula. */
  hoy?: string;
  /** Foto de catálogo por producto (la misma que la OC con imágenes), llave =
   * `llaveFotoOc(sku, producto)`: el SKU, o el nombre si la línea no trae SKU. Ausente ⇒ la columna Foto no sale. Un SKU sin foto
   * en el mapa sale con el recuadro "Sin foto". */
  imagenes?: Map<string, PdfImageData>;
  /** Cuántos SKUs se quedaron sin buscar foto por el tope por corrida (>0 se
   * avisa en la nota, para que nadie crea que el catálogo no las tiene). */
  fotosOmitidas?: number;
}

function bloquesDeProyecto(p: EstatusProyecto, imagenes?: Map<string, PdfImageData>, hoy?: string): Block[] {
  const { grupos, sueltos } = estatusDeLineas(p.lineas, p.resumenes);
  const conProveedor = grupos.some(g => g.proveedor);
  const conEmbell = grupos.some(g => g.embellecimientos.length > 0);
  const conFoto = imagenes !== undefined;
  const total = grupos.reduce((s, g) => s + g.cantidad, 0);
  const entregadas = grupos.reduce((s, g) => s + g.entregadas, 0);
  const avance = total > 0
    ? `${entregadas} de ${total} piezas entregadas (${Math.round((entregadas / total) * 100)}%)`
    : '—';

  // Franja de UN renglón con los datos del proyecto (antes un kv de media
  // hoja): carta horizontal con poco margen, lo más posible por hoja, como la
  // hoja de Elisa (Efraín, 2026-09-29). Incluye la línea de tiempo que pidió
  // Elisa: tallas confirmadas (pasa a Compras), OC listas, entrega del
  // contrato y días que faltan.
  const franja: [string, string, number][] = [
    ['Institución', p.institucion || '—', 0.12],
    ['Vendedor', p.vendedor || '—', 0.13],
    ['Estado', p.estadoProyecto || '—', 0.11],
    ['Tallas conf. (a Compras)', p.tallasConfirmadas ? fechaCorta(p.tallasConfirmadas) : 'Todavía no', 0.12],
    ['OC listas', p.ocListas ? fechaCorta(p.ocListas) : 'Todavía no', 0.08],
    ['Entrega contrato', p.fechaEntrega ? fechaCorta(p.fechaEntrega) : 'Sin fecha', 0.1],
    ...(hoy ? [['Días p/ entregar', diasParaEntregar(p.fechaEntrega, hoy, p.estadoProyecto), 0.1] as [string, string, number]] : []),
    ['Documentación', p.documentacion || 'Sin cargar', 0.1],
    ['Avance', avance, 0.14],
  ];
  const anchoFranja = franja.reduce((s, [, , w]) => s + w, 0);
  const blocks: Block[] = [
    { kind: 'heading', text: [p.folio, p.nombre].filter(Boolean).join(' — ') },
    {
      kind: 'wrapTable',
      columns: franja.map(([header, , w]) => ({ header, width: w / anchoFranja })),
      rows: [franja.map(([, v]) => v)],
      wrapCols: franja.map((_, i) => i),
      headerFill: '#eef1f5',
      headerTextColor: '#5b6472',
      cellSize: 8,
      headerSize: 6.5,
    },
    { kind: 'spacer', height: 4 },
  ];

  if (grupos.length === 0) {
    blocks.push({ kind: 'text', text: 'Este proyecto todavía no tiene productos (faltan las tallas).', size: 9, color: '#5b6472' });
    blocks.push({ kind: 'spacer', height: 10 });
    return blocks;
  }

  // Anchos que suman 1 en las 4 combinaciones (foto × proveedor); la foto se
  // lleva un poco de Producto y de Estatus, nunca de Cant./Entrega. Con
  // Embellecimientos (una línea por zona) se re-escalan para seguir sumando 1.
  const foto: TableColumn[] = conFoto ? [{ header: 'Foto', width: 0.06, align: 'center' }] : [];
  const extraTxt = conFoto ? 0 : 0.03;
  const base: TableColumn[] = conProveedor
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
  if (conEmbell) base.splice(base.length - 1, 0, { header: 'Embellecimientos', width: 0.42 });
  const suma = base.reduce((s, c) => s + c.width, 0);
  const columns = base.map(c => ({ ...c, width: c.width / suma }));
  const iProducto = conFoto ? 2 : 1;
  const iEstatus = columns.findIndex(c => c.header === 'Estatus');
  const iProveedor = columns.findIndex(c => c.header === 'Proveedor');
  const iEmbell = columns.findIndex(c => c.header === 'Embellecimientos');

  const rows = grupos.map((g, i) => {
    const descripcion = [g.producto + (g.sku ? ` (${g.sku})` : ''), g.color].filter(Boolean).join(' · ');
    const base = [String(i + 1)];
    if (conFoto) base.push('');
    base.push(descripcion);
    if (conProveedor) base.push(g.proveedor || '—');
    base.push(String(g.cantidad), g.unidad || '—', g.estatus);
    if (conEmbell) base.push(textoEmbellecimientos(g.embellecimientos));
    base.push(g.entrega);
    return base;
  });

  blocks.push({
    kind: 'wrapTable',
    columns,
    rows,
    // Producto, Proveedor, Estatus y Embellecimientos envuelven; lo demás es corto.
    wrapCols: [iProducto, iProveedor, iEstatus, iEmbell].filter(i => i >= 0),
    rowFills: grupos.map(g => TONO_FILL[g.tono]),
    ...(conFoto ? { imageHeight: 28, imageCol: 1, rowImages: grupos.map(g => imagenes?.get(llaveFotoOc(g.sku, g.producto === '—' ? '' : g.producto)) ?? null) } : {}),
    headerFill: CMP_ORANGE,
    headerTextColor: '#ffffff',
    cellSize: 8,
  });
  if (sueltos.length) {
    blocks.push({
      kind: 'text',
      size: 8,
      color: '#5b6472',
      text: `Embellecimientos sin producto ligado:\n${textoEmbellecimientos(sueltos)}`,
    });
  }
  blocks.push({ kind: 'spacer', height: 8 });
  return blocks;
}

export function buildEstatusProyectoBlocks(input: EstatusProyectoInput): Block[] {
  const blocks: Block[] = [
    {
      kind: 'note',
      text: `Corte al ${input.fecha}. Un renglón por producto y color (tallas sumadas); embellecimientos en su columna, una línea por zona. Verde = entregado · Azul = en proceso · Rojo = incidencia o retraso · Sin color = pendiente.`
        + (input.fotosOmitidas ? ` Fotos: se buscaron las de los primeros productos; ${input.fotosOmitidas} más salen sin foto en esta corrida — filtra a menos proyectos para verlas todas.` : ''),
    },
    { kind: 'spacer', height: 4 },
  ];
  // Varios proyectos (ya vienen ordenados por zona): cada zona de venta
  // arranca en hoja nueva con su título, como la hoja que reparte Elisa
  // ("CENTRO & BAJÍO") (Efraín, 2026-09-29).
  const porZona = input.proyectos.length > 1;
  let zonaActual: string | null = null;
  for (const p of input.proyectos) {
    if (porZona && p.zona !== zonaActual) {
      if (zonaActual !== null) blocks.push({ kind: 'pageBreak' });
      zonaActual = p.zona;
      blocks.push({ kind: 'text', text: `Zona ${p.zona || 'sin asignar'}`, size: 14, bold: true, color: CMP_ORANGE });
      blocks.push({ kind: 'divider' });
    }
    blocks.push(...bloquesDeProyecto(p, input.imagenes, input.hoy));
  }
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
    // Siempre horizontal, carta (Efraín, 2026-09-29: "para ver más info").
    landscape: true,
    compacto: true,
  };
  return renderDocument(meta, buildEstatusProyectoBlocks(input));
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
