// worker/lib/cartera.ts — La VISTA DE CARTERA por persona (plan
// docs/plan-wa-cartera.md, Efraín 2026-09-12). Es "la fuente fresca que Haiku
// lee rápido": por cada oportunidad abierta del viewer, lo derivado que las
// columnas crudas no dicen — días en etapa (activity_log), días sin movimiento
// (monday_updated_at, mismo criterio que Inicio), último seguimiento
// (seguimientos), siguiente paso, prioridad, categoría — y UNA candidata a
// cerrar. El mismo cálculo alimenta la tool `mi_cartera` del bot, el resumen
// matutino por WhatsApp (worker/wa/resumen.ts) y podría alimentar Inicio.
//
// Regla del plan: el CÓDIGO calcula y redacta; el modelo nunca suma ni
// inventa. Por eso los render* devuelven texto listo para WhatsApp — son la
// respuesta directa (agentLoop DIRECT_REPLY_TOOLS) y también lo que manda el
// router de comandos sin modelo.
//
// La parte pura (clasificarCartera, render*) no toca D1: se prueba con fechas
// fijas en cartera.test.ts. Umbrales en UMBRALES — cambiarlos es una línea.
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { CLOSED_STAGES, DEAL_STAGE_LABELS } from '../../shared/dealStages';
import { listItems } from './dal';
import { statusIndex } from './notify';
import { totalesPorOportunidad } from './totales';
import { checkValidacion } from './costeo';

export const UMBRALES = {
  /** ≥ días sin cambio en Monday = "apagada" (Efraín, 2026-08-10, Inicio). */
  apagada: 14,
  /** ≥ días sin movimiento = candidata a cerrar (una por día). */
  cierre: 45,
  /** "En costeo" ≥ días = atorada (compras). */
  costeo: 2,
  /** "Nueva oportunidad" ≥ días sin mandar a costeo = atorada (vendedor). */
  nueva: 3,
  /** Fecha límite a ≤ días = urgente. */
  limite: 7,
  /** Una candidata pospuesta o ya propuesta no se repite en estos días. */
  repetir: 7,
};

// Ids de columnas de Oportunidades (docs/monday-column-map.md) — los mismos
// que worker/lib/assistantTools.ts.
const OPP = {
  folio: 'pulse_id_mm0qcq0m',
  etapa: 'deal_stage',
  institucion: 'lookup_mm1bs976',
  fechaLimite: 'deal_expected_close_date',
};

export type Categoria = 'apagada' | 'atorada' | 'se_mueve' | 'normal';

/** Lo que el loader junta por oportunidad; la parte pura solo lee esto. */
export interface EntradaCartera {
  item_id: number;
  folio: string | null;
  nombre: string;
  institucion: string;
  etapaKey: string | null;
  monto: number;
  fechaLimite: string | null;
  mondayUpdatedAt: string | null;
  /** Cuándo entró a la etapa actual (último evento deal_stage en activity_log); null = no hay registro. */
  etapaDesde: string | null;
  ultimoSeguimiento: { at: string; texto: string } | null;
  /** Qué dice checkValidacion (solo "En costeo", solo compras/admin): null = ok/no aplica. */
  costeoFalta?: string | null;
  /** Pospuesta hasta (wa_snooze) y última vez propuesta como candidata (wa_resumen). */
  pospuestaHasta?: string | null;
  propuestaAt?: string | null;
}

export interface OportunidadCartera extends EntradaCartera {
  etapa: string;
  boardKey: string;
  diasEnEtapa: number;
  diasEtapaAprox: boolean;
  diasSinMovimiento: number;
  diasParaLimite: number | null;
  siguientePaso: string;
  prioridad: number;
  categoria: Categoria;
}

export interface VistaCartera {
  rol: Identity['role'];
  oportunidades: OportunidadCartera[];
  candidata: OportunidadCartera | null;
  conteo: { total: number; se_mueve: number; atorada: number; apagada: number };
}

const DIA = 86_400_000;

function diasDesde(iso: string | null | undefined, ahora: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((ahora.getTime() - t) / DIA));
}

/** Board del portal donde se abre la oportunidad según su etapa (deep link
 * /{boardKey}/{itemId}, src/lib/dealStages.ts). */
export function boardKeyDeEtapa(key: string | null): string {
  if (key === '15') return 'costeo';
  if (key && ['7', '9', '6', '0', '3', '8', '1'].includes(key)) return 'validacion';
  return 'oportunidades';
}

/** Siguiente paso por etapa y rol — texto corto, imperativo, para la persona
 * que lo lee. La categoría sale de aquí y de los días. */
