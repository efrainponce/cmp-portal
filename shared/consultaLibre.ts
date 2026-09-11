// shared/consultaLibre.ts — motor de la "consulta libre" del agente (solo
// dirección, Efraín 2026-09-11: "preguntas ambiguas… así como lo que hago
// contigo"). El modelo NO escribe SQL ni suma de cabeza: arma una consulta
// estructurada (filtros + agrupar + métricas) y este módulo la ejecuta sobre
// filas planas que el worker ya filtró por permisos (worker/lib/consultaLibre.ts).
//
// Puro y testeado (shared/consultaLibre.test.ts): es exactamente la lógica que
// el typecheck no cubre, y un número mal agrupado aquí sale como respuesta
// segura en el WhatsApp de dirección.
//
// Fail-closed como `rejectUnknownQuery`: un campo desconocido o no disponible
// para el viewer es ERROR con la lista de campos válidos, nunca "se ignora" —
// un filtro que se cae en silencio contesta sobre todo el negocio.

export type Tipo = 'texto' | 'numero' | 'fecha' | 'bool';
export interface CampoDef { tipo: Tipo; desc: string }
export type Tabla = 'oportunidades' | 'lineas';
export type Valor = string | number | boolean | null;
export type Fila = Record<string, Valor>;

const CAMPOS_COMUNES: Record<string, CampoDef> = {
  folio: { tipo: 'texto', desc: 'Folio de la oportunidad (OPP-…)' },
  etapa: { tipo: 'texto', desc: 'Etapa actual (Nueva oportunidad, En costeo, Costeo en validación, Costeo Confirmado, Cotización, En Seguimiento, En Negociación, Esperando OC, Ganada, Perdida, Cancelada)' },
  estado: { tipo: 'texto', desc: 'abierta | ganada | perdida | cancelada' },
  zona: { tipo: 'texto', desc: 'Zona de la oportunidad' },
  vendedor: { tipo: 'texto', desc: 'Vendedor de la oportunidad' },
  institucion: { tipo: 'texto', desc: 'Institución (cliente)' },
  creada: { tipo: 'fecha', desc: 'Fecha de creación de la oportunidad' },
  mes_creada: { tipo: 'texto', desc: 'Mes de creación, YYYY-MM (para agrupar por mes)' },
  anio_creada: { tipo: 'texto', desc: 'Año de creación, YYYY' },
};

export const CAMPOS: Record<Tabla, Record<string, CampoDef>> = {
  oportunidades: {
    ...CAMPOS_COMUNES,
    nombre: { tipo: 'texto', desc: 'Nombre de la oportunidad' },
    fecha_solicitud_costeo: { tipo: 'fecha', desc: 'Día en que se mandó a costeo' },
    fecha_validacion_costeo: { tipo: 'fecha', desc: 'Día en que se validó el costeo' },
    fecha_cotizacion: { tipo: 'fecha', desc: 'Día en que se cotizó' },
    fecha_limite: { tipo: 'fecha', desc: 'Fecha límite de la oportunidad' },
    cotizada: { tipo: 'bool', desc: 'true si ya llegó a cotización (por fecha o por etapa)' },
    horas_costeo: { tipo: 'numero', desc: 'Horas entre solicitud y validación del costeo' },
    monto: { tipo: 'numero', desc: 'Venta sin IVA = Σ Subtotal de sus líneas (MXN)' },
    costo_total: { tipo: 'numero', desc: 'Σ Costo Total de sus líneas (MXN)' },
    utilidad: { tipo: 'numero', desc: 'Σ Utilidad Total de sus líneas (MXN)' },
    lineas: { tipo: 'numero', desc: 'Número de líneas de producto' },
    piezas: { tipo: 'numero', desc: 'Σ Cantidad de sus líneas' },
  },
  lineas: {
    ...CAMPOS_COMUNES,
    oportunidad: { tipo: 'texto', desc: 'Nombre de la oportunidad de la línea' },
    producto: { tipo: 'texto', desc: 'Producto de la línea' },
    sku: { tipo: 'texto', desc: 'SKU' },
    marca: { tipo: 'texto', desc: 'Marca (catálogo)' },
    color: { tipo: 'texto', desc: 'Color' },
    embellecimiento: { tipo: 'bool', desc: 'true si la línea lleva embellecimiento' },
    cantidad: { tipo: 'numero', desc: 'Piezas' },
    precio_venta_cu: { tipo: 'numero', desc: 'Precio de Venta C/U (MXN)' },
    subtotal: { tipo: 'numero', desc: 'Venta sin IVA de la línea (MXN)' },
    costo_total: { tipo: 'numero', desc: 'Costo Total de la línea (MXN)' },
    utilidad_total: { tipo: 'numero', desc: 'Utilidad Total de la línea (MXN)' },
  },
};

