// shared/analytics.ts — contrato y CÁLCULO del tablero de Análisis (admin).
//
// Todo sale de D1 (Efraín, 2026-08-17: "todo esto es D1 driven"). No hay una
// sola lectura a Monday en este camino: los hitos con fecha que el flujo ya
// estampa en la Oportunidad viven en el mirror (`items.columns`), y los montos
// se suman de las líneas del board de subelementos, también del mirror.
//
// Por qué el cálculo vive en shared/ y no en el worker: es puro (recibe filas,
// devuelve números) y es exactamente el tipo de lógica que el typecheck NO
// cubre — todo son strings de JSON. Aquí se puede probar con vitest sin D1.
//
// ─────────────────────────────────────────────────────────────────────────────
// DE DÓNDE SALE CADA NÚMERO (ids verificados contra shared/column-meta.gen.ts,
// nunca inventados — ver CLAUDE.md)
//
//   Creación          pulse_log_mkzm4v99  (creation_log; .value.created_at)
//   Mandada a costeo  date_mm094kzf       "Fecha solicitud costeo"
//   Costeo validado   date_mm0mc3dj       "Fecha Validación Costeo"
//   Cotizada          date_mm09mv5b       "Fecha Cotización"
//   Etapa             deal_stage
//   Zona              dropdown_mm03g067   (el dropdown de Monday en la propia
//                                          oportunidad — NO las `zonas` de
//                                          ventas del portal, que son equipos
//                                          para permisos: worker/lib/zonas.ts)
//   Vendedor          deal_owner
//   Monto / Utilidad  suma de las líneas (ver ANALYTICS_LINE_COLS abajo)
//
// Las columnas de fecha guardan el día en `.value.date`, pero el `.value` trae
// además `changed_at` con el instante exacto en que la automatización la
// estampó. El tiempo de costeo usa `changed_at` — con `date` la respuesta sería
// en días enteros y "mismo día" saldría como cero.
// ─────────────────────────────────────────────────────────────────────────────
import { DEAL_STAGE_ORDER, DEAL_STAGE_LABELS, stageKeyForLabel } from './dealStages';

/** Columnas de la Oportunidad que alimentan el tablero. */
export const ANALYTICS_OPP_COLS = {
  creacion: 'pulse_log_mkzm4v99',
  solicitudCosteo: 'date_mm094kzf',
  validacionCosteo: 'date_mm0mc3dj',
  cotizacion: 'date_mm09mv5b',
  etapa: 'deal_stage',
  zona: 'dropdown_mm03g067',
  vendedor: 'deal_owner',
} as const;

/** Columnas de la LÍNEA (oportunidades_sub) que se suman por oportunidad.
 * Son fórmulas de Monday, y a diferencia de los mirrors de dinero del padre
 * (lookup_mm00p07m y compañía, vacíos en las 630 filas del mirror) estas SÍ
 * llegan con texto — verificado sobre las 2,964 líneas del mirror. */
export const ANALYTICS_LINE_COLS = {
  subtotal: 'formula_mkznmjh6',      // "Subtotal" — venta sin IVA
  utilidad: 'formula_mkznry25',      // "Utilidad Total"
} as const;

/** Una fila por oportunidad, tal cual sale de la consulta a D1. */
export interface OppRow {
  itemId: number;
  name: string;
  creada: string | null;        // ISO
  solCosteo: string | null;     // ISO (changed_at del estampado)
  valCosteo: string | null;
  cotizada: string | null;
  etapa: string | null;         // label tal cual lo muestra Monday
  zona: string | null;
  vendedor: string | null;
  monto: number | null;         // suma de Subtotal de sus líneas
  utilidad: number | null;
}

export type GroupBy = 'zona' | 'vendedor';

export const FUNNEL_STEPS = ['creadas', 'costeo', 'validado', 'cotizada', 'ganada'] as const;
export type FunnelStep = typeof FUNNEL_STEPS[number];

export const FUNNEL_LABELS: Record<FunnelStep, string> = {
  creadas: 'Creadas',
  costeo: 'Mandadas a costeo',
  validado: 'Costeo validado',
  cotizada: 'Cotizadas',
  ganada: 'Ganadas',
};