function siguientePasoDe(e: EntradaCartera, rol: Identity['role'], dias: number): { paso: string; seMueve: boolean; atorada: boolean } {
  const vendedor = rol === 'vendedor';
  switch (e.etapaKey) {
    case '4':
      return { paso: 'Mandar a costeo', seMueve: false, atorada: dias >= UMBRALES.nueva };
    case '15':
      if (vendedor) return { paso: 'Compras la está costeando', seMueve: false, atorada: dias >= UMBRALES.costeo };
      if (e.costeoFalta) return { paso: `Costeo: ${e.costeoFalta}`, seMueve: false, atorada: dias >= UMBRALES.costeo };
      return { paso: 'Lista para enviar a validación', seMueve: true, atorada: false };
    case '7':
      return { paso: vendedor ? 'Esperando validación del precio' : 'Validar precio y confirmar costeo', seMueve: !vendedor, atorada: dias >= UMBRALES.costeo && vendedor };
    case '9':
      return { paso: 'Generar la cotización', seMueve: true, atorada: false };
    case '6':
      return { paso: 'Enviar la cotización al cliente y dar seguimiento', seMueve: false, atorada: false };
    case '0':
    case '3':
      return { paso: 'Dar seguimiento al cliente', seMueve: false, atorada: false };
    case '8':
      return { paso: 'Pedir la OC al cliente', seMueve: true, atorada: false };
    default:
      return { paso: 'Revisar', seMueve: false, atorada: false };
  }
}

/** Parte pura: clasifica, prioriza, elige la candidata. */
export function clasificarCartera(
  entradas: EntradaCartera[], rol: Identity['role'], ahora = new Date(), u = UMBRALES,
): VistaCartera {
  const montos = entradas.map(e => e.monto).filter(m => m > 0).sort((a, b) => a - b);
  const corteAlto = montos.length >= 3 ? montos[Math.floor(montos.length * 2 / 3)] : Infinity;

  const oportunidades: OportunidadCartera[] = entradas.map(e => {
    const diasSinMovimiento = diasDesde(e.mondayUpdatedAt, ahora) ?? 0;
    const enEtapa = diasDesde(e.etapaDesde, ahora);
    const diasEnEtapa = enEtapa ?? diasSinMovimiento;
    const diasParaLimite = e.fechaLimite
      ? Math.ceil((new Date(e.fechaLimite).getTime() - ahora.getTime()) / DIA)
      : null;
    const { paso, seMueve, atorada } = siguientePasoDe(e, rol, diasEnEtapa);
    const apagada = diasSinMovimiento >= u.apagada;
    const categoria: Categoria = apagada ? 'apagada' : atorada ? 'atorada' : seMueve ? 'se_mueve' : 'normal';

    let prioridad = 0;
    if (diasParaLimite !== null && Number.isFinite(diasParaLimite)) {
      if (diasParaLimite < 0) prioridad += 4;
      else if (diasParaLimite <= u.limite) prioridad += 3;
    }
    if (e.etapaKey === '8') prioridad += 3;
    else if (e.etapaKey === '7' || e.etapaKey === '9') prioridad += 2;
    else if (e.etapaKey === '15') prioridad += 1;
    if (e.monto > 0 && e.monto >= corteAlto) prioridad += 1;
    if (apagada) prioridad += 1;
    if (atorada) prioridad += 1;

    return {
      ...e,
      etapa: e.etapaKey ? DEAL_STAGE_LABELS[e.etapaKey] ?? e.etapaKey : 'Sin etapa',
      boardKey: boardKeyDeEtapa(e.etapaKey),
      diasEnEtapa, diasEtapaAprox: enEtapa === null, diasSinMovimiento,
      diasParaLimite: diasParaLimite !== null && Number.isFinite(diasParaLimite) ? diasParaLimite : null,
      siguientePaso: paso, prioridad, categoria,
    };
  });

  oportunidades.sort((a, b) => b.prioridad - a.prioridad || b.diasSinMovimiento - a.diasSinMovimiento || b.monto - a.monto);

  const t = ahora.getTime();
  const candidatas = oportunidades
    .filter(o => o.diasSinMovimiento >= u.cierre)
    .filter(o => !o.pospuestaHasta || new Date(o.pospuestaHasta).getTime() <= t)
    .filter(o => !o.propuestaAt || t - new Date(o.propuestaAt).getTime() >= u.repetir * DIA)
    .sort((a, b) => b.diasSinMovimiento - a.diasSinMovimiento);

  return {
    rol,
    oportunidades,
    candidata: candidatas[0] ?? null,
    conteo: {
      total: oportunidades.length,
      se_mueve: oportunidades.filter(o => o.categoria === 'se_mueve').length,
      atorada: oportunidades.filter(o => o.categoria === 'atorada').length,
      apagada: oportunidades.filter(o => o.categoria === 'apagada').length,
    },
  };
}