export const OPS = ['=', '!=', 'contiene', '>', '>=', '<', '<=', 'en', 'vacio', 'no_vacio'] as const;
export type Op = typeof OPS[number];
export const FNS = ['contar', 'suma', 'promedio', 'mediana', 'min', 'max', 'contar_distintos'] as const;
export type Fn = typeof FNS[number];

export interface Filtro { campo: string; op: Op; valor?: unknown }
export interface Metrica { fn: Fn; campo?: string }
export interface Consulta {
  tabla: Tabla;
  filtros: Filtro[];
  agrupar_por: string[];
  metricas: Metrica[];
  columnas: string[];
  ordenar_por: string | null;
  ascendente: boolean;
  limite: number;
}

export class ConsultaError extends Error {}

export const LIMITE_DEFAULT = 20;
export const LIMITE_MAX = 50;
export const SIN_DATO = '(sin dato)';

const COLUMNAS_DEFAULT: Record<Tabla, string[]> = {
  oportunidades: ['folio', 'nombre', 'etapa', 'vendedor', 'zona', 'institucion', 'monto', 'creada'],
  lineas: ['folio', 'producto', 'sku', 'color', 'cantidad', 'subtotal', 'etapa', 'vendedor'],
};

export const aliasDe = (m: Metrica) => (m.fn === 'contar' ? 'contar' : `${m.fn}_${m.campo}`);

// ── Validación ───────────────────────────────────────────────────────────────

/** Convierte la entrada cruda del modelo en una Consulta válida o lanza
 * ConsultaError con un mensaje que el modelo puede usar para corregirse.
 * `disponibles` = campos que este viewer puede ver (el worker quita los que
 * shared/visibility.ts le tapa, p. ej. utilidad fuera de su whitelist). */
