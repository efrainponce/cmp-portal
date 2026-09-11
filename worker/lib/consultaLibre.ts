// worker/lib/consultaLibre.ts — I/O de la consulta libre del agente de
// dirección: arma las filas planas (una por oportunidad o una por línea) desde
// D1 y se las pasa al motor puro (shared/consultaLibre.ts). Cero Monday.
//
// PERMISOS antes de que el modelo vea nada:
// - Renglón: scopeFor('oportunidades', viewer) — mismo SQL que el tablero de
//   Análisis, así la Zona privada "Efrain" no sale ni agregada.
// - Columna: cada campo declara su columna de origen y solo existe si
//   `canRead(board, col, role, email)` — la utilidad queda fuera para quien no
//   está en `puedeVerUtilidades` (Jorge usa la consulta pero no la ve).
//
// Los ids vienen de shared/column-meta.gen.ts (nunca inventados). Se extraen en
// SQL con json_each (patrón de worker/lib/analytics.ts) para no parsear ~4,000
// JSON de columnas en el worker en cada pregunta.
import type { Env } from '../env';
import type { Identity, Role } from '../../shared/types';
import type { BoardSlug } from '../../shared/boards';
import { BOARDS } from '../../shared/boards';
import { canRead } from '../../shared/visibility';
import { alcanzo, etapaLabel, horasEntre } from '../../shared/analytics';
import { CAMPOS, type Fila, type Tabla, type Valor } from '../../shared/consultaLibre';
import { scopeFor } from './dal';

const OPP = {
  folio: 'pulse_id_mm0qcq0m',
  etapa: 'deal_stage',
  zona: 'dropdown_mm03g067',
  vendedor: 'deal_owner',
  institucion: 'lookup_mm1bs976',
  creacion: 'pulse_log_mkzm4v99',
  solCosteo: 'date_mm094kzf',
  valCosteo: 'date_mm0mc3dj',
  cotizacion: 'date_mm09mv5b',
  limite: 'deal_expected_close_date',
} as const;

const LINEA = {
  producto: 'text_mm0bkm1j',
  sku: 'text_mm0bxy39',
  catalogo: 'lookup_mm0x4kda',      // "Nombre del Producto" (mirror del catálogo)
  marca: 'lookup_mm0xn98d',
  color: 'text_mm07s2mg',
  embellecimiento: 'color_mm1b34bg',
  cantidad: 'numeric_mkzm6399',
  precio: 'numeric_mkzneg3d',
  subtotal: 'formula_mkznmjh6',
  costoTotal: 'formula_mkznrm5a',
  utilidadTotal: 'formula_mkznry25',
} as const;

type Fuente = [BoardSlug, string] | null;   // null = dato propio del item (nombre, conteos)

const COMUNES: Record<string, Fuente> = {
  folio: ['oportunidades', OPP.folio],
  etapa: ['oportunidades', OPP.etapa],
  estado: ['oportunidades', OPP.etapa],
  zona: ['oportunidades', OPP.zona],
  vendedor: ['oportunidades', OPP.vendedor],
  institucion: ['oportunidades', OPP.institucion],
  // La Creación (creation_log) no está en VISIBILITY — no es columna de la
  // grid, es metadato del item como el nombre. Es la misma fecha con la que el
  // tablero de Análisis arma sus cohortes para admin, así que no abre nada.
  creada: null,
  mes_creada: null,
  anio_creada: null,
};

/** Columna de origen de cada campo: la visibilidad del campo ES la de su columna. */
export const FUENTES: Record<Tabla, Record<string, Fuente>> = {
  oportunidades: {
    ...COMUNES,
    nombre: null,
    fecha_solicitud_costeo: ['oportunidades', OPP.solCosteo],
    fecha_validacion_costeo: ['oportunidades', OPP.valCosteo],
    fecha_cotizacion: ['oportunidades', OPP.cotizacion],
    fecha_limite: ['oportunidades', OPP.limite],
    cotizada: ['oportunidades', OPP.cotizacion],
    horas_costeo: ['oportunidades', OPP.valCosteo],
    monto: ['oportunidades_sub', LINEA.subtotal],
    costo_total: ['oportunidades_sub', LINEA.costoTotal],
    utilidad: ['oportunidades_sub', LINEA.utilidadTotal],
    lineas: null,
    piezas: ['oportunidades_sub', LINEA.cantidad],
  },
  lineas: {
    ...COMUNES,
    oportunidad: null,
    producto: ['oportunidades_sub', LINEA.producto],
    sku: ['oportunidades_sub', LINEA.sku],
    // Proveedor y Tipo de Producto NO van: sus columnas no están en VISIBILITY
    // (whitelist de Efraín) y sin eso no se exponen, ni a dirección.
    marca: ['oportunidades_sub', LINEA.marca],
    color: ['oportunidades_sub', LINEA.color],
    embellecimiento: ['oportunidades_sub', LINEA.embellecimiento],
    cantidad: ['oportunidades_sub', LINEA.cantidad],
    precio_venta_cu: ['oportunidades_sub', LINEA.precio],
    subtotal: ['oportunidades_sub', LINEA.subtotal],
    costo_total: ['oportunidades_sub', LINEA.costoTotal],
    utilidad_total: ['oportunidades_sub', LINEA.utilidadTotal],
  },
};