// ── Loader (D1) ───────────────────────────────────────────────────────────────

function colText(columnsJson: string, id: string): string | null {
  try {
    const cols = JSON.parse(columnsJson || '[]') as Array<{ id: string; text: string | null }>;
    return cols.find(c => c.id === id)?.text ?? null;
  } catch {
    return null;
  }
}

function dedupe(text: string | null): string {
  if (!text) return '';
  const parts = Array.from(new Set(text.split(/,\s+/).map(s => s.trim()).filter(Boolean)));
  return parts.length <= 2 ? parts.join(', ') : `${parts[0]} +${parts.length - 1}`;
}

function lotes<T>(arr: T[], n = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Cuándo entró cada item a su etapa actual: el último evento deal_stage en
 * activity_log (desde 2026-08-14; antes no hay registro → null → "aprox"). */
async function etapaDesdePorItem(env: Env, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const lote of lotes(ids)) {
    const { results } = await env.DB.prepare(
      `SELECT item_id, MAX(created_at) AS at FROM activity_log
        WHERE board_id = ? AND column_id = 'deal_stage' AND item_id IN (${lote.map(() => '?').join(',')})
        GROUP BY item_id`,
    ).bind(BOARDS.oportunidades.id, ...lote).all<{ item_id: number; at: string }>();
    for (const r of results ?? []) out.set(r.item_id, r.at);
  }
  return out;
}

async function ultimoSeguimientoPorItem(env: Env, ids: number[]): Promise<Map<number, { at: string; texto: string }>> {
  const out = new Map<number, { at: string; texto: string }>();
  try {
    for (const lote of lotes(ids)) {
      const { results } = await env.DB.prepare(
        `SELECT item_id, mensaje, created_at FROM seguimientos
          WHERE item_id IN (${lote.map(() => '?').join(',')}) ORDER BY created_at DESC`,
      ).bind(...lote).all<{ item_id: number; mensaje: string; created_at: string }>();
      for (const r of results ?? []) {
        if (!out.has(r.item_id)) out.set(r.item_id, { at: r.created_at, texto: r.mensaje.slice(0, 120) });
      }
    }
  } catch { /* la tabla nace con el primer seguimiento */ }
  return out;
}

export interface ExtrasCartera {
  pospuestas?: Map<number, string>;
  propuestas?: Map<number, string>;
  ahora?: Date;
}

function esDelViewer(r: MirrorItem, viewer: Identity): boolean {
  try {
    const ids = JSON.parse(r.vendedor_ids || '[]') as number[];
    return ids.includes(viewer.monday_user_id);
  } catch {
    return false;
  }
}

/** Oportunidades abiertas que le tocan al viewer: el vendedor las suyas
 * (scope 'own', igual que Inicio); compras las SUYAS que están en costeo o
 * validación; el admin SOLO las que tienen su id de Vendedor — su
 * scope 'own' es toda la empresa (528 abiertas en la prueba local) y un
 * resumen así no le sirve a nadie. El resumen de equipo para dirección es
 * la Fase 5 del plan, pendiente. */
export async function filasCartera(env: Env, viewer: Identity): Promise<MirrorItem[]> {
  const compras = viewer.role === 'compras';
  const rows = await listItems(env, 'oportunidades', viewer, undefined, 'own');
  return rows.filter(r => {
    const key = statusIndex(r.columns, OPP.etapa);
    if (key && CLOSED_STAGES.has(key)) return false;
    if (compras) return key === '15' || key === '7';
    if (viewer.role === 'admin') return esDelViewer(r, viewer);
    return true;
  });
}

const MAX_CHECKS_COSTEO = 30;