export function validarConsulta(raw: unknown, disponibles: ReadonlySet<string>): Consulta {
  const r = (raw ?? {}) as Record<string, unknown>;
  const tabla = r.tabla;
  if (tabla !== 'oportunidades' && tabla !== 'lineas') {
    throw new ConsultaError('tabla debe ser "oportunidades" o "lineas".');
  }
  const defs = CAMPOS[tabla];
  const validos = Object.keys(defs).filter(c => disponibles.has(c));
  const campo = (c: unknown, donde: string): string => {
    if (typeof c !== 'string' || !(c in defs)) {
      throw new ConsultaError(`Campo desconocido ${JSON.stringify(c)} en ${donde} (tabla ${tabla}). Campos válidos: ${validos.join(', ')}.`);
    }
    if (!disponibles.has(c)) throw new ConsultaError(`El campo "${c}" no está disponible para tu usuario.`);
    return c;
  };
  const lista = (v: unknown, nombre: string, max: number): unknown[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new ConsultaError(`${nombre} debe ser una lista.`);
    if (v.length > max) throw new ConsultaError(`${nombre}: máximo ${max}.`);
    return v;
  };

  const filtros: Filtro[] = lista(r.filtros, 'filtros', 10).map(f => {
    const o = (f ?? {}) as Record<string, unknown>;
    const c = campo(o.campo, 'filtros');
    if (!OPS.includes(o.op as Op)) throw new ConsultaError(`Operador inválido ${JSON.stringify(o.op)}. Usa: ${OPS.join(', ')}.`);
    const op = o.op as Op;
    if (op !== 'vacio' && op !== 'no_vacio' && (o.valor === undefined || o.valor === null || o.valor === '')) {
      throw new ConsultaError(`El filtro sobre "${c}" con "${op}" necesita valor.`);
    }
    if (op === 'en' && !Array.isArray(o.valor)) throw new ConsultaError(`"en" necesita una lista de valores (campo "${c}").`);
    if ((op === '>' || op === '>=' || op === '<' || op === '<=') && defs[c].tipo !== 'numero' && defs[c].tipo !== 'fecha') {
      throw new ConsultaError(`"${op}" solo aplica a números o fechas; "${c}" es ${defs[c].tipo}.`);
    }
    return { campo: c, op, valor: o.valor };
  });

  const agrupar_por = lista(r.agrupar_por, 'agrupar_por', 2).map(c => campo(c, 'agrupar_por'));

  const metricas: Metrica[] = lista(r.metricas, 'metricas', 6).map(m => {
    const o = (m ?? {}) as Record<string, unknown>;
    if (!FNS.includes(o.fn as Fn)) throw new ConsultaError(`Métrica inválida ${JSON.stringify(o.fn)}. Usa: ${FNS.join(', ')}.`);
    const fn = o.fn as Fn;
    if (fn === 'contar') return { fn };
    const c = campo(o.campo, `metrica ${fn}`);
    const tipo = defs[c].tipo;
    if ((fn === 'suma' || fn === 'promedio' || fn === 'mediana') && tipo !== 'numero') {
      throw new ConsultaError(`"${fn}" necesita un campo numérico; "${c}" es ${tipo}.`);
    }
    if ((fn === 'min' || fn === 'max') && tipo !== 'numero' && tipo !== 'fecha') {
      throw new ConsultaError(`"${fn}" necesita un número o fecha; "${c}" es ${tipo}.`);
    }
    return { fn, campo: c };
  });

  const columnas = lista(r.columnas, 'columnas', 12).map(c => campo(c, 'columnas'));

  let ordenar_por: string | null = null;
  if (typeof r.ordenar_por === 'string' && r.ordenar_por.trim()) {
    const o = r.ordenar_por.trim();
    const aliases = new Set(metricas.map(aliasDe));
    if (agrupar_por.length > 0) {
      if (!aliases.has(o) && o !== 'contar' && !agrupar_por.includes(o)) {
        throw new ConsultaError(`ordenar_por "${o}" no existe en el resultado. Opciones: ${['contar', ...aliases, ...agrupar_por].join(', ')}.`);
      }
    } else {
      campo(o, 'ordenar_por');
    }
    ordenar_por = o;
  }

  const limite = Math.min(Math.max(Math.floor(Number(r.limite) || LIMITE_DEFAULT), 1), LIMITE_MAX);
  return {
    tabla, filtros, agrupar_por, metricas, columnas, ordenar_por,
    ascendente: r.ascendente === true,
    limite,
  };
}

// ── Periodo por defecto ──────────────────────────────────────────────────────

/** Año en curso en hora de México (el 31 de dic a las 20:00 locales ya es 1 de
 * enero en UTC — sin la zona, el bot cambiaría de año 6 horas antes). */
export function anioEnCurso(ahora: Date = new Date()): string {
  return ahora.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }).slice(0, 4);
}

/** Sin periodo, las consultas de dirección miran el AÑO EN CURSO (Efraín,
 * 2026-09-11: "por defecto pon el año en curso"). Si la consulta ya filtra por
 * alguna fecha (o por mes/año de creación), se respeta tal cual; con
 * `todaLaHistoria` no se agrega nada. Devuelve el periodo en texto para que el
 * bot lo diga — un total sin su periodo se lee como "de siempre". */