/** Campos que este viewer puede usar en esta tabla. */
export function disponiblesPara(tabla: Tabla, role: Role, email: string | null | undefined): Set<string> {
  return new Set(Object.keys(CAMPOS[tabla]).filter(campo => {
    const f = FUENTES[tabla][campo];
    return f === null || (f !== undefined && canRead(f[0], f[1], role, email));
  }));
}

const pickText = (id: string) =>
  `MAX(CASE WHEN json_extract(j.value, '$.id') = '${id}' THEN json_extract(j.value, '$.text') END)`;
/** date/creation_log guardan el dato en `value` (JSON encodeado como string). */
const pickJson = (id: string, key: string) =>
  `MAX(CASE WHEN json_extract(j.value, '$.id') = '${id}' THEN json_extract(json_extract(j.value, '$.value'), '$.${key}') END)`;
const inList = (ids: readonly string[]) => ids.map(id => `'${id}'`).join(',');

function num(t: string | null | undefined): number | null {
  if (t === null || t === undefined || t === '') return null;
  const n = Number(String(t).replace(/[,$\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
const txt = (t: string | null | undefined) => (t && t.trim() ? t.trim() : null);

/** Nombre con el que se agrupa "producto": el del catálogo manda; si la línea
 * no está ligada, el texto de Producto; si tampoco, el nombre de la línea sin
 * el prefijo numérico de SKU ("72175 - Taclite…" → "Taclite…"). Sin esto el
 * mismo producto salía partido en dos grupos (visto en prod, 2026-09-11). */
export function nombreProducto(catalogo: string | null, texto: string | null, nombre: string | null): string | null {
  return txt(catalogo) ?? txt(texto) ?? txt(nombre?.replace(/^\d[\w.-]*\s+-\s+/, ''));
}

interface OppSql {
  item_id: number; name: string;
  folio: string | null; etapa: string | null; zona: string | null; vendedor: string | null; institucion: string | null;
  creada: string | null; sol_d: string | null; sol_at: string | null; val_d: string | null; val_at: string | null;
  cot_d: string | null; cot_at: string | null; limite_d: string | null;
}
interface LineaSql {
  item_id: number; parent_item_id: number; name: string;
  producto: string | null; sku: string | null; catalogo: string | null; marca: string | null;
  color: string | null; embellecimiento: string | null;
  cantidad: string | null; precio: string | null; subtotal: string | null; costo_total: string | null; utilidad_total: string | null;
}

async function leer(env: Env, viewer: Identity): Promise<{ opps: OppSql[]; lineas: LineaSql[] }> {
  const scope = scopeFor('oportunidades', viewer);
  const oppCte = `WITH opp AS (
      SELECT items.item_id AS item_id, items.name AS name, items.columns AS columns
      FROM items WHERE items.board_id = ? AND (${scope.where}))`;

  const oppSql = `${oppCte}
    SELECT o.item_id, o.name,
      ${pickText(OPP.folio)} AS folio, ${pickText(OPP.etapa)} AS etapa, ${pickText(OPP.zona)} AS zona,
      ${pickText(OPP.vendedor)} AS vendedor, ${pickText(OPP.institucion)} AS institucion,
      ${pickJson(OPP.creacion, 'created_at')} AS creada,
      ${pickJson(OPP.solCosteo, 'date')} AS sol_d, ${pickJson(OPP.solCosteo, 'changed_at')} AS sol_at,
      ${pickJson(OPP.valCosteo, 'date')} AS val_d, ${pickJson(OPP.valCosteo, 'changed_at')} AS val_at,
      ${pickJson(OPP.cotizacion, 'date')} AS cot_d, ${pickJson(OPP.cotizacion, 'changed_at')} AS cot_at,
      ${pickJson(OPP.limite, 'date')} AS limite_d
    FROM opp o, json_each(o.columns) j
    WHERE json_extract(j.value, '$.id') IN (${inList(Object.values(OPP))})
    GROUP BY o.item_id`;

  const lineaSql = `${oppCte}
    SELECT s.item_id, s.parent_item_id, s.name,
      ${pickText(LINEA.producto)} AS producto, ${pickText(LINEA.sku)} AS sku,
      ${pickText(LINEA.catalogo)} AS catalogo, ${pickText(LINEA.marca)} AS marca,
      ${pickText(LINEA.color)} AS color,
      ${pickText(LINEA.embellecimiento)} AS embellecimiento, ${pickText(LINEA.cantidad)} AS cantidad,
      ${pickText(LINEA.precio)} AS precio, ${pickText(LINEA.subtotal)} AS subtotal,
      ${pickText(LINEA.costoTotal)} AS costo_total, ${pickText(LINEA.utilidadTotal)} AS utilidad_total
    FROM items s, json_each(s.columns) j
    WHERE s.board_id = ? AND s.parent_item_id IN (SELECT item_id FROM opp)
      AND json_extract(j.value, '$.id') IN (${inList(Object.values(LINEA))})
    GROUP BY s.item_id`;

  const [o, l] = await Promise.all([
    env.DB.prepare(oppSql).bind(BOARDS.oportunidades.id, ...scope.binds).all<OppSql>(),
    env.DB.prepare(lineaSql).bind(BOARDS.oportunidades.id, ...scope.binds, BOARDS.oportunidades_sub.id).all<LineaSql>(),
  ]);
  return { opps: o.results ?? [], lineas: l.results ?? [] };
}

const ESTADO: Record<string, string> = { Ganada: 'ganada', Perdida: 'perdida', Cancelada: 'cancelada' };

/** Solo los campos disponibles viajan en la fila: lo tapado ni siquiera existe. */
function recorta(fila: Record<string, Valor>, disponibles: Set<string>): Fila {
  const out: Fila = {};
  for (const k of disponibles) out[k] = fila[k] ?? null;
  return out;
}

export async function filasConsultaLibre(
  env: Env, viewer: Identity, tabla: Tabla,
): Promise<{ filas: Fila[]; disponibles: Set<string> }> {
  const disponibles = disponiblesPara(tabla, viewer.role, viewer.email);
  const { opps, lineas } = await leer(env, viewer);

  const comunes = new Map<number, Record<string, Valor>>();
  for (const o of opps) {
    const etapa = o.etapa ? etapaLabel(o.etapa) : null;
    const creada = o.creada ? o.creada.slice(0, 10) : null;
    comunes.set(o.item_id, {
      folio: txt(o.folio),
      etapa,
      estado: etapa ? ESTADO[etapa] ?? 'abierta' : null,
      zona: txt(o.zona),
      vendedor: txt(o.vendedor),
      institucion: txt(o.institucion),
      creada,
      mes_creada: creada ? creada.slice(0, 7) : null,
      anio_creada: creada ? creada.slice(0, 4) : null,
    });
  }

  if (tabla === 'lineas') {
    const nombreOpp = new Map(opps.map(o => [o.item_id, o.name]));
    const filas = lineas.map(l => recorta({
      ...(comunes.get(l.parent_item_id) ?? {}),
      oportunidad: nombreOpp.get(l.parent_item_id) ?? null,
      producto: nombreProducto(l.catalogo, l.producto, l.name),
      sku: txt(l.sku),
      marca: txt(l.marca),
      color: txt(l.color),
      embellecimiento: l.embellecimiento ? l.embellecimiento === 'Con Embellecimiento' : null,
      cantidad: num(l.cantidad),
      precio_venta_cu: num(l.precio),
      subtotal: num(l.subtotal),
      costo_total: num(l.costo_total),
      utilidad_total: num(l.utilidad_total),
    }, disponibles));
    return { filas, disponibles };
  }

  const agg = new Map<number, { monto: number; costo: number; utilidad: number; lineas: number; piezas: number }>();
  for (const l of lineas) {
    const a = agg.get(l.parent_item_id) ?? { monto: 0, costo: 0, utilidad: 0, lineas: 0, piezas: 0 };
    a.monto += num(l.subtotal) ?? 0;
    a.costo += num(l.costo_total) ?? 0;
    a.utilidad += num(l.utilidad_total) ?? 0;
    a.lineas += 1;
    a.piezas += num(l.cantidad) ?? 0;
    agg.set(l.parent_item_id, a);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const filas = opps.map(o => {
    const c = comunes.get(o.item_id)!;
    const a = agg.get(o.item_id) ?? { monto: 0, costo: 0, utilidad: 0, lineas: 0, piezas: 0 };
    const horas = horasEntre(o.sol_at, o.val_at);
    return recorta({
      ...c,
      nombre: o.name,
      fecha_solicitud_costeo: o.sol_d ?? o.sol_at?.slice(0, 10) ?? null,
      fecha_validacion_costeo: o.val_d ?? o.val_at?.slice(0, 10) ?? null,
      fecha_cotizacion: o.cot_d ?? o.cot_at?.slice(0, 10) ?? null,
      fecha_limite: o.limite_d,
      cotizada: alcanzo({
        itemId: o.item_id, name: o.name, creada: o.creada, solCosteo: o.sol_at, valCosteo: o.val_at,
        cotizada: o.cot_at ?? o.cot_d, etapa: o.etapa, zona: null, vendedor: null, monto: null, utilidad: null,
      }, 'cotizada'),
      horas_costeo: horas === null ? null : Math.round(horas * 10) / 10,
      monto: r2(a.monto),
      costo_total: r2(a.costo),
      utilidad: r2(a.utilidad),
      lineas: a.lineas,
      piezas: a.piezas,
    }, disponibles);
  });
  return { filas, disponibles };
}
