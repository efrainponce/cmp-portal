// worker/lib/estadoCuentaExport.ts — el mismo Estado de cuenta, en PDF (para
// mandar a cobrar / llevar a la junta) o en Excel (para trabajarlo: filtrar,
// sumar, pegarlo en el flujo). Los dos salen de listEstadoCuenta, así que
// nunca pueden discrepar entre sí ni con lo que muestra la pantalla.
//
// El PDF se arma con el motor de bloques del portal (worker/lib/pdf/layout.ts,
// el mismo de la solicitud de costeo y la OC), no con pdf-lib como en janing:
// la gráfica mensual del tab no se dibuja aquí — va como tabla "Flujo por
// mes", que es la gráfica hecha números. Las hojas del Excel son las tres de
// janing (resumen+conceptos, cobros y pagos, flujo por mes).
import type { MirrorItem } from '../../shared/types';
import type { EstadoCuentaConceptoDTO } from '../../shared/dto';
import { renderDocument, type Block, type DocumentMeta } from './pdf/layout';
import { CMP_ORANGE, LOGO_JPG_BASE64 } from './pdf/logo';
import { escribirXlsx, type ValorCelda } from '../../shared/xlsxWrite';
import {
  ESTADO_LABEL, abonoVencido, diasParaPago, etiquetaMes, flujoPorMes, hoyISO,
  resumenConcepto, resumenEstadoCuenta, sumarResumenes, type ResumenEstadoCuenta,
} from '../../shared/estadoCuenta';

// Columnas del board Proyectos (docs/monday-column-map.md) — las mismas que
// pinta el encabezado del drawer (src/boards/proyectos/ProyectoDrawer.tsx).
const FOLIO_COL = 'pulse_id_mm1a12gy';
const INSTITUCION_COL = 'lookup_mm1dwn6';
const VENDEDOR_COL = 'multiple_person_mm0hrnqq';
const ZONA_COL = 'dropdown_mm0hnyv';
const ETAPA_COL = 'project_status';
const ENTREGA_COL = 'date_mm0m1vfv';

export interface CabeceraProyecto { nombre: string; folio: string; institucion: string; vendedor: string }

/** Texto de una columna del mirror ([{id,type,text,value}]). */
function colText(row: MirrorItem, colId: string): string {
  try {
    const cols: { id: string; text?: string | null }[] = JSON.parse(row.columns || '[]');
    return cols.find(c => c.id === colId)?.text?.trim() ?? '';
  } catch {
    return '';
  }
}

export function cabeceraDe(row: MirrorItem): CabeceraProyecto {
  return {
    nombre: row.name,
    folio: colText(row, FOLIO_COL) || String(row.item_id),
    institucion: colText(row, INSTITUCION_COL),
    vendedor: colText(row, VENDEDOR_COL),
  };
}

/** Nombre de archivo sin acentos ni espacios: viaja en Content-Disposition
 * (worker/lib/http.ts contentDisposition ya manda la forma UTF-8 también,
 * pero un nombre limpio se lee igual en todos lados). */
