// worker/wa/send.ts — WhatsApp Cloud API (Meta Graph) outbound helpers.
// Cada mensaje queda en la bitácora `wa_mensaje` (worker/wa/log.ts) con el id
// que devuelve Meta, para seguir después si se entregó.
import type { Env } from '../env';
import { registrarEnvio, type WaMeta } from './log';

const GRAPH = 'https://graph.facebook.com/v20.0';

async function graphPost(env: Env, body: Record<string, unknown>): Promise<{ wamid: string | null }> {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error('WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured');
  }
  const res = await fetch(`${GRAPH}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`WhatsApp send failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json = await res.json().catch(() => null) as { messages?: Array<{ id?: string }> } | null;
  return { wamid: json?.messages?.[0]?.id ?? null };
}

// Meta's Cloud API reports MX inbound numbers with a legacy "1" after the
// country code (5215512345678), but sending to that exact string 400s with
// #131030 "not in allowed list" — the allow-list (and real delivery) only
// recognizes the number without it (525512345678). Strip it before sending.
function normalizeMxTo(to: string): string {
  return /^521\d{10}$/.test(to) ? `52${to.slice(3)}` : to;
}

/** Manda y deja la fila en la bitácora — también si Meta lo rechaza (y relanza).
 * `respaldo`: cuerpo alterno que se intenta UNA vez si Meta dice que el
 * template no existe o no está aprobado (sin dejar fila del primer intento). */
async function enviar(env: Env, to: string, body: Record<string, unknown>, meta: WaMeta, respaldo?: Record<string, unknown>): Promise<void> {
  const telefono = normalizeMxTo(to);
  let wamid: string | null;
  try {
    try {
      ({ wamid } = await graphPost(env, { to: telefono, ...body }));
    } catch (err) {
      if (!respaldo || !templateNoDisponible(err)) throw err;
      ({ wamid } = await graphPost(env, { to: telefono, ...respaldo }));
    }
  } catch (err) {
    await registrarEnvio(env, telefono, meta, { wamid: null, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  await registrarEnvio(env, telefono, meta, { wamid });
}

/** Send a plain text message. WhatsApp caps text bodies at 4096 chars. */
export async function sendText(env: Env, to: string, body: string, meta: WaMeta): Promise<void> {
  await enviar(env, to, { type: 'text', text: { body: body.slice(0, 4000) } }, { titulo: body, ...meta });
}

// Body {{1}} = título, botón URL dinámica base
// `https://portal.mexicanadeproteccion.com/` + {{1}} = "{boardKey}/{itemId}".
// `portal_aviso` es categoría UTILITY (alta 2026-09-29): `portal_notificacion`
// quedó como MARKETING en Meta, y Meta topa los de marketing por persona —
// 131049 "healthy ecosystem engagement", ~40 avisos perdidos al día. Mientras
// Meta no apruebe `portal_aviso` (o si la pausa), cae a la vieja.
const NOTIFY_TEMPLATE_NAME = 'portal_aviso';
const NOTIFY_TEMPLATE_RESPALDO = 'portal_notificacion';
const NOTIFY_TEMPLATE_LANG = 'es_MX';

/** Errores de Meta de "ese template no se puede usar": 132001 no existe (o no
 * está aprobado en ese idioma), 132015 pausado, 132016 deshabilitado. Puro. */
export function templateNoDisponible(err: unknown): boolean {
  return /\b13200[01]\b|\b13201[56]\b/.test(err instanceof Error ? err.message : String(err));
}

/** Notificación proactiva del portal (fuera de la ventana de 24h del bot) — requiere
 * el template pre-aprobado por Meta. `urlSuffix` es el sufijo dinámico del botón
 * ("{boardKey}/{itemId}"), mismo formato de ruta que src/lib/routing.ts. */
export async function sendTemplate(
  env: Env, to: string, args: { bodyText: string; urlSuffix: string }, meta: WaMeta,
): Promise<void> {
  const cuerpo = (name: string) => ({
    type: 'template',
    template: {
      name,
      language: { code: NOTIFY_TEMPLATE_LANG },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: args.bodyText.slice(0, 1024) }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: args.urlSuffix }] },
      ],
    },
  });
  await enviar(env, to, cuerpo(NOTIFY_TEMPLATE_NAME), { titulo: args.bodyText, ...meta }, cuerpo(NOTIFY_TEMPLATE_RESPALDO));
}

// Resumen matutino de cartera (worker/wa/resumen.ts, plan docs/plan-wa-cartera.md
// §2). Template a dar de alta en Meta Business Manager (Utility, es_MX),
// cuerpo con 6 parámetros de una línea y 3 botones quick-reply:
//   Buenos días {{1}}. Tu cartera hoy: {{2}}.
//   • {{3}}
//   • {{4}}
//   • {{5}}
//   Para cerrar hoy: {{6}}
//   [Ver detalle] [Cerrar esa] [Hoy no]
// Los payloads de los botones son los de worker/wa/comandos.ts PAYLOAD; al
// tocarlos Meta manda un mensaje tipo `button` y abre la ventana de 24 h.
const RESUMEN_TEMPLATE_NAME = 'resumen_cartera';
const RESUMEN_TEMPLATE_LANG = 'es_MX';

export async function sendResumenTemplate(
  env: Env, to: string, params: string[], payloads: [string, string, string], meta: WaMeta,
): Promise<{ wamid: string | null }> {
  const telefono = normalizeMxTo(to);
  const body = {
    type: 'template',
    template: {
      name: RESUMEN_TEMPLATE_NAME,
      language: { code: RESUMEN_TEMPLATE_LANG },
      components: [
        { type: 'body', parameters: params.map(text => ({ type: 'text', text: text.slice(0, 1024) })) },
        ...payloads.map((payload, i) => ({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload }] })),
      ],
    },
  };
  let wamid: string | null;
  try {
    ({ wamid } = await graphPost(env, { to: telefono, ...body }));
  } catch (err) {
    await registrarEnvio(env, telefono, { titulo: params.join(' | '), ...meta }, { wamid: null, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  await registrarEnvio(env, telefono, { titulo: params.join(' | '), ...meta }, { wamid });
  return { wamid };
}

/** Mark an incoming message as read (blue ticks) — best-effort, never throws. */
export async function markRead(env: Env, messageId: string): Promise<void> {
  try {
    await graphPost(env, { status: 'read', message_id: messageId });
  } catch { /* cosmetic only */ }
}