export async function vistaCartera(env: Env, viewer: Identity, extras: ExtrasCartera = {}): Promise<VistaCartera> {
  const rows = await filasCartera(env, viewer);
  const ids = rows.map(r => r.item_id);
  const [totales, etapaDesde, seguimientos] = await Promise.all([
    totalesPorOportunidad(env, viewer.role, new Set(ids), viewer.email),
    etapaDesdePorItem(env, ids),
    ultimoSeguimientoPorItem(env, ids),
  ]);

  // Compras/admin: qué le falta al costeo (mismo chequeo que bloquea el botón).
  const costeoFalta = new Map<number, string | null>();
  if (viewer.role !== 'vendedor') {
    const enCosteo = rows.filter(r => statusIndex(r.columns, OPP.etapa) === '15').slice(0, MAX_CHECKS_COSTEO);
    for (const r of enCosteo) {
      try {
        const res = await checkValidacion(env, r.item_id, viewer);
        costeoFalta.set(r.item_id, res.ok ? null : (res.errors?.[0] ?? 'Costeo incompleto'));
      } catch {
        costeoFalta.set(r.item_id, null);
      }
    }
  }

  const entradas: EntradaCartera[] = rows.map(r => ({
    item_id: r.item_id,
    folio: colText(r.columns, OPP.folio),
    nombre: r.name,
    institucion: dedupe(colText(r.columns, OPP.institucion)) || 'Sin institución',
    etapaKey: statusIndex(r.columns, OPP.etapa),
    monto: totales[String(r.item_id)]?.subtotal ?? 0,
    fechaLimite: colText(r.columns, OPP.fechaLimite),
    mondayUpdatedAt: r.monday_updated_at,
    etapaDesde: etapaDesde.get(r.item_id) ?? null,
    ultimoSeguimiento: seguimientos.get(r.item_id) ?? null,
    costeoFalta: costeoFalta.get(r.item_id) ?? null,
    pospuestaHasta: extras.pospuestas?.get(r.item_id) ?? null,
    propuestaAt: extras.propuestas?.get(r.item_id) ?? null,
  }));
  return clasificarCartera(entradas, viewer.role, extras.ahora ?? new Date());
}

// ── Render (texto listo para WhatsApp) ────────────────────────────────────────

const pesos = (n: number) => n > 0 ? `$${Math.round(n).toLocaleString('es-MX')}` : 'sin precio';
const dias = (n: number) => n === 1 ? '1 día' : `${n} días`;

/** "PRO-812 Hospital Ángeles"; si el nombre ya trae el folio (muchos lo
 * traen: "OPP-0661 - RADIOS…"), no se repite. */
export function etiqueta(o: OportunidadCartera): string {
  if (!o.folio || o.nombre.toLowerCase().includes(o.folio.toLowerCase())) return o.nombre.trim();
  return `${o.folio} ${o.nombre}`.trim();
}

const recortar = (s: string, n: number) => s.length > n ? `${s.slice(0, n - 1)}…` : s;

/** Una línea por oportunidad, sin saltos (también sirve de parámetro de
 * template de Meta, que no acepta saltos de línea). */
export function renderLinea(o: OportunidadCartera, maxLen = 110): string {
  const etapa = o.etapaKey === '15' || o.etapaKey === '4' || o.etapaKey === '7'
    ? `${o.etapa.toLowerCase()} desde hace ${dias(o.diasEnEtapa)}${o.diasEtapaAprox ? ' aprox' : ''}`
    : o.categoria === 'apagada' ? `${dias(o.diasSinMovimiento)} sin movimiento` : o.etapa.toLowerCase();
  const limite = o.diasParaLimite !== null && o.diasParaLimite <= UMBRALES.limite
    ? (o.diasParaLimite < 0 ? ' · límite vencido' : o.diasParaLimite === 0 ? ' · límite HOY' : ` · límite en ${dias(o.diasParaLimite)}`)
    : '';
  // Lo importante (etapa/días/límite) va al final y no se recorta: se
  // recortan el nombre y la institución para que quepa.
  const cola = ` · ${etapa}${limite}`;
  const cabe = Math.max(30, maxLen - cola.length);
  const inst = recortar(o.institucion, Math.min(28, Math.floor(cabe / 3)));
  const nombre = recortar(etiqueta(o), cabe - inst.length - 3);
  return `${nombre} · ${inst}${cola}`.replace(/\s+/g, ' ');
}

export const CATEGORIA_LABEL: Record<Categoria, string> = {
  se_mueve: 'se mueven', atorada: 'atoradas', apagada: 'apagadas', normal: 'en curso',
};

