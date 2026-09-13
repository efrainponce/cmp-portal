// worker/wa/comandos.ts — Router de comandos del bot de WhatsApp: contesta SIN
// modelo todo lo que tiene forma fija (plan docs/plan-wa-cartera.md §6,
// Efraín 2026-09-12: "que sea barato para Haiku, casi casi mensajes hechos en
// código"). Corre ANTES de runAgentLoop; lo que no reconoce sigue al agente.
//
// Qué atiende (todo con texto fijo de worker/lib/cartera.ts render*):
//  - botones del template del resumen: Ver detalle / Cerrar esa / Hoy no
//  - la confirmación abierta (wa_pendiente): SÍ / NO / PERDIDA
//  - preferencias: ajustes, 1–5 con el menú abierto, pausa, parar, reanudar
//  - "cartera" / "hoy" / "pendientes" → la lista numerada; "apagadas",
//    "atoradas", "se mueven" → filtrada
//  - "3" → detalle del #3 de la última lista; "3: llamé, piden muestra" →
//    seguimiento en el #3 (Update en Monday), sin modelo
//  - "cerrar 3" / "cerrar" (la candidata) → pide confirmación; "perder 3"
//  - "hoy no" / "posponer 3" → no se vuelve a proponer en 7 días
//  - "ayuda"
// `parseComando` es puro (comandos.test.ts); `atenderComando` toca D1.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import {
  vistaCartera, renderCartera, renderDetalle, UMBRALES, etiqueta, type VistaCartera, type OportunidadCartera, type Categoria,
} from '../lib/cartera';
import { registrarSeguimiento, cerrarOportunidad, renderCierre, CarteraError, type Cierre } from '../lib/carteraAcciones';
import {
  pendienteActivo, crearPendiente, resolverPendiente, posponer, pospuestas, guardarLista, listaVigente, propuestasRecientes, resumenDelDia, localCdmx, ultimoCierre, type Pendiente,
} from './estado';
import { parseComandoPref, aplicarComandoPref } from './preferencias';

export type Comando =
  | { tipo: 'cartera'; filtro?: Categoria }
  | { tipo: 'detalle'; n: number }
  | { tipo: 'seguimiento'; n: number; texto: string }
  | { tipo: 'cerrar'; n: number | null; cierre: Cierre }
  | { tipo: 'posponer'; n: number | null }
  | { tipo: 'confirmar'; respuesta: 'si' | 'no' | 'perdida' }
  | { tipo: 'motivo'; texto: string }
  | { tipo: 'ayuda' };

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

const CARTERA = new Set(['cartera', 'mi cartera', 'hoy', 'pendientes', 'mis oportunidades', 'oportunidades', 'resumen', 'ver detalle', 'detalle', 'lista', 'que priorizo', 'que priorizo hoy', 'prioridades']);
const FILTROS: Record<string, Categoria> = {
  apagadas: 'apagada', apagada: 'apagada', 'sin movimiento': 'apagada', paradas: 'apagada',
  atoradas: 'atorada', atorada: 'atorada', atascadas: 'atorada',
  'se mueven': 'se_mueve', 'se mueve': 'se_mueve', mueven: 'se_mueve', listas: 'se_mueve', avanzan: 'se_mueve',
  'en curso': 'normal', normales: 'normal',
};
const SI = new Set(['si', 'sí', 'yes', 'ok', 'dale', 'confirmo', 'confirmar', 'va', 'sale', 'claro', 'correcto', 'afirmativo']);
const NO = new Set(['no', 'nel', 'cancelar', 'cancela', 'mejor no', 'espera', 'aun no', 'todavia no']);
const AYUDA = new Set(['ayuda', 'help', '?', 'que puedes hacer', 'comandos', 'menu principal']);
const POSPONER = ['hoy no', 'posponer', 'despues', 'luego', 'mas tarde', 'otro dia', 'la proxima', 'no por ahora'];

/** Payloads de los botones quick-reply del template `resumen_cartera`
 * (worker/wa/resumen.ts). Meta manda el payload cuando se toca el botón. */
export const PAYLOAD = { verDetalle: 'CARTERA_VER', cerrar: 'CARTERA_CERRAR', hoyNo: 'CARTERA_HOY_NO' } as const;

