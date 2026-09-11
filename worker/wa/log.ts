// worker/wa/log.ts — Bitácora de cada WhatsApp que manda el portal (tabla
// `wa_mensaje`) y de su estado según Meta (Efraín, 2026-09-11: "¿tenemos un log
// de mensajes que enviamos a los celulares?" — no había: solo quedaban en
// sync_log los envíos que tronaban, y nada de si Meta los entregó).
//
// Ciclo: al mandar se guarda la fila con el id de Meta (`wamid`) en 'enviado',
// o en 'rechazado' si Meta no aceptó el envío. Después Meta avisa por el mismo
// webhook de mensajes (worker/wa/routes.ts, `value.statuses`) y la fila avanza a
// 'entregado' → 'leido', o a 'fallido' con el motivo. Todo best-effort: la
// bitácora nunca tumba un envío ni el webhook.
import type { Env } from '../env';

export type WaTipo = 'aviso' | 'anuncio' | 'alerta' | 'bot';
export type WaEstado = 'rechazado' | 'enviado' | 'entregado' | 'leido' | 'fallido';

/** Qué se mandó y a quién — lo pone cada caller de sendText/sendTemplate. */
export interface WaMeta {
  tipo: WaTipo;
  email?: string | null;
  titulo?: string | null;
  boardKey?: string | null;
  itemId?: number | null;
}

export async function registrarEnvio(
  env: Env, telefono: string, meta: WaMeta, r: { wamid: string | null; error?: string },
): Promise<void> {
  try {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO wa_mensaje (wamid, tipo, telefono, email, titulo, board_key, item_id, estado, error, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      r.wamid, meta.tipo, telefono, meta.email ?? null, meta.titulo ? meta.titulo.slice(0, 300) : null,
      meta.boardKey ?? null, meta.itemId ?? null, r.error ? 'rechazado' : 'enviado',
      r.error ? r.error.slice(0, 500) : null, now, now,
    ).run();
  } catch (err) {
    console.warn(`[wa/log] no se pudo registrar el envío a ${telefono}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface EstadoMeta {
  wamid: string;
  estado: WaEstado;
  at: string;
  error: string | null;
}

interface MetaStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
}

const DE_META: Record<string, WaEstado> = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido' };

/** "131026 Message undeliverable: …" — lo que Meta explica de un fallo. */
export function describirError(errors: MetaStatus['errors']): string | null {
  const e = errors?.[0];
  if (!e) return null;
  const detalle = e.error_data?.details ?? e.message ?? '';
  return [e.code, e.title].filter(Boolean).join(' ') + (detalle ? `: ${detalle}` : '');
}

/** Los avisos de estado de un webhook de Meta (`entry[].changes[].value.statuses[]`).
 * Estados que no nos importan (p. ej. 'deleted') se ignoran. */
export function extraerEstados(body: unknown): EstadoMeta[] {
  const out: EstadoMeta[] = [];
  const entries = (body as { entry?: Array<{ changes?: Array<{ value?: { statuses?: MetaStatus[] } }> }> })?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      for (const s of change.value?.statuses ?? []) {
        const estado = s.status ? DE_META[s.status] : undefined;
        if (!s.id || !estado) continue;
        const secs = Number(s.timestamp);
        out.push({
          wamid: s.id,
          estado,
          at: Number.isFinite(secs) && secs > 0 ? new Date(secs * 1000).toISOString() : new Date().toISOString(),
          error: estado === 'fallido' ? describirError(s.errors) : null,
        });
      }
    }
  }
  return out;
}

const RANGO: Record<WaEstado, number> = { rechazado: 0, enviado: 1, entregado: 2, leido: 3, fallido: 3 };

/** Meta puede mandar los avisos en desorden (un 'delivered' después del 'read'):
 * el estado solo avanza, y 'leido'/'fallido' son finales. */
export function siguienteEstado(actual: WaEstado, nuevo: WaEstado): WaEstado {
  if (actual === 'leido' || actual === 'fallido') return actual;
  return RANGO[nuevo] > RANGO[actual] ? nuevo : actual;
}

export async function aplicarEstados(env: Env, estados: EstadoMeta[]): Promise<void> {
  for (const s of estados) {
    try {
      const row = await env.DB.prepare('SELECT estado FROM wa_mensaje WHERE wamid = ?')
        .bind(s.wamid).first<{ estado: WaEstado }>();
      if (!row) continue; // mandado antes de que existiera la bitácora
      await env.DB.prepare(
        `UPDATE wa_mensaje SET estado = ?, error = COALESCE(?, error), updated_at = ?,
           entregado_at = CASE WHEN ? IN ('entregado', 'leido') THEN COALESCE(entregado_at, ?) ELSE entregado_at END,
           leido_at     = CASE WHEN ? = 'leido' THEN COALESCE(leido_at, ?) ELSE leido_at END
         WHERE wamid = ?`,
      ).bind(
        siguienteEstado(row.estado, s.estado), s.error, new Date().toISOString(),
        s.estado, s.at, s.estado, s.at, s.wamid,
      ).run();
    } catch (err) {
      console.warn(`[wa/log] no se pudo aplicar el estado ${s.estado} a ${s.wamid}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
