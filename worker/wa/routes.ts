// worker/wa/routes.ts — WhatsApp Cloud API webhook. Registered before the
// access/identity middleware (Meta can't present Cloudflare Access creds);
// auth here is Meta's HMAC signature + the phone→identity whitelist (fail closed).
import type { Hono } from 'hono';
import type { Env } from '../env';
import { identityByPhone, alreadyProcessed } from './store';
import { handleIncoming } from './agent';
import { sendText, markRead } from './send';
import { aplicarEstados, extraerEstados } from './log';
import { registrarEntrante } from './bitacora';
import { atenderComando } from './comandos';
import { deltaSyncIfStale } from '../sync/delta';
import { registrarError } from '../lib/errores';

interface WaMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  // Botón quick-reply de un template (resumen matutino): Meta manda el payload
  // y el texto del botón (worker/wa/comandos.ts PAYLOAD).
  button?: { payload?: string; text?: string };
  // Botones/listas interactivos mandados en la ventana de 24 h.
  interactive?: { type?: string; button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
}

/** Texto + payload de un mensaje entrante; null si no es algo que sepamos leer. */
export function leerEntrante(msg: WaMessage): { texto: string; payload: string | null } | null {
  if (msg.type === 'text' && msg.text?.body) return { texto: msg.text.body, payload: null };
  if (msg.type === 'button' && (msg.button?.text || msg.button?.payload)) {
    return { texto: msg.button.text ?? msg.button.payload ?? '', payload: msg.button.payload ?? null };
  }
  if (msg.type === 'interactive') {
    const r = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
    if (r?.title || r?.id) return { texto: r.title ?? r.id ?? '', payload: r.id ?? null };
  }
  return null;
}

// El espejo se refresca con el latido de los GET del portal (30 s); el
// webhook es POST y no lo dispara. Antes de contestar, un latido si el último
// tiene más de 2 min — así "¿cómo va PRO-812?" no contesta con datos viejos.
const LATIDO_MS = 2 * 60_000;

interface WaWebhookBody {
  entry?: Array<{
    changes?: Array<{
      value?: { messages?: WaMessage[] };
    }>;
  }>;
}

async function validSignature(env: Env, rawBody: string, header: string | undefined): Promise<boolean> {
  if (!env.WA_APP_SECRET) {
    // Fail closed in prod; allow unsigned only for local dev.
    return env.ENVIRONMENT !== 'prod';
  }
  if (!header?.startsWith('sha256=')) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(env.WA_APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  const given = header.slice('sha256='.length).toLowerCase();
  if (given.length !== hex.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

async function processMessage(env: Env, msg: WaMessage): Promise<void> {
  if (await alreadyProcessed(env, msg.id)) return;
  const t0 = Date.now();
  const entrada = leerEntrante(msg);

  const viewer = await identityByPhone(env, msg.from);
  if (!viewer) {
    await sendText(env, msg.from, 'Hola 👋 Este asistente es solo para el equipo de CMP. Si eres vendedor, pide al administrador que dé de alta tu número.', { tipo: 'bot' });
    await registrarEntrante(env, { wamid: msg.id, telefono: msg.from, tipo: msg.type, texto: entrada?.texto ?? '', atendidoPor: 'rechazado:sin_identity', latenciaMs: Date.now() - t0 });
    return;
  }
  const meta = { tipo: 'bot' as const, email: viewer.email };

  await markRead(env, msg.id);

  if (!entrada) {
    await sendText(env, msg.from, 'Por ahora solo puedo leer mensajes de texto 🙏', meta);
    await registrarEntrante(env, { wamid: msg.id, telefono: msg.from, email: viewer.email, tipo: msg.type, texto: '', atendidoPor: 'rechazado:tipo_no_soportado', latenciaMs: Date.now() - t0 });
    return;
  }

  let atendidoPor = 'agente';
  let reply = '';
  let error: string | null = null;
  try {
    try { await deltaSyncIfStale(env, LATIDO_MS); } catch { /* el espejo de hace 15 min sigue sirviendo */ }
    // Primero el router (sin modelo); lo que no reconoce va al agente.
    const directo = await atenderComando(env, viewer, entrada.texto, { payload: entrada.payload });
    if (directo) {
      atendidoPor = directo.atendidoPor;
      reply = directo.respuesta;
    } else {
      reply = await handleIncoming(env, viewer, msg.from, entrada.texto);
    }
    await sendText(env, msg.from, reply, meta);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    await registrarError(env, 'wa-webhook', err, { quien: viewer.email });
    reply = 'Ocurrió un error procesando tu mensaje 😕 Intenta de nuevo en un momento.';
    await sendText(env, msg.from, reply, meta).catch(() => undefined);
  }
  await registrarEntrante(env, {
    wamid: msg.id, telefono: msg.from, email: viewer.email, tipo: msg.type, texto: entrada.texto,
    atendidoPor, respuesta: reply, latenciaMs: Date.now() - t0, error,
  });
}

export function waRoutes(app: Hono<{ Bindings: Env }>): void {
  // Meta webhook verification handshake
  app.get('/wa/webhook', c => {
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token');
    const challenge = c.req.query('hub.challenge');
    if (mode === 'subscribe' && c.env.WA_VERIFY_TOKEN && token === c.env.WA_VERIFY_TOKEN && challenge) {
      return c.text(challenge);
    }
    return c.text('forbidden', 403);
  });

  // Incoming messages. Ack fast; process in the background.
  app.post('/wa/webhook', async c => {
    const raw = await c.req.text();
    if (!(await validSignature(c.env, raw, c.req.header('x-hub-signature-256')))) {
      return c.text('invalid signature', 401);
    }

    let body: WaWebhookBody;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.text('bad request', 400);
    }

    const messages: WaMessage[] = [];
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const m of change.value?.messages ?? []) messages.push(m);
      }
    }
    if (messages.length > 0) {
      c.executionCtx.waitUntil(
        (async () => {
          for (const m of messages) await processMessage(c.env, m);
        })(),
      );
    }
    // Avisos de estado de lo que mandamos (entregado/leído/fallido) — llegan por
    // este mismo webhook; se asientan en la bitácora (worker/wa/log.ts).
    const estados = extraerEstados(body);
    if (estados.length > 0) c.executionCtx.waitUntil(aplicarEstados(c.env, estados));
    return c.text('ok');
  });

  // Dev-only simulator: same pipeline, reply returned instead of sent to Meta.
  app.post('/wa/dev-chat', async c => {
    if (c.env.ENVIRONMENT === 'prod') return c.text('not found', 404);
    const { phone, text } = await c.req.json<{ phone: string; text: string }>();
    if (!phone || !text) return c.json({ error: 'phone and text required' }, 400);
    const viewer = await identityByPhone(c.env, phone);
    if (!viewer) return c.json({ error: 'phone not in identity whitelist' }, 403);
    // Mismo orden que el webhook: router primero, agente después.
    const directo = await atenderComando(c.env, viewer, text, {});
    if (directo) {
      await registrarEntrante(c.env, { telefono: phone, email: viewer.email, tipo: 'dev', texto: text, atendidoPor: directo.atendidoPor, respuesta: directo.respuesta });
      return c.json({ reply: directo.respuesta, atendidoPor: directo.atendidoPor });
    }
    const reply = await handleIncoming(c.env, viewer, phone, text);
    await registrarEntrante(c.env, { telefono: phone, email: viewer.email, tipo: 'dev', texto: text, atendidoPor: 'agente', respuesta: reply });
    return c.json({ reply, atendidoPor: 'agente' });
  });
}