export function renderConteo(v: VistaCartera): string {
  const c = v.conteo;
  const partes = [
    c.se_mueve > 0 ? `${c.se_mueve} ${c.se_mueve === 1 ? 'se mueve' : 'se mueven'}` : null,
    c.atorada > 0 ? `${c.atorada} ${c.atorada === 1 ? 'atorada' : 'atoradas'}` : null,
    c.apagada > 0 ? `${c.apagada} ${c.apagada === 1 ? 'apagada' : 'apagadas'}` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(' · ') : 'todo en curso';
}

const MAX_LINEAS = 15;

/** La cartera completa (o filtrada), numerada. Devuelve el texto y los ids
 * en el orden mostrado — el caller los guarda para que "3" y "3: nota"
 * resuelvan contra esta lista. */
export function renderCartera(v: VistaCartera, opts: { filtro?: Categoria; nombre?: string } = {}): { texto: string; itemIds: number[] } {
  const lista = opts.filtro ? v.oportunidades.filter(o => o.categoria === opts.filtro) : v.oportunidades;
  if (v.oportunidades.length === 0) {
    return { texto: v.rol === 'compras' ? 'No hay oportunidades en costeo ni en validación ahora mismo 👌' : 'No tienes oportunidades abiertas ahora mismo 👌', itemIds: [] };
  }
  if (lista.length === 0) {
    return { texto: `No tienes oportunidades ${CATEGORIA_LABEL[opts.filtro!]} 👌 (${v.conteo.total} abiertas: ${renderConteo(v)})`, itemIds: [] };
  }
  const titulo = opts.filtro
    ? `*${lista.length} ${CATEGORIA_LABEL[opts.filtro]}* de ${v.conteo.total} abiertas`
    : `*${v.conteo.total} abiertas*: ${renderConteo(v)}`;
  const visibles = lista.slice(0, MAX_LINEAS);
  const lineas = visibles.map((o, i) => `${i + 1}. ${renderLinea(o)} · ${pesos(o.monto)}\n   → ${o.siguientePaso}`);
  const resto = lista.length > visibles.length ? `\n… y ${lista.length - visibles.length} más (escribe "apagadas", "atoradas" o "se mueven" para filtrar).` : '';
  const pie = '\n\nEscribe el número para ver el detalle, o "2: tu nota" para guardar un seguimiento.';
  return { texto: `${titulo}\n\n${lineas.join('\n')}${resto}${pie}`, itemIds: visibles.map(o => o.item_id) };
}

export function renderDetalle(o: OportunidadCartera): string {
  const partes = [
    `*${etiqueta(o)}*`,
    `${o.institucion}`,
    `Etapa: ${o.etapa} (${dias(o.diasEnEtapa)}${o.diasEtapaAprox ? ' aprox' : ''})`,
    `Sin movimiento: ${dias(o.diasSinMovimiento)}`,
    `Monto: ${pesos(o.monto)}`,
    o.fechaLimite ? `Fecha límite: ${o.fechaLimite}${o.diasParaLimite !== null && o.diasParaLimite < 0 ? ' (vencida)' : ''}` : null,
    o.ultimoSeguimiento ? `Último seguimiento (${o.ultimoSeguimiento.at.slice(0, 10)}): ${o.ultimoSeguimiento.texto}` : 'Sin seguimientos registrados',
    `Siguiente paso: ${o.siguientePaso}`,
    `https://portal.mexicanadeproteccion.com/${o.boardKey}/${o.item_id}`,
  ].filter(Boolean);
  return partes.join('\n');
}

export interface EventoHistorial { at: string; texto: string }

/** Historial de una oportunidad: cambios de etapa y seguimientos, mezclados
 * por fecha, más reciente al final (se lee como una historia). */
export function renderHistorial(o: OportunidadCartera, eventos: EventoHistorial[]): string {
  const orden = [...eventos].sort((a, b) => a.at.localeCompare(b.at)).slice(-15);
  const cuerpo = orden.length
    ? orden.map(e => `• ${e.at.slice(0, 10)}: ${e.texto}`).join('\n')
    : '• Sin cambios de etapa ni seguimientos registrados desde 2026-08-14.';
  return `*${etiqueta(o)}* — ${o.etapa}, ${dias(o.diasSinMovimiento)} sin movimiento\n${cuerpo}\nSiguiente paso: ${o.siguientePaso}`;
}

/** Los parámetros del template `resumen_cartera` (worker/wa/resumen.ts):
 * saludo, conteo, hasta 3 líneas de prioridad y la candidata. Sin saltos de
 * línea y con contenido fijo si falta algo (Meta rechaza parámetros vacíos). */
export function parametrosResumen(v: VistaCartera, nombre: string, conCandidata: boolean): string[] {
  const top = v.oportunidades.slice(0, 3);
  const linea = (i: number) => top[i] ? `${i + 1}. ${renderLinea(top[i], 95)} → ${top[i].siguientePaso}` : '—';
  const candidata = conCandidata && v.candidata
    ? `${renderLinea(v.candidata, 90)}. Responde "cerrar" o "hoy no".`
    : 'nada por hoy';
  return [
    nombre.split(' ')[0] || nombre,
    `${v.conteo.total} abiertas, ${renderConteo(v)}`,
    linea(0), linea(1), linea(2),
    candidata,
  ].map(s => s.replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ').slice(0, 300));
}
