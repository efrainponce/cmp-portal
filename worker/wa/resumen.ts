// worker/wa/resumen.ts — El resumen matutino de cartera por WhatsApp (plan
// docs/plan-wa-cartera.md §2). SIN modelo: el texto lo arma el código
// (worker/lib/cartera.ts parametrosResumen) y sale por el template
// `resumen_cartera` de Meta (worker/wa/send.ts sendResumenTemplate), que es
// obligatorio porque es un mensaje fuera de la ventana de 24 h.
//
// Cuándo: dentro del cron */15 (worker/index.ts, no hay cupo para otro cron
// — Workers Free = 5 por cuenta) con un gate por persona: su hora local CDMX
// (wa_preferencias.hora) y las dos siguientes, L–V (sábado opcional), una
// vez por día (wa_resumen UNIQUE email+fecha). Aunque NO se mande queda la
// fila con el motivo (cartera vacía, apagado, sin teléfono, error de Meta).
//
// Frescura: antes de armar cada resumen se releen de Monday las oportunidades
// abiertas de la persona en lote (refetchItems ×100), igual que `?fresh=1`
// del drawer — el mensaje de las 8:00 lleva datos de las 7:59.
//
// Encendido por WA_CARTERA=1 (apagado = ni consulta a quién le toca).
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { parametrosResumen, filasCartera } from '../lib/cartera';
import { refetchItems } from '../sync/refetch';
import { logSync } from '../sync/log';
import { registrarError } from '../lib/errores';
import { zonaScopeFields } from '../lib/zonas';
import { sendResumenTemplate } from './send';
import { listPreferencias, getPreferencias, tocaResumen, type Preferencias } from './preferencias';
import { registrarResumen, resumenDelDia, guardarLista, localCdmx } from './estado';
import { cargarVista, PAYLOAD } from './comandos';

export const carteraActiva = (env: Env) => env.WA_CARTERA === '1';

interface Destinatario extends Identity { phone: string }

async function destinatarios(env: Env): Promise<Destinatario[]> {
  const { results } = await env.DB.prepare(
    `SELECT email, phone, nombre, monday_user_id, role FROM identity
      WHERE active = 1 AND phone IS NOT NULL AND role IN ('vendedor', 'compras', 'admin')`,
  ).all<{ email: string; phone: string; nombre: string | null; monday_user_id: number; role: Identity['role'] }>();
  const out: Destinatario[] = [];
  for (const r of results ?? []) {
    const base: Identity = { email: r.email, phone: r.phone, nombre: r.nombre ?? undefined, monday_user_id: r.monday_user_id, role: r.role, active: true };
    out.push({
      ...base,
      phone: r.phone,
      ...(await zonaScopeFields(env, base)),
    });
  }
  return out;
}

export interface ResultadoResumen { email: string; enviado: boolean; motivo?: string }

/** Arma y manda el resumen de UNA persona (o registra por qué no). `forzar`
 * salta el gate de hora/día/apagado (POST /api/admin/wa/resumen/enviar) pero
 * no el de "ya salió hoy". */