export function aplicarPeriodoDefault(
  c: Consulta, anio: string, todaLaHistoria: boolean,
): { consulta: Consulta; periodo: string } {
  if (todaLaHistoria) return { consulta: c, periodo: 'toda la historia' };
  const defs = CAMPOS[c.tabla];
  const tienePeriodo = c.filtros.some(f =>
    defs[f.campo].tipo === 'fecha' || f.campo === 'mes_creada' || f.campo === 'anio_creada');
  if (tienePeriodo) return { consulta: c, periodo: 'el de los filtros de fecha de la consulta' };
  return {
    consulta: { ...c, filtros: [...c.filtros, { campo: 'creada', op: '>=', valor: `${anio}-01-01` }] },
    periodo: `año en curso (${anio}): oportunidades creadas desde ${anio}-01-01`,
  };
}

// ── Ejecución ────────────────────────────────────────────────────────────────

/** Minúsculas, sin acentos ni espacios de más: "Sureste " = "sureste". */
export function norm(v: unknown): string {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

const vacio = (v: Valor | undefined) => v === null || v === undefined || v === '';

function aBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  const s = norm(v);
  if (['true', 'si', 'sí', '1'].includes(s)) return true;
  if (['false', 'no', '0'].includes(s)) return false;
  return null;
}

function igual(tipo: Tipo, actual: Valor, esperado: unknown): boolean {
  if (vacio(actual)) return false;
  switch (tipo) {
    case 'numero': return Number(actual) === Number(esperado);
    case 'bool': return actual === aBool(esperado);
    // Fecha: "2026-08" es igual a cualquier día de agosto.
    case 'fecha': return String(actual).startsWith(String(esperado).trim());
    default: return norm(actual) === norm(esperado);
  }
}

/** Compara para >,>=,<,<=. Fechas por prefijo: "<= 2026-08" incluye todo agosto. */
function comparar(tipo: Tipo, actual: Valor, esperado: unknown): number | null {
  if (vacio(actual)) return null;
  if (tipo === 'numero') {
    const a = Number(actual); const b = Number(esperado);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return a - b;
  }
  const e = String(esperado).trim();
  const a = String(actual).slice(0, e.length);
  return a < e ? -1 : a > e ? 1 : 0;
}

export function cumple(fila: Fila, f: Filtro, tipo: Tipo): boolean {
  const v = fila[f.campo];
  switch (f.op) {
    case 'vacio': return vacio(v);
    case 'no_vacio': return !vacio(v);
    case '=': return igual(tipo, v ?? null, f.valor);
    case '!=': return !igual(tipo, v ?? null, f.valor);
    case 'en': return (f.valor as unknown[]).some(x => igual(tipo, v ?? null, x));
    case 'contiene': return !vacio(v) && norm(v).includes(norm(f.valor));
    default: {
      const c = comparar(tipo, v ?? null, f.valor);
      if (c === null) return false;
      return f.op === '>' ? c > 0 : f.op === '>=' ? c >= 0 : f.op === '<' ? c < 0 : c <= 0;
    }
  }
}

const redondea = (n: number) => Math.round(n * 100) / 100;

function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function calcMetrica(filas: Fila[], m: Metrica): Valor {
  if (m.fn === 'contar') return filas.length;
  const vals = filas.map(f => f[m.campo!]).filter(v => !vacio(v));
  if (m.fn === 'contar_distintos') return new Set(vals.map(norm)).size;
  if (vals.length === 0) return m.fn === 'suma' ? 0 : null;
  if (typeof vals[0] === 'string' && (m.fn === 'min' || m.fn === 'max')) {
    const s = (vals as string[]).slice().sort();
    return m.fn === 'min' ? s[0] : s[s.length - 1];
  }
  const nums = vals.map(Number).filter(Number.isFinite);
  if (nums.length === 0) return null;
  switch (m.fn) {
    case 'suma': return redondea(nums.reduce((a, b) => a + b, 0));
    case 'promedio': return redondea(nums.reduce((a, b) => a + b, 0) / nums.length);
    case 'mediana': return redondea(mediana(nums)!);
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
  }
}