export function nombreArchivo(folio: string, ext: 'pdf' | 'xlsx'): string {
  const limpio = (folio || 'proyecto').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-');
  return `Estado-de-cuenta-${limpio}.${ext}`;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-08-21' → '21 ago 2026'. Se parte el string a mano en vez de usar
 * Date: `new Date('2026-08-21')` es medianoche UTC y en México imprime el 20. */
export function fmtFechaCorta(iso: string | null): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1] ?? '?'} ${m[1]}`;
}

/** Con centavos: aquí sí importan (una factura de $907,224.86 no se
 * concilia contra $907,225). */
export function fmtDinero(n: number): string {
  const signo = n < 0 ? '-' : '';
  return `${signo}$${Math.abs(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const TIPO_LABEL = { ingreso: 'Ingreso', egreso: 'Egreso' } as const;

/** Bloques del PDF. Aparte de la ruta para poder probarlos sin D1. */
export function bloquesEstadoCuenta(info: CabeceraProyecto, conceptos: EstadoCuentaConceptoDTO[], hoy: string): Block[] {
  const res = resumenEstadoCuenta(conceptos.map(c => ({
    tipo: c.tipo, total: c.total, abonado: c.abonado, saldo: c.saldo, programado: c.programado, vencido: c.vencido,
  })));

  const blocks: Block[] = [
    { kind: 'heading', text: 'Proyecto' },
    {
      kind: 'kv',
      rows: [
        ['Proyecto', info.nombre],
        ['Folio', info.folio],
        ['Institución', info.institucion || '—'],
        ['Vendedor', info.vendedor || '—'],
        ['Corte al', fmtFechaCorta(hoy)],
        ['Conceptos', String(conceptos.length)],
      ],
    },
    { kind: 'heading', text: 'Resumen' },
    {
      kind: 'kv',
      rows: [
        ['Cobrado', fmtDinero(res.cobrado)],
        ['Pagado', fmtDinero(res.pagado)],
        ['Por cobrar', res.vencidoPorCobrar > 0 ? `${fmtDinero(res.porCobrar)} (vencido ${fmtDinero(res.vencidoPorCobrar)})` : fmtDinero(res.porCobrar)],
        ['Por pagar', res.vencidoPorPagar > 0 ? `${fmtDinero(res.porPagar)} (vencido ${fmtDinero(res.vencidoPorPagar)})` : fmtDinero(res.porPagar)],
        ['Total facturado', fmtDinero(res.totalIngresos)],
        ['Total comprometido', fmtDinero(res.totalEgresos)],
        ['Saldo (cobrado - pagado)', fmtDinero(res.saldo)],
      ],
    },
  ];

  if (conceptos.length === 0) {
    blocks.push({ kind: 'text', text: 'Sin movimientos capturados.', color: '#5b6472' });
    return blocks;
  }

  const seccion = (titulo: string, lista: EstadoCuentaConceptoDTO[]) => {
    if (lista.length === 0) return;
    blocks.push({ kind: 'heading', text: titulo });
    // Un renglón por concepto y, debajo, sus cobros con sangría: es como se
    // revisa un pago en partes ("de la factura de 907 mil entraron estos dos").
    const rows: string[][] = [];
    for (const c of lista) {
      const { estado } = resumenConcepto(c.total, c.abonos, hoy);
      const estadoTxt = c.vencido > 0 ? `${ESTADO_LABEL[estado]} (vencido)` : ESTADO_LABEL[estado];
      rows.push([
        TIPO_LABEL[c.tipo], c.concepto || 'Sin concepto', fmtFechaCorta(c.fecha), fmtFechaCorta(c.proximaFecha),
        estadoTxt, fmtDinero(c.total), fmtDinero(c.abonado), fmtDinero(c.saldo),
      ]);
      for (const a of c.abonos) {
        const recibido = Boolean(a.fecha);
        const etiqueta = recibido
          ? (c.tipo === 'ingreso' ? 'cobrado' : 'pagado')
          : (abonoVencido(a, hoy) ? 'programado · vencido' : 'programado');
        rows.push([
          '', `    » ${etiqueta}${a.nota ? ` — ${a.nota}` : ''}`, fmtFechaCorta(a.fecha ?? a.fechaEstimada), '',
          a.archivo ? 'comprobante' : '', '', fmtDinero(a.monto), '',
        ]);
      }
    }
    const total = lista.reduce((s, c) => s + c.total, 0);
    const abonado = lista.reduce((s, c) => s + c.abonado, 0);
    const saldo = lista.reduce((s, c) => s + c.saldo, 0);
    blocks.push({
      kind: 'wrapTable',
      // Concepto y Estado envuelven; las columnas de dinero van anchas para
      // que $1,357,224.86 quepa entero — un total con "…" no sirve para cobrar.
      wrapCols: [1, 4],
      columns: [
        { header: 'Tipo', width: 0.065 },
        { header: 'Concepto', width: 0.235 },
        { header: 'Fecha', width: 0.11 },
        { header: 'Próx. mov.', width: 0.11 },
        { header: 'Estado', width: 0.10 },
        { header: 'Total', width: 0.13, align: 'right' },
        { header: 'Movido', width: 0.125, align: 'right' },
        { header: 'Saldo', width: 0.125, align: 'right' },
      ],
      rows,
      footer: ['', `${lista.length} concepto(s)`, '', '', '', fmtDinero(total), fmtDinero(abonado), fmtDinero(saldo)],
      headerFill: CMP_ORANGE,
      headerTextColor: '#ffffff',
      cellSize: 8,
      headerSize: 7,
    });
  };

  seccion('Pendientes', conceptos.filter(c => !c.liquidado));
  seccion('Liquidados', conceptos.filter(c => c.liquidado));

  const meses = flujoPorMes(conceptos.flatMap(c => c.abonos.map(a => ({
    tipo: c.tipo, monto: a.monto, fecha: a.fecha, fechaEstimada: a.fechaEstimada,
  }))));
  if (meses.length > 0) {
    blocks.push({ kind: 'heading', text: 'Flujo por mes' });
    blocks.push({
      kind: 'table',
      columns: [
        { header: 'Mes', width: 0.16 },
        { header: 'Ingresos', width: 0.17, align: 'right' },
        { header: 'de eso, estimado', width: 0.17, align: 'right' },
        { header: 'Egresos', width: 0.17, align: 'right' },
        { header: 'de eso, estimado', width: 0.17, align: 'right' },
        { header: 'Neto', width: 0.16, align: 'right' },
      ],
      rows: meses.map(m => [
        etiquetaMes(m.mes), fmtDinero(m.ingreso), fmtDinero(m.ingresoEstimado), fmtDinero(m.egreso), fmtDinero(m.egresoEstimado),
        fmtDinero(m.ingreso - m.egreso),
      ]),
    });
    blocks.push({
      kind: 'note',
      text: 'Un cobro cae en el mes de su fecha real si ya entró y en el de su fecha estimada si está programado: '
        + 'el pasado son hechos, el futuro provisión. Lo que no tiene ninguna fecha no entra a esta tabla.',
    });
  }
  return blocks;
}

export function pdfEstadoCuenta(info: CabeceraProyecto, conceptos: EstadoCuentaConceptoDTO[], hoy = hoyISO()): Uint8Array {
  const meta: DocumentMeta = {
    title: 'Estado de cuenta',
    subtitle: info.nombre,
    folio: info.folio,
    docId: `EC-${info.folio}-${hoy}`,
    // Fecha sola: `hoy` es 'YYYY-MM-DD' y pasarlo por Date lo lee como
    // medianoche UTC — en México imprimía el día anterior a las 6 p.m.
    generatedAt: fmtFechaCorta(hoy),
    logo: base64ToBytes(LOGO_JPG_BASE64),
    hideGeneratedByLine: true,
  };
  return renderDocument(meta, bloquesEstadoCuenta(info, conceptos, hoy));
}

/** Las hojas del libro. Aparte de la ruta para poder probarlas sin D1. */
export function hojasEstadoCuenta(info: CabeceraProyecto, conceptos: EstadoCuentaConceptoDTO[], hoy: string) {
  const res = resumenEstadoCuenta(conceptos.map(c => ({
    tipo: c.tipo, total: c.total, abonado: c.abonado, saldo: c.saldo, programado: c.programado, vencido: c.vencido,
  })));

  const titulo = (t: string): ValorCelda => ({ v: t, estilo: 'titulo' });
  const money = (n: number): ValorCelda => ({ v: n, estilo: 'moneda' });

  const resumen: ValorCelda[][] = [
    [titulo('Estado de cuenta'), info.nombre],
    [titulo('Folio'), info.folio],
    [titulo('Institución'), info.institucion],
    [titulo('Vendedor'), info.vendedor],
    [titulo('Corte al'), hoy],
    [],
    [titulo('Cobrado'), money(res.cobrado), titulo('Pagado'), money(res.pagado)],
    [titulo('Por cobrar'), money(res.porCobrar), titulo('Por pagar'), money(res.porPagar)],
    [titulo('Vencido por cobrar'), money(res.vencidoPorCobrar), titulo('Vencido por pagar'), money(res.vencidoPorPagar)],
    [titulo('Saldo'), money(res.saldo)],
    [],
  ];

  const encabezado = ['Tipo', 'Concepto', 'Fecha', 'Próximo movimiento', 'Estado', 'Días', 'Total', 'Ya se movió', 'Programado', 'Saldo', 'Sin programar', 'Registró']
    .map(titulo);

  const filas: ValorCelda[][] = conceptos.map(c => {
    const { estado } = resumenConcepto(c.total, c.abonos, hoy);
    const dias = diasParaPago(c.proximaFecha, hoy);
    return [
      TIPO_LABEL[c.tipo],
      c.concepto ?? '',
      c.fecha ?? '',
      c.proximaFecha ?? '',
      c.vencido > 0 ? `${ESTADO_LABEL[estado]} (vencido)` : ESTADO_LABEL[estado],
      // Los días van como NÚMERO para poder ordenar por "lo más vencido".
      dias === null ? null : dias,
      money(c.total), money(c.abonado), money(c.programado), money(c.saldo), money(c.sinProgramar),
      c.createdBy,
    ];
  });

  // Hoja 2: un renglón por cobro/pago — los recibidos y los programados, con
  // su fecha. Es la que se pega en el flujo de caja.
  const abonos: ValorCelda[][] = [
    ['Tipo', 'Concepto', 'Estado', 'Fecha', 'Mes', 'Monto', 'Nota', 'Comprobante', 'Registró'].map(titulo),
  ];
  for (const c of conceptos) {
    for (const a of c.abonos) {
      const recibido = Boolean(a.fecha);
      const fecha = a.fecha ?? a.fechaEstimada ?? '';
      // "Cobrado" un egreso se lee al revés: lo que se cobra es lo que entra.
      const yaFue = c.tipo === 'ingreso' ? 'Cobrado' : 'Pagado';
      abonos.push([
        TIPO_LABEL[c.tipo], c.concepto ?? '',
        recibido ? yaFue : (abonoVencido(a, hoy) ? 'Programado (vencido)' : 'Programado'),
        fecha, fecha ? fecha.slice(0, 7) : '',
        money(a.monto), a.nota ?? '',
        a.archivo ? 'Sí' : 'No', a.createdBy,
      ]);
    }
  }

  // Hoja 3: el flujo por mes, que es la gráfica del tab hecha números — la
  // hoja con la que se arma la provisión mensual.
  const meses = flujoPorMes(conceptos.flatMap(c => c.abonos.map(a => ({
    tipo: c.tipo, monto: a.monto, fecha: a.fecha, fechaEstimada: a.fechaEstimada,
  }))));
  const flujo: ValorCelda[][] = [
    ['Mes', 'Ingresos', 'de eso, estimado', 'Egresos', 'de eso, estimado', 'Neto'].map(titulo),
    ...meses.map<ValorCelda[]>(m => [
      etiquetaMes(m.mes), money(m.ingreso), money(m.ingresoEstimado), money(m.egreso), money(m.egresoEstimado),
      money(m.ingreso - m.egreso),
    ]),
  ];

  return [
    {
      nombre: 'Estado de cuenta',
      filas: [...resumen, encabezado, ...filas],
      anchos: [12, 46, 13, 15, 22, 8, 15, 15, 15, 15, 15, 26],
    },
    { nombre: 'Cobros y pagos', filas: abonos, anchos: [12, 46, 21, 13, 10, 15, 34, 13, 26] },
    { nombre: 'Flujo por mes', filas: flujo, anchos: [12, 16, 18, 16, 18, 16] },
  ];
}

export function xlsxEstadoCuenta(info: CabeceraProyecto, conceptos: EstadoCuentaConceptoDTO[], hoy = hoyISO()): Uint8Array {
  return escribirXlsx(hojasEstadoCuenta(info, conceptos, hoy));
}

// ── Excel de la CARTERA: todos los proyectos visibles ───────────────────────
// Efraín (2026-09-08): "poder descargar todos los proyectos a excel". Un
// renglón por proyecto con las mismas columnas del board (cobrado / por
// cobrar / pagado / por pagar / saldo, lo vencido aparte) — TODOS, con o sin
// movimientos, para que la hoja sea la lista completa y no solo lo capturado.
// Las hojas 2 y 3 traen el detalle (conceptos, cobros y pagos) con el folio
// y el nombre del proyecto en cada renglón, para filtrar en Excel.

export interface ProyectoCartera extends CabeceraProyecto {
  id: string;
  zona: string;
  etapa: string;
  entrega: string;
  resumen?: ResumenEstadoCuenta;
  conceptos: EstadoCuentaConceptoDTO[];
}

export function proyectoCarteraDe(row: MirrorItem, resumen: ResumenEstadoCuenta | undefined, conceptos: EstadoCuentaConceptoDTO[]): ProyectoCartera {
  return {
    ...cabeceraDe(row), id: String(row.item_id),
    zona: colText(row, ZONA_COL), etapa: colText(row, ETAPA_COL), entrega: colText(row, ENTREGA_COL),
    resumen, conceptos,
  };
}

export function hojasCartera(proyectos: ProyectoCartera[], hoy: string) {
  const titulo = (t: string): ValorCelda => ({ v: t, estilo: 'titulo' });
  const money = (n: number | undefined): ValorCelda => (n === undefined ? null : { v: n, estilo: 'moneda' });

  // Zona y luego folio, que es como se lee el board.
  const orden = [...proyectos].sort((a, b) => a.zona.localeCompare(b.zona) || a.folio.localeCompare(b.folio));
  const encabezado = [
    'Folio', 'Proyecto', 'Institución', 'Vendedor', 'Zona', 'Etapa', 'Entrega',
    'Cobrado', 'Por cobrar', 'Vencido por cobrar', 'Pagado', 'Por pagar', 'Vencido por pagar', 'Saldo',
    'Total facturado', 'Total comprometido', 'Conceptos',
  ].map(titulo);
  const filas: ValorCelda[][] = orden.map(p => [
    p.folio, p.nombre, p.institucion, p.vendedor, p.zona, p.etapa, p.entrega,
    money(p.resumen?.cobrado), money(p.resumen?.porCobrar), money(p.resumen?.vencidoPorCobrar),
    money(p.resumen?.pagado), money(p.resumen?.porPagar), money(p.resumen?.vencidoPorPagar), money(p.resumen?.saldo),
    money(p.resumen?.totalIngresos), money(p.resumen?.totalEgresos), p.conceptos.length,
  ]);
  const total = sumarResumenes(orden.map(p => p.resumen).filter((r): r is ResumenEstadoCuenta => !!r));
  const totalFila: ValorCelda[] = [
    titulo('TOTAL'), `${orden.length} proyectos`, '', '', '', '', '',
    money(total.cobrado), money(total.porCobrar), money(total.vencidoPorCobrar),
    money(total.pagado), money(total.porPagar), money(total.vencidoPorPagar), money(total.saldo),
    money(total.totalIngresos), money(total.totalEgresos), orden.reduce((s, p) => s + p.conceptos.length, 0),
  ];

  const conceptos: ValorCelda[][] = [
    ['Folio', 'Proyecto', 'Tipo', 'Concepto', 'Fecha', 'Próximo movimiento', 'Estado', 'Días', 'Total', 'Ya se movió', 'Programado', 'Saldo', 'Sin programar', 'Registró'].map(titulo),
  ];
  const abonos: ValorCelda[][] = [
    ['Folio', 'Proyecto', 'Tipo', 'Concepto', 'Estado', 'Fecha', 'Mes', 'Monto', 'Nota', 'Comprobante', 'Registró'].map(titulo),
  ];
  for (const p of orden) {
    for (const c of p.conceptos) {
      const { estado } = resumenConcepto(c.total, c.abonos, hoy);
      const dias = diasParaPago(c.proximaFecha, hoy);
      conceptos.push([
        p.folio, p.nombre, TIPO_LABEL[c.tipo], c.concepto ?? '', c.fecha ?? '', c.proximaFecha ?? '',
        c.vencido > 0 ? `${ESTADO_LABEL[estado]} (vencido)` : ESTADO_LABEL[estado],
        dias === null ? null : dias,
        money(c.total), money(c.abonado), money(c.programado), money(c.saldo), money(c.sinProgramar), c.createdBy,
      ]);
      for (const a of c.abonos) {
        const recibido = Boolean(a.fecha);
        const fecha = a.fecha ?? a.fechaEstimada ?? '';
        abonos.push([
          p.folio, p.nombre, TIPO_LABEL[c.tipo], c.concepto ?? '',
          recibido ? (c.tipo === 'ingreso' ? 'Cobrado' : 'Pagado') : (abonoVencido(a, hoy) ? 'Programado (vencido)' : 'Programado'),
          fecha, fecha ? fecha.slice(0, 7) : '', money(a.monto), a.nota ?? '', a.archivo ? 'Sí' : 'No', a.createdBy,
        ]);
      }
    }
  }

  return [
    {
      nombre: 'Proyectos',
      filas: [[titulo('Estado de cuenta — todos los proyectos'), `Corte al ${hoy}`], [], encabezado, ...filas, totalFila],
      anchos: [11, 44, 30, 18, 12, 24, 12, 15, 15, 17, 15, 15, 17, 15, 16, 18, 10],
    },
    { nombre: 'Conceptos', filas: conceptos, anchos: [11, 36, 10, 40, 12, 18, 22, 7, 15, 15, 15, 15, 15, 26] },
    { nombre: 'Cobros y pagos', filas: abonos, anchos: [11, 36, 10, 40, 21, 12, 9, 15, 30, 12, 26] },
  ];
}

export function xlsxCartera(proyectos: ProyectoCartera[], hoy = hoyISO()): Uint8Array {
  return escribirXlsx(hojasCartera(proyectos, hoy));
}