export interface FunnelBucket {
  step: FunnelStep;
  label: string;
  n: number;
  monto: number;
  /** % sobre el primer escalón (creadas). */
  pctDeCreadas: number;
  /** % sobre el escalón inmediato anterior — dónde se cae el embudo. */
  pctDelAnterior: number;
}

export interface TiempoCosteo {
  /** Mediana en horas. La mediana manda sobre el promedio: un costeo olvidado
   * tres semanas mueve el promedio y no la realidad de los demás. */
  medianaHoras: number | null;
  promedioHoras: number | null;
  p90Horas: number | null;
  /** Oportunidades con AMBOS hitos y en orden — las únicas medibles. */
  n: number;
  /** Con hito de validación pero sin el de solicitud, o con las fechas
   * invertidas: no se miden y se reportan en `huecos`. */
  descartadas: number;
}

export interface Conversion {
  ganadas: number;
  perdidas: number;
  canceladas: number;
  cerradas: number;
  abiertas: number;
  /** Ganadas / cerradas. `null` cuando no hay ni una cerrada (dividir entre
   * cero y pintar "0%" es peor que decir "todavía no hay"). */
  tasaCierre: number | null;
  /** Ganadas / creadas en el periodo — incluye lo que sigue abierto. */
  tasaSobreCreadas: number | null;
  montoGanado: number;
  montoPerdido: number;
  montoAbierto: number;
  /** Ganado / (ganado + perdido) en pesos. */
  tasaCierreMonto: number | null;
}

export interface GrupoMetrics {
  clave: string;              // "Centro", "Ray Rodriguez"…
  creadas: number;
  embudo: FunnelBucket[];
  tiempoCosteo: TiempoCosteo;
  conversion: Conversion;
  montoPipeline: number;
  utilidadGanada: number;
}

export type HuecoKind =
  | 'parece_prueba'
  | 'sin_zona' | 'sin_vendedor' | 'sin_monto'
  | 'validado_sin_solicitud' | 'cotizada_sin_validacion' | 'fechas_invertidas'
  | 'etapa_sin_fecha';

export interface Hueco {
  kind: HuecoKind;
  label: string;
  /** Qué hacer con esto — el panel no es una lista de quejas, es trabajo. */
  arreglo: string;
  n: number;
  /** Hasta HUECO_MUESTRA items, para linkear al drawer y arreglarlos. */
  items: Array<{ itemId: number; name: string }>;
}

export const HUECO_MUESTRA = 25;

export interface AnalyticsResponse {
  /** Filtro aplicado (ISO), null = sin límite por ese lado. */
  desde: string | null;
  hasta: string | null;
  por: GroupBy;
  totalOportunidades: number;
  embudo: FunnelBucket[];
  tiempoCosteo: TiempoCosteo;
  conversion: Conversion;
  montoPipeline: number;
  utilidadGanada: number;
  grupos: GrupoMetrics[];
  huecos: Hueco[];
  /** Qué tan fresco está el mirror del que salió todo esto. */
  syncedAt: string | null;
  generadoAt: string;
}

// ── Etapas ───────────────────────────────────────────────────────────────────

const GANADA = 'Ganada';
const PERDIDA = 'Perdida';
const CANCELADA = 'Cancelada';

/** Perdida/Cancelada NO implican haber recorrido el pipeline: se puede perder
 * una oportunidad en cualquier punto, incluso recién creada. Ganada sí — para
 * ganarla tuvo que cotizarse. Esta distinción es la razón de que la inferencia
 * por etapa no se aplique a las dos primeras. */
const ETAPAS_SIN_RECORRIDO = new Set([PERDIDA, CANCELADA]);

/** Etapa (por su índice canon en shared/dealStages.ts) a partir de la cual el
 * hito ya ocurrió, aunque nadie haya estampado la fecha. */
const ETAPA_DEL_HITO: Record<Exclude<FunnelStep, 'creadas'>, string> = {
  costeo: '15',      // En costeo
  validado: '9',     // Costeo Confirmado
  cotizada: '6',     // Cotización
  ganada: '1',       // Ganada
};

