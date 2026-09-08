// shared/estadoCuenta.ts — aritmética del Estado de cuenta del Proyecto.
// Portado tal cual de janing-portal (2026-09-08): misma definición de
// "liquidado", mismo flujo por mes — el test de al lado es el mismo también.
// Pura y compartida: el worker la usa para servir el DTO y para el PDF/Excel,
// la UI para pintar la barra de avance y la gráfica mensual. Una sola
// definición de "liquidado" para que la tarjeta, el PDF y el resumen nunca
// discrepen.
//
// El modelo: un CONCEPTO (la factura, el compromiso) con su total, y una
// lista de COBROS/PAGOS. Cada cobro tiene su PROPIA fecha estimada — no la
// factura: de un millón se acuerdan 100,000 en agosto y el resto en tres
// exhibiciones, y eso es justo lo que hay que poder estimar por mes. Un cobro
// con `fecha` ya entró; sin ella está PROGRAMADO (se estima, no se cuenta
// como cobrado).

/** Un concepto se da por liquidado con medio centavo de tolerancia: los
 * montos son REAL en D1 y 100000+400000+500000 no siempre da 1000000 exacto
 * en punto flotante. Sin esto, una factura pagada al 100% se quedaría
 * "Parcial" por 0.0000001 y nadie sabría por qué. */
export const TOLERANCIA = 0.005;

export type EstadoConcepto = 'pendiente' | 'parcial' | 'liquidado' | 'sobrepago';

export const ESTADO_LABEL: Record<EstadoConcepto, string> = {
  pendiente: 'Pendiente',
  parcial: 'Parcial',
  liquidado: 'Pagado',
  sobrepago: 'Pagado de más',
};

export interface AbonoResumible {
  monto: number;
  /** Fecha en que el dinero SE MOVIÓ. Null = todavía no: es un programado. */
  fecha?: string | null;
  /** Cuándo se espera. Solo aplica mientras `fecha` sea null. */
  fechaEstimada?: string | null;
}

/** 'YYYY-MM-DD' de hoy en hora LOCAL. `toISOString()` no sirve: en México va
 * 6 h atrás de UTC, así que después de las 18:00 diría que ya es mañana y
 * marcaría como vencido un cobro programado para hoy. */
export function hoyISO(d = new Date()): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Vencido = está programado (no ha entrado) y su fecha estimada ya pasó. El
 * día mismo NO cuenta como vencido: comparar strings ISO ordena igual que
 * fechas. */
export function abonoVencido(abono: AbonoResumible, hoy = hoyISO()): boolean {
  if (abono.fecha) return false;
  if (!abono.fechaEstimada) return false;
  return abono.fechaEstimada.slice(0, 10) < hoy;
}

/** Días que faltan (positivo) o que lleva vencido (negativo). Null si no se
 * estimó fecha. Cuenta en días de calendario, no en horas. */