function cmpValor(a: Valor | undefined, b: Valor | undefined): number {
  // Vacíos siempre al final, sin importar la dirección (se invierte afuera).
  if (vacio(a) && vacio(b)) return 0;
  if (vacio(a)) return 1;
  if (vacio(b)) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'es');
}

function ordenar(filas: Fila[], campo: string, ascendente: boolean): Fila[] {
  return [...filas].sort((x, y) => {
    const a = x[campo]; const b = y[campo];
    if (vacio(a) !== vacio(b)) return vacio(a) ? 1 : -1;
    const c = cmpValor(a, b);
    return ascendente ? c : -c;
  });
}

export interface Resultado {
  filas_que_cumplen: number;
  /** Agrupado: una fila por grupo. Sin agrupar con métricas: una fila de
   * totales. Sin métricas ni grupos: las filas mismas (con `columnas`). */
  resultado: Fila[];
  total_grupos?: number;
  /** Mismas métricas sobre TODO lo filtrado (solo si hay agrupación). */
  totales?: Fila;
  truncado: boolean;
}

export function ejecutarConsulta(filas: Fila[], c: Consulta): Resultado {
  const defs = CAMPOS[c.tabla];
  const filtradas = filas.filter(f => c.filtros.every(fl => cumple(f, fl, defs[fl.campo].tipo)));

  // Listado de filas.
  if (c.agrupar_por.length === 0 && c.metricas.length === 0) {
    const cols = c.columnas.length ? c.columnas : COLUMNAS_DEFAULT[c.tabla].filter(k => filas.length === 0 || k in filas[0]);
    const ordenadas = c.ordenar_por ? ordenar(filtradas, c.ordenar_por, c.ascendente) : filtradas;
    return {
      filas_que_cumplen: filtradas.length,
      resultado: ordenadas.slice(0, c.limite).map(f => Object.fromEntries(cols.map(k => [k, f[k] ?? null]))),
      truncado: ordenadas.length > c.limite,
    };
  }

  const metricas = c.metricas.length ? c.metricas : [{ fn: 'contar' as const }];
  const conContar = metricas.some(m => m.fn === 'contar') ? metricas : [{ fn: 'contar' as const }, ...metricas];

  // Totales sin agrupar.
  if (c.agrupar_por.length === 0) {
    return {
      filas_que_cumplen: filtradas.length,
      resultado: [Object.fromEntries(conContar.map(m => [aliasDe(m), calcMetrica(filtradas, m)]))],
      truncado: false,
    };
  }

  const grupos = new Map<string, { clave: Fila; filas: Fila[] }>();
  for (const f of filtradas) {
    const clave: Fila = {};
    for (const g of c.agrupar_por) clave[g] = vacio(f[g]) ? SIN_DATO : f[g];
    const k = JSON.stringify(c.agrupar_por.map(g => norm(clave[g])));
    const slot = grupos.get(k);
    if (slot) slot.filas.push(f); else grupos.set(k, { clave, filas: [f] });
  }

  const totales: Fila = Object.fromEntries(conContar.map(m => [aliasDe(m), calcMetrica(filtradas, m)]));
  let resultado: Fila[] = [...grupos.values()].map(({ clave, filas: fs }) => {
    const out: Fila = { ...clave };
    for (const m of conContar) {
      const alias = aliasDe(m);
      const v = calcMetrica(fs, m);
      out[alias] = v;
      // Participación de cada grupo: el modelo no tiene que dividir de cabeza.
      if ((m.fn === 'suma' || m.fn === 'contar') && typeof v === 'number' && typeof totales[alias] === 'number' && totales[alias]) {
        out[`${alias}_pct_del_total`] = Math.round((v / (totales[alias] as number)) * 1000) / 10;
      }
    }
    return out;
  });
  const orden = c.ordenar_por ?? aliasDe(c.metricas[0] ?? { fn: 'contar' });
  resultado = ordenar(resultado, orden, c.ascendente);

  return {
    filas_que_cumplen: filtradas.length,
    resultado: resultado.slice(0, c.limite),
    total_grupos: resultado.length,
    totales,
    truncado: resultado.length > c.limite,
  };
}