function posEnPipeline(etapa: string | null): number {
  if (!etapa) return -1;
  const key = stageKeyForLabel(etapa);
  return key === undefined ? -1 : DEAL_STAGE_ORDER.indexOf(key);
}

/** ¿La etapa actual prueba por sí sola que el hito ya ocurrió? */
function etapaImplica(etapa: string | null, step: Exclude<FunnelStep, 'creadas'>): boolean {
  if (!etapa || ETAPAS_SIN_RECORRIDO.has(etapa)) return false;
  const pos = posEnPipeline(etapa);
  if (pos === -1) return false;
  return pos >= DEAL_STAGE_ORDER.indexOf(ETAPA_DEL_HITO[step]);
}

/**
 * ¿Esta oportunidad alcanzó este escalón?
 *
 * El embudo es MONOTÓNICO por construcción: un hito posterior prueba el
 * anterior (no se valida un costeo que nunca se pidió), y la etapa actual
 * prueba todo lo que quedó atrás. Sin esta regla el embudo se lee al revés en
 * los casos sucios que sí existen en la base — hoy Sureste tiene 86 costeos
 * validados contra 80 solicitudes, y un embudo que ensanchara a la mitad no
 * sería más honesto, solo ilegible.
 *
 * Lo que se "rellena" por esta regla NO se esconde: cada caso se cuenta aparte
 * en `huecos` para que se arregle en el origen.
 */
export function alcanzo(row: OppRow, step: FunnelStep): boolean {
  switch (step) {
    case 'creadas':
      return true;
    case 'costeo':
      return !!(row.solCosteo || row.valCosteo || row.cotizada) || etapaImplica(row.etapa, 'costeo');
    case 'validado':
      return !!(row.valCosteo || row.cotizada) || etapaImplica(row.etapa, 'validado');
    case 'cotizada':
      return !!row.cotizada || etapaImplica(row.etapa, 'cotizada');
    case 'ganada':
      return row.etapa === GANADA;
  }
}

// ── Estadística ──────────────────────────────────────────────────────────────