export function parseComando(texto: string, payload?: string | null): Comando | null {
  if (payload === PAYLOAD.verDetalle) return { tipo: 'cartera' };
  if (payload === PAYLOAD.cerrar) return { tipo: 'cerrar', n: null, cierre: 'cancelada' };
  if (payload === PAYLOAD.hoyNo) return { tipo: 'posponer', n: null };

  const t = norm(texto);
  if (!t) return null;
  if (CARTERA.has(t)) return { tipo: 'cartera' };
  if (FILTROS[t]) return { tipo: 'cartera', filtro: FILTROS[t] };
  if (AYUDA.has(t)) return { tipo: 'ayuda' };
  if (SI.has(t)) return { tipo: 'confirmar', respuesta: 'si' };
  if (NO.has(t)) return { tipo: 'confirmar', respuesta: 'no' };
  if (t === 'perdida' || t === 'perdido' || t === 'se perdio') return { tipo: 'confirmar', respuesta: 'perdida' };

  const motivo = /^motivo\s*[:\-–—]\s*(.{2,})$/is.exec(texto.trim());
  if (motivo) return { tipo: 'motivo', texto: motivo[1].trim() };

  const soloNumero = /^#?(\d{1,2})\.?$/.exec(t);
  if (soloNumero) return { tipo: 'detalle', n: Number(soloNumero[1]) };

  const seguimiento = /^#?(\d{1,2})\s*[:\-–—]\s*(.{2,})$/s.exec(texto.trim());
  if (seguimiento) return { tipo: 'seguimiento', n: Number(seguimiento[1]), texto: seguimiento[2].trim() };

  const cerrar = /^(cerrar|archivar|cancelar|perder)(?:\s+(?:la\s+)?#?(\d{1,2}))?(?:\s+(?:la\s+)?(propuesta|candidata|esa|esta))?$/.exec(t);
  if (cerrar) {
    return { tipo: 'cerrar', n: cerrar[2] ? Number(cerrar[2]) : null, cierre: cerrar[1] === 'perder' ? 'perdida' : 'cancelada' };
  }
  for (const p of POSPONER) {
    if (t === p) return { tipo: 'posponer', n: null };
    const m = new RegExp(`^${p}\\s+(?:la\\s+)?#?(\\d{1,2})$`).exec(t);
    if (m) return { tipo: 'posponer', n: Number(m[1]) };
  }
  return null;
}

export const AYUDA_TEXTO = [
  '*Qué puedo hacer por ti*',
  '• *cartera* — tus oportunidades abiertas, priorizadas',
  '• *apagadas* / *atoradas* / *se mueven* — solo esas',
  '• *3* — detalle de la #3 de la lista',
  '• *3: llamé, piden muestra* — guarda ese seguimiento en la oportunidad (queda en Monday)',
  '• *cerrar 3* / *perder 3* — la marco como Cancelada o Perdida (te pido confirmar)',
  '• *hoy no* — no te vuelvo a proponer esa oportunidad en una semana',
  '• *ajustes* — qué te llega por WhatsApp y a qué hora',
  '',
  'También puedes escribirme libre: "¿qué me falta para avanzar la de Hospital X?", "crea una oportunidad…", "¿cómo va PRO-812?".',
].join('\n');

// ── Estado compartido con el resumen ─────────────────────────────────────────

/** La vista de cartera con lo que el chat ya sabe (pospuestas, ya propuestas). */
export async function cargarVista(env: Env, viewer: Identity, ahora = new Date()): Promise<VistaCartera> {
  const [posp, prop] = await Promise.all([
    pospuestas(env, viewer.email, ahora),
    propuestasRecientes(env, viewer.email, UMBRALES.repetir),
  ]);
  return vistaCartera(env, viewer, { pospuestas: posp, propuestas: prop, ahora });
}

async function porPosicion(env: Env, viewer: Identity, n: number): Promise<{ o: OportunidadCartera | null; error: string | null }> {
  const lista = await listaVigente(env, viewer.email);
  if (!lista || lista.itemIds.length === 0) return { o: null, error: 'Todavía no te he mostrado una lista. Escribe *cartera* y luego el número.' };
  const id = lista.itemIds[n - 1];
  if (!id) return { o: null, error: `La lista tiene ${lista.itemIds.length} oportunidades; no hay #${n}.` };
  const vista = await cargarVista(env, viewer);
  const o = vista.oportunidades.find(x => x.item_id === id) ?? null;
  if (!o) return { o: null, error: `La #${n} ya no está abierta (o ya no está en tu cartera).` };
  return { o, error: null };
}

/** La candidata del resumen de hoy; si no hubo, la candidata actual. */
async function candidataDeHoy(env: Env, viewer: Identity): Promise<OportunidadCartera | null> {
  const { fecha } = localCdmx();
  const vista = await cargarVista(env, viewer);
  const hoy = await resumenDelDia(env, viewer.email, fecha);
  if (hoy?.candidataId) {
    const o = vista.oportunidades.find(x => x.item_id === hoy.candidataId);
    if (o) return o;
  }
  return vista.candidata;
}

export interface Atendido { respuesta: string; atendidoPor: string }

/** Un pendiente de menú/hora convierte "3" en opción de preferencias y no en
 * item de la lista: se resuelve primero. */
async function atenderPreferencias(env: Env, viewer: Identity, texto: string, pend: Pendiente | null): Promise<Atendido | null> {
  const cmd = parseComandoPref(texto, { menuAbierto: pend?.tipo === 'menu', esperandoHora: pend?.tipo === 'hora' });
  if (!cmd) return null;
  if (pend && (pend.tipo === 'menu' || pend.tipo === 'hora')) await resolverPendiente(env, pend.id, 'si');
  const { respuesta, pendiente } = await aplicarComandoPref(env, viewer.email, cmd);
  if (pendiente) await crearPendiente(env, viewer.email, pendiente);
  return { respuesta, atendidoPor: `router:pref_${cmd.tipo}` };
}

async function pedirConfirmacionCierre(env: Env, viewer: Identity, o: OportunidadCartera, cierre: Cierre): Promise<Atendido> {
  const etapa = cierre === 'perdida' ? 'Perdida' : 'Cancelada';
  await crearPendiente(env, viewer.email, 'cerrar', { itemId: o.item_id, datos: { cierre, etiqueta: etiqueta(o) } });
  return {
    respuesta: `¿Muevo *${etiqueta(o)}* (${o.institucion}, ${o.diasSinMovimiento} días sin movimiento) a *${etapa}* en Monday?\nResponde *SÍ* o *NO*.${cierre === 'cancelada' ? ' Si se perdió contra un competidor, responde *PERDIDA*.' : ''}\nSi quieres, agrega el motivo después: "2: el cliente eligió otro proveedor".`,
    atendidoPor: 'router:cerrar_confirmar',
  };
}

/** Punto de entrada del router. null = que lo atienda el agente. */
export async function atenderComando(
  env: Env, viewer: Identity, texto: string, opts: { payload?: string | null } = {},
): Promise<Atendido | null> {
  // Un solo snapshot por mensaje para preferencias y confirmación: evita
  // releer el mismo pendiente y decidir con dos estados distintos.
  const pend = await pendienteActivo(env, viewer.email);
  const pref = await atenderPreferencias(env, viewer, texto, pend);
  if (pref) return pref;

  const cmd = parseComando(texto, opts.payload);
  if (!cmd) return null;
  const email = viewer.email;

  try {
    switch (cmd.tipo) {
      case 'ayuda':
        return { respuesta: AYUDA_TEXTO, atendidoPor: 'router:ayuda' };

      case 'cartera': {
        const vista = await cargarVista(env, viewer);
        const { texto: t, itemIds } = renderCartera(vista, { filtro: cmd.filtro, nombre: viewer.nombre });
        if (itemIds.length) await guardarLista(env, email, itemIds, cmd.filtro ? `filtro:${cmd.filtro}` : 'cartera');
        return { respuesta: t, atendidoPor: cmd.filtro ? `router:cartera_${cmd.filtro}` : 'router:cartera' };
      }

      case 'detalle': {
        const { o, error } = await porPosicion(env, viewer, cmd.n);
        if (!o) return { respuesta: error!, atendidoPor: 'router:detalle_sin_lista' };
        return { respuesta: renderDetalle(o), atendidoPor: 'router:detalle' };
      }

      case 'seguimiento': {
        const { o, error } = await porPosicion(env, viewer, cmd.n);
        if (!o) return { respuesta: error!, atendidoPor: 'router:seguimiento_sin_lista' };
        const r = await registrarSeguimiento(env, viewer, o.item_id, cmd.texto);
        return { respuesta: `Guardado en las Actualizaciones de *${etiqueta(o)}* ✅\n"${cmd.texto}"`, atendidoPor: `router:seguimiento#${r.updateId}` };
      }

      case 'cerrar': {
        const o = cmd.n ? (await porPosicion(env, viewer, cmd.n)).o : await candidataDeHoy(env, viewer);
        if (!o) {
          return {
            respuesta: cmd.n ? `No encontré la #${cmd.n} en tu lista. Escribe *cartera* y vuelve a intentar.` : 'No tengo ninguna oportunidad propuesta para cerrar hoy. Escribe *apagadas* y luego "cerrar N".',
            atendidoPor: 'router:cerrar_sin_item',
          };
        }
        return pedirConfirmacionCierre(env, viewer, o, cmd.cierre);
      }

      case 'posponer': {
        const o = cmd.n ? (await porPosicion(env, viewer, cmd.n)).o : await candidataDeHoy(env, viewer);
        if (!o) return { respuesta: 'No hay ninguna propuesta que posponer ahora mismo 👌', atendidoPor: 'router:posponer_sin_item' };
        const hasta = await posponer(env, email, o.item_id, UMBRALES.repetir, cmd.n ? 'posponer' : 'hoy no');
        return { respuesta: `Va. No te vuelvo a proponer *${etiqueta(o)}* hasta el ${hasta.slice(0, 10)}.`, atendidoPor: 'router:posponer' };
      }

      case 'motivo': {
        const ultimo = await ultimoCierre(env, email);
        if (!ultimo) return { respuesta: 'No cerré ninguna oportunidad en la última media hora. Para anotar algo en una, escribe "N: tu nota".', atendidoPor: 'router:motivo_sin_cierre' };
        // getItem 'own' no encuentra una cerrada si el scope la excluye; el
        // seguimiento va por el mismo camino (Update real) y respeta eso.
        const r = await registrarSeguimiento(env, viewer, ultimo.itemId, `Motivo del cierre: ${cmd.texto}`);
        return { respuesta: `Anotado en *${r.etiqueta}* ✅`, atendidoPor: `router:motivo#${r.updateId}` };
      }

      case 'confirmar': {
        if (!pend || pend.tipo !== 'cerrar' || !pend.itemId) {
          // El agente también pide confirmar altas. Sin un pendiente propio,
          // "sí"/"ok"/"no" le pertenecen a esa conversación.
          return null;
        }
        if (!(await resolverPendiente(env, pend.id, cmd.respuesta === 'no' ? 'no' : 'si'))) {
          return { respuesta: 'Esa confirmación ya fue atendida. Revisa el estado de la oportunidad en el portal.', atendidoPor: 'router:confirmar_ya_atendida' };
        }
        if (cmd.respuesta === 'no') {
          return { respuesta: 'Ok, la dejo como está. Si quieres, escribe "N: tu nota" para registrar qué pasó.', atendidoPor: 'router:cerrar_no' };
        }
        const cierre: Cierre = cmd.respuesta === 'perdida' ? 'perdida' : (pend.datos.cierre as Cierre) ?? 'cancelada';
        const r = await cerrarOportunidad(env, viewer, pend.itemId, cierre, '');
        return {
          respuesta: renderCierre(r) + (r.estado === 'confirmed' ? '\nSi quieres dejar el motivo, escribe "motivo: …" y lo agrego a la oportunidad.' : ''),
          atendidoPor: `router:cerrar_${cierre}`,
        };
      }
    }
  } catch (err) {
    if (err instanceof CarteraError) return { respuesta: `No se pudo: ${err.message}`, atendidoPor: 'router:error' };
    throw err;
  }
  return null;
}