export async function enviarResumenA(
  env: Env, viewer: Destinatario, prefs: Preferencias, opts: { forzar?: boolean; ahora?: Date } = {},
): Promise<ResultadoResumen> {
  const ahora = opts.ahora ?? new Date();
  const { fecha, hora, diaSemana } = localCdmx(ahora);
  const email = viewer.email;

  if (await resumenDelDia(env, email, fecha)) return { email, enviado: false, motivo: 'ya salió hoy' };
  if (!opts.forzar) {
    const gate = tocaResumen(prefs, hora, diaSemana, ahora);
    if (!gate.toca) return { email, enviado: false, motivo: gate.motivo };
  }

  try {
    // Fresco: releer las abiertas de esta persona antes de armar el resumen.
    const filas = await filasCartera(env, viewer);
    if (filas.length > 0) {
      try {
        await refetchItems(env, BOARDS.oportunidades.id, filas.map(f => f.item_id));
      } catch (err) {
        await logSync(env, 'manual', BOARDS.oportunidades.id, null, false, `wa-resumen refetch ${email}: ${err}`);
      }
    }
    const vista = await cargarVista(env, viewer, ahora);
    if (vista.oportunidades.length === 0) {
      await registrarResumen(env, { email, fecha, enviado: false, motivo: 'cartera vacía' });
      return { email, enviado: false, motivo: 'cartera vacía' };
    }
    const conCandidata = prefs.cierre;
    const params = parametrosResumen(vista, viewer.nombre ?? email, conCandidata);
    const itemIds = vista.oportunidades.slice(0, 3).map(o => o.item_id);
    const candidataId = conCandidata ? vista.candidata?.item_id ?? null : null;

    // La fila ANTES de mandar (idempotencia: si el envío truena, no se reintenta
    // en la siguiente corrida del cron con otro texto; queda el error).
    const nueva = await registrarResumen(env, { email, fecha, enviado: false, motivo: 'enviando', itemIds, candidataId });
    if (!nueva) return { email, enviado: false, motivo: 'ya salió hoy' };

    let wamid: string | null = null;
    try {
      ({ wamid } = await sendResumenTemplate(env, viewer.phone, params, [PAYLOAD.verDetalle, PAYLOAD.cerrar, PAYLOAD.hoyNo],
        { tipo: 'resumen', email, boardKey: 'oportunidades' }));
    } catch (err) {
      const motivo = `Meta: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
      await env.DB.prepare('UPDATE wa_resumen SET motivo = ? WHERE email = ? AND fecha = ?').bind(motivo, email, fecha).run();
      return { email, enviado: false, motivo };
    }
    await env.DB.prepare('UPDATE wa_resumen SET enviado = 1, motivo = NULL, wamid = ? WHERE email = ? AND fecha = ?').bind(wamid, email, fecha).run();
    // La lista numerada del resumen es la vigente: "2: nota" apunta a la #2 del mensaje.
    await guardarLista(env, email, itemIds, 'resumen');
    return { email, enviado: true };
  } catch (err) {
    await registrarError(env, 'wa-resumen', err, { quien: email });
    await registrarResumen(env, { email, fecha, enviado: false, motivo: `error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) });
    return { email, enviado: false, motivo: 'error' };
  }
}

/** Cron de 15 min: a quién le toca ahora. Nunca lanza. Deja UNA línea en
 * sync_log por corrida que mandó algo (o falló). */
export async function enviarResumenSiToca(env: Env, ahora = new Date()): Promise<ResultadoResumen[]> {
  if (!carteraActiva(env)) return [];
  const t0 = Date.now();
  const out: ResultadoResumen[] = [];
  try {
    const prefs = await listPreferencias(env);
    const { hora, diaSemana } = localCdmx(ahora);
    for (const d of await destinatarios(env)) {
      const p = prefs.get(d.email);
      if (!p) continue;                                   // nunca prendió nada
      if (!tocaResumen(p, hora, diaSemana, ahora).toca) continue;
      out.push(await enviarResumenA(env, d, p, { ahora }));
    }
    const enviados = out.filter(r => r.enviado).length;
    const fallidos = out.filter(r => !r.enviado && r.motivo && !['ya salió hoy', 'cartera vacía'].includes(r.motivo));
    if (enviados > 0 || fallidos.length > 0) {
      await logSync(env, 'manual', null, null, fallidos.length === 0,
        `wa-resumen: ${enviados} enviados, ${fallidos.length} fallidos (${fallidos.map(f => `${f.email}: ${f.motivo}`).join('; ').slice(0, 400)}) en ${Date.now() - t0} ms`);
    }
  } catch (err) {
    await registrarError(env, 'wa-resumen-cron', err);
  }
  return out;
}

/** Envío manual desde el admin (pruebas / "mándaselo ahora"). */
export async function enviarResumenAhora(env: Env, email: string): Promise<ResultadoResumen> {
  const d = (await destinatarios(env)).find(x => x.email === email);
  if (!d) return { email, enviado: false, motivo: 'sin teléfono o sin rol de ventas/compras/admin' };
  return enviarResumenA(env, d, await getPreferencias(env, email), { forzar: true });
}