/** Percentil por interpolación lineal sobre la muestra ya ordenada. */
function percentil(ordenados: number[], p: number): number | null {
  if (ordenados.length === 0) return null;
  if (ordenados.length === 1) return ordenados[0];
  const idx = (ordenados.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return ordenados[lo];
  return ordenados[lo] + (ordenados[hi] - ordenados[lo]) * (idx - lo);
}

const HORA_MS = 3_600_000;

/** Horas entre dos ISO, o null si alguna falta o el orden está invertido. */
export function horasEntre(desde: string | null, hasta: string | null): number | null {
  if (!desde || !hasta) return null;
  const a = Date.parse(desde);
  const b = Date.parse(hasta);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / HORA_MS;
}

export function calcTiempoCosteo(rows: OppRow[]): TiempoCosteo {
  const horas: number[] = [];
  let descartadas = 0;
  for (const r of rows) {
    const h = horasEntre(r.solCosteo, r.valCosteo);
    if (h === null) {
      // Solo cuenta como descarte si de verdad hubo validación: una
      // oportunidad que nunca se mandó a costear no es un dato perdido.
      if (r.valCosteo) descartadas++;
      continue;
    }
    horas.push(h);
  }
  horas.sort((a, b) => a - b);
  const suma = horas.reduce((acc, h) => acc + h, 0);
  return {
    medianaHoras: percentil(horas, 0.5),
    promedioHoras: horas.length ? suma / horas.length : null,
    p90Horas: percentil(horas, 0.9),
    n: horas.length,
    descartadas,
  };
}

export function calcEmbudo(rows: OppRow[]): FunnelBucket[] {
  const creadas = rows.length;
  let anterior = 0;
  return FUNNEL_STEPS.map((step, i) => {
    const alcanzadas = rows.filter(r => alcanzo(r, step));
    const n = alcanzadas.length;
    const monto = alcanzadas.reduce((acc, r) => acc + (r.monto ?? 0), 0);
    const bucket: FunnelBucket = {
      step,
      label: FUNNEL_LABELS[step],
      n,
      monto,
      pctDeCreadas: creadas ? n / creadas : 0,
      pctDelAnterior: i === 0 ? 1 : (anterior ? n / anterior : 0),
    };
    anterior = n;
    return bucket;
  });
}

export function calcConversion(rows: OppRow[]): Conversion {
  const de = (etapa: string) => rows.filter(r => r.etapa === etapa);
  const ganadasRows = de(GANADA);
  const perdidasRows = de(PERDIDA);
  const canceladasRows = de(CANCELADA);
  const sum = (rs: OppRow[]) => rs.reduce((acc, r) => acc + (r.monto ?? 0), 0);

  const ganadas = ganadasRows.length;
  const perdidas = perdidasRows.length;
  const canceladas = canceladasRows.length;
  const cerradas = ganadas + perdidas + canceladas;
  const montoGanado = sum(ganadasRows);
  const montoPerdido = sum(perdidasRows) + sum(canceladasRows);

  return {
    ganadas, perdidas, canceladas, cerradas,
    abiertas: rows.length - cerradas,
    tasaCierre: cerradas ? ganadas / cerradas : null,
    tasaSobreCreadas: rows.length ? ganadas / rows.length : null,
    montoGanado,
    montoPerdido,
    montoAbierto: sum(rows.filter(r => r.etapa !== GANADA && r.etapa !== PERDIDA && r.etapa !== CANCELADA)),
    tasaCierreMonto: (montoGanado + montoPerdido) ? montoGanado / (montoGanado + montoPerdido) : null,
  };
}

function metricsDe(clave: string, rows: OppRow[]): GrupoMetrics {
  return {
    clave,
    creadas: rows.length,
    embudo: calcEmbudo(rows),
    tiempoCosteo: calcTiempoCosteo(rows),
    conversion: calcConversion(rows),
    montoPipeline: rows.reduce((acc, r) => acc + (r.monto ?? 0), 0),
    utilidadGanada: rows.filter(r => r.etapa === GANADA).reduce((acc, r) => acc + (r.utilidad ?? 0), 0),
  };
}

export const SIN_DATO = '(sin asignar)';

export function agrupar(rows: OppRow[], por: GroupBy): GrupoMetrics[] {
  const mapa = new Map<string, OppRow[]>();
  for (const r of rows) {
    const clave = (por === 'zona' ? r.zona : r.vendedor)?.trim() || SIN_DATO;
    const arr = mapa.get(clave);
    if (arr) arr.push(r); else mapa.set(clave, [r]);
  }
  return [...mapa.entries()]
    .map(([clave, rs]) => metricsDe(clave, rs))
    .sort((a, b) => b.montoPipeline - a.montoPipeline);
}

// ── Huecos de datos ──────────────────────────────────────────────────────────

/** Detecta lo que se ve como basura de pruebas en el nombre. Deliberadamente
 * solo REPORTA: estas filas siguen sumando en el embudo y en las tasas. Decidir
 * que un renglón no cuenta como venta es decisión de Efraín, no de un regex —
 * y una exclusión silenciosa sería justo el tipo de número que nadie puede
 * auditar después. "(copia)" NO entra: duplicar una oportunidad es un flujo
 * real del portal (worker/lib/duplicateOportunidad.ts). */
const PARECE_PRUEBA = /(^|[\s\-_])(zz-?test|test|prueba|smoke|debug|stress|dummy)([\s\-_)]|$)|borrar/i;

interface HuecoDef {
  kind: HuecoKind;
  label: string;
  arreglo: string;
  match: (r: OppRow) => boolean;
}

/** Cada hueco es una fila que el tablero no puede clasificar bien, con la
 * acción concreta que lo cierra. Se listan aunque el número sea chico: son
 * pocos y arreglables, y mientras existan cualquier corte por zona miente un
 * poco (Efraín, 2026-08-17: "si faltan datos hay que resolverlo"). */