export function diasParaPago(fechaEstimada: string | null | undefined, hoy = hoyISO()): number | null {
  if (!fechaEstimada) return null;
  const a = Date.parse(`${fechaEstimada.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${hoy}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

export interface ResumenConcepto {
  /** Lo que YA entró/salió. */
  abonado: number;
  /** Lo que está programado y todavía no entra. */
  programado: number;
  /** La parte de lo programado cuya fecha ya pasó. */
  vencido: number;
  /** total - abonado. Negativo = se pagó de más. */
  saldo: number;
  /** Saldo que ni siquiera tiene fecha estimada: no se puede provisionar. */
  sinProgramar: number;
  /** La fecha estimada más próxima entre los cobros pendientes. */
  proximaFecha: string | null;
  /** 0..1, topado en 1 para que la barra no se desborde en un sobrepago. */
  avance: number;
  estado: EstadoConcepto;
}

export function resumenConcepto(total: number, abonos: readonly AbonoResumible[], hoy = hoyISO()): ResumenConcepto {
  let abonado = 0, programado = 0, vencido = 0;
  let proximaFecha: string | null = null;
  for (const a of abonos) {
    const monto = Number.isFinite(a.monto) ? a.monto : 0;
    if (a.fecha) { abonado += monto; continue; }
    programado += monto;
    if (abonoVencido(a, hoy)) vencido += monto;
    const f = a.fechaEstimada?.slice(0, 10);
    if (f && (proximaFecha === null || f < proximaFecha)) proximaFecha = f;
  }
  const saldo = total - abonado;
  const avance = total > 0 ? Math.min(1, Math.max(0, abonado / total)) : (abonado > 0 ? 1 : 0);
  let estado: EstadoConcepto;
  if (saldo < -TOLERANCIA) estado = 'sobrepago';
  else if (Math.abs(saldo) <= TOLERANCIA) estado = 'liquidado';
  else if (abonado > TOLERANCIA) estado = 'parcial';
  else estado = 'pendiente';
  return {
    abonado, programado, vencido, saldo,
    sinProgramar: Math.max(0, saldo - programado),
    proximaFecha, avance, estado,
  };
}

export interface ConceptoResumible {
  tipo: 'ingreso' | 'egreso';
  total: number;
  abonado: number;
  saldo: number;
  programado?: number;
  vencido?: number;
}

export interface ResumenEstadoCuenta {
  /** Dinero que YA entró / YA salió. */
  cobrado: number;
  pagado: number;
  /** Lo que falta de los conceptos vivos — nunca negativo: un sobrepago no
   * es un "por cobrar" en contra, se ve en su propia tarjeta. */
  porCobrar: number;
  porPagar: number;
  /** Lo que hay en caja por este Proyecto: entró menos salió. */
  saldo: number;
  /** Lo comprometido de cada lado, pagado o no. */
  totalIngresos: number;
  totalEgresos: number;
  /** Lo programado cuya fecha estimada ya pasó. Es el número que se mira
   * primero al provisionar: no "cuánto falta" sino "cuánto ya debería haber
   * entrado y no entró". */
  vencidoPorCobrar: number;
  vencidoPorPagar: number;
}

/** Un proyecto sin movimientos: va en ceros, no se esconde — "todavía no se
 * factura" también es información. */
export const RESUMEN_VACIO: Readonly<ResumenEstadoCuenta> = {
  cobrado: 0, pagado: 0, porCobrar: 0, porPagar: 0, saldo: 0, totalIngresos: 0, totalEgresos: 0,
  vencidoPorCobrar: 0, vencidoPorPagar: 0,
};

export function resumenEstadoCuenta(conceptos: readonly ConceptoResumible[]): ResumenEstadoCuenta {
  const r: ResumenEstadoCuenta = { ...RESUMEN_VACIO };
  for (const c of conceptos) {
    const pendiente = Math.max(0, c.saldo);
    if (c.tipo === 'ingreso') {
      r.cobrado += c.abonado; r.porCobrar += pendiente; r.totalIngresos += c.total; r.vencidoPorCobrar += c.vencido ?? 0;
    } else {
      r.pagado += c.abonado; r.porPagar += pendiente; r.totalEgresos += c.total; r.vencidoPorPagar += c.vencido ?? 0;
    }
  }
  r.saldo = r.cobrado - r.pagado;
  return r;
}

/** Suma resúmenes ya calculados (los proyectos de una ciudad, las ciudades
 * de la cartera). `saldo` NO se acumula sumando: es cobrado − pagado, así que
 * se recompone al final. La pantalla y el PDF del reporte suman con ESTA
 * función, para que no puedan dar dos totales distintos. */
export function sumarResumenes(partes: readonly ResumenEstadoCuenta[]): ResumenEstadoCuenta {
  const t = { ...RESUMEN_VACIO };
  for (const r of partes) {
    t.cobrado += r.cobrado; t.pagado += r.pagado;
    t.porCobrar += r.porCobrar; t.porPagar += r.porPagar;
    t.totalIngresos += r.totalIngresos; t.totalEgresos += r.totalEgresos;
    t.vencidoPorCobrar += r.vencidoPorCobrar; t.vencidoPorPagar += r.vencidoPorPagar;
  }
  t.saldo = t.cobrado - t.pagado;
  return t;
}

// ── Flujo mensual ───────────────────────────────────────────────────────────
// Lo que contesta la gráfica de arriba del tab: cuánto entra y cuánto sale
// cada mes. Un cobro cae en el mes de su fecha real si ya entró, y en el de su
// fecha estimada si está programado — así el pasado son hechos y el futuro,
// provisión, en la misma línea de tiempo.

export interface MovimientoFlujo {
  tipo: 'ingreso' | 'egreso';
  monto: number;
  fecha?: string | null;
  fechaEstimada?: string | null;
}

export interface MesFlujo {
  /** 'YYYY-MM'. */
  mes: string;
  ingresoReal: number;
  ingresoEstimado: number;
  egresoReal: number;
  egresoEstimado: number;
  /** Suma de las dos partes, que es el alto de cada barra. */
  ingreso: number;
  egreso: number;
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-08' → 'ago 26'. */
export function etiquetaMes(mes: string): string {
  const [y, m] = mes.split('-');
  return `${MESES_CORTOS[Number(m) - 1] ?? '?'} ${y.slice(2)}`;
}

function sumaMes(mapa: Map<string, MesFlujo>, mes: string): MesFlujo {
  let f = mapa.get(mes);
  if (!f) {
    f = { mes, ingresoReal: 0, ingresoEstimado: 0, egresoReal: 0, egresoEstimado: 0, ingreso: 0, egreso: 0 };
    mapa.set(mes, f);
  }
  return f;
}

function mesSiguiente(mes: string): string {
  const y = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Meses vacíos que se rellenan para que la gráfica no mienta con el tiempo:
 * sin esto, agosto y diciembre saldrían pegados como si fueran consecutivos.
 * Solo se rellena hasta 24 meses de hueco — una fecha capturada con un dedazo
 * ("2126") generaría mil barras vacías. */
const MAX_MESES_RELLENO = 24;

/** Un renglón por mes con dinero, ordenado. Los movimientos sin fecha alguna
 * (ni real ni estimada) NO entran: no se pueden ubicar en el tiempo. */
export function flujoPorMes(movimientos: readonly MovimientoFlujo[]): MesFlujo[] {
  const mapa = new Map<string, MesFlujo>();
  for (const mov of movimientos) {
    const iso = mov.fecha || mov.fechaEstimada;
    if (!iso) continue;
    const mes = iso.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mes)) continue;
    const monto = Number.isFinite(mov.monto) ? mov.monto : 0;
    const f = sumaMes(mapa, mes);
    const real = Boolean(mov.fecha);
    if (mov.tipo === 'ingreso') {
      if (real) f.ingresoReal += monto; else f.ingresoEstimado += monto;
      f.ingreso += monto;
    } else {
      if (real) f.egresoReal += monto; else f.egresoEstimado += monto;
      f.egreso += monto;
    }
  }
  if (mapa.size === 0) return [];

  const conDinero = [...mapa.keys()].sort();
  const primero = conDinero[0], ultimo = conDinero[conDinero.length - 1];
  for (let mes = primero, i = 0; mes < ultimo && i < MAX_MESES_RELLENO; mes = mesSiguiente(mes), i++) {
    sumaMes(mapa, mes);
  }
  return [...mapa.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}