const HUECOS: HuecoDef[] = [
  {
    kind: 'parece_prueba',
    label: 'Parecen registros de prueba',
    arreglo: 'Nombres tipo TEST/SMOKE/DEBUG/"borrar". SIGUEN CONTANDO en todos los números de arriba: '
      + 'inflan "creadas" y bajan la tasa de cierre. Borrarlas en Monday las saca del tablero.',
    match: r => PARECE_PRUEBA.test(r.name),
  },
  {
    kind: 'sin_zona',
    label: 'Sin Zona',
    arreglo: 'Asignar la Zona en la oportunidad — hoy cae en "(sin asignar)" y no suma a ninguna región.',
    match: r => !r.zona?.trim(),
  },
  {
    kind: 'sin_vendedor',
    label: 'Sin Vendedor',
    arreglo: 'Asignar el Vendedor — sin él la oportunidad no entra en el corte por persona.',
    match: r => !r.vendedor?.trim(),
  },
  {
    kind: 'validado_sin_solicitud',
    label: 'Costeo validado sin fecha de solicitud',
    arreglo: 'Falta "Fecha solicitud costeo": el tiempo de costeo de estas no se puede medir.',
    match: r => !!r.valCosteo && !r.solCosteo,
  },
  {
    kind: 'fechas_invertidas',
    label: 'Validación anterior a la solicitud',
    arreglo: 'Las dos fechas existen pero en orden imposible; corregir la que esté mal.',
    match: r => !!r.solCosteo && !!r.valCosteo && Date.parse(r.valCosteo) < Date.parse(r.solCosteo),
  },
  {
    kind: 'cotizada_sin_validacion',
    label: 'Cotizada sin costeo validado',
    arreglo: 'Se cotizó sin que quedara registrada la validación del costeo.',
    match: r => !!r.cotizada && !r.valCosteo,
  },
  {
    kind: 'etapa_sin_fecha',
    label: 'Etapa avanzada sin la fecha del hito',
    arreglo: 'El embudo las cuenta por su etapa, pero sin fecha no aportan al tiempo de costeo.',
    match: r => !r.solCosteo && !!r.etapa && !ETAPAS_SIN_RECORRIDO.has(r.etapa)
      && posEnPipeline(r.etapa) > DEAL_STAGE_ORDER.indexOf('4'),
  },
  {
    kind: 'sin_monto',
    label: 'Cotizada o ganada sin monto',
    arreglo: 'Llegó a cotización pero sus líneas suman $0: no aporta a pipeline ni a ganado.',
    // Solo cuenta como hueco si ya DEBERÍA tener precio. Una oportunidad
    // recién creada sin monto no es un dato faltante, es una que todavía no
    // se cotiza — meterla aquí llenaba el panel de ruido (97 filas contra las
    // 23 reales) y el panel dejaba de ser una lista de trabajo.
    match: r => alcanzo(r, 'cotizada') && !r.monto,
  },
];

export function calcHuecos(rows: OppRow[]): Hueco[] {
  return HUECOS
    .map(def => {
      const hits = rows.filter(def.match);
      return {
        kind: def.kind,
        label: def.label,
        arreglo: def.arreglo,
        n: hits.length,
        items: hits.slice(0, HUECO_MUESTRA).map(r => ({ itemId: r.itemId, name: r.name })),
      };
    })
    .filter(h => h.n > 0)
    .sort((a, b) => b.n - a.n);
}

// ── Ensamblado ───────────────────────────────────────────────────────────────

export function buildAnalytics(
  rows: OppRow[],
  opts: { por: GroupBy; desde: string | null; hasta: string | null; syncedAt: string | null; generadoAt: string },
): AnalyticsResponse {
  const global = metricsDe('__global__', rows);
  return {
    desde: opts.desde,
    hasta: opts.hasta,
    por: opts.por,
    totalOportunidades: rows.length,
    embudo: global.embudo,
    tiempoCosteo: global.tiempoCosteo,
    conversion: global.conversion,
    montoPipeline: global.montoPipeline,
    utilidadGanada: global.utilidadGanada,
    grupos: agrupar(rows, opts.por),
    huecos: calcHuecos(rows),
    syncedAt: opts.syncedAt,
    generadoAt: opts.generadoAt,
  };
}

/** Etiqueta de etapa para la UI, tolerante a que Monday renombre un label
 * (mismo criterio que el resto del portal: el índice manda, no el texto). */
export function etapaLabel(etapa: string | null): string {
  if (!etapa) return SIN_DATO;
  const key = stageKeyForLabel(etapa);
  return key === undefined ? etapa : DEAL_STAGE_LABELS[key];
}
