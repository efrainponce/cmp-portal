// worker/wa/routes.ts — WhatsApp Cloud API webhook. Registered before the
// access/identity middleware (Meta can't present Cloudflare Access creds);
// auth here is Meta's HMAC signature + the phone→identity whitelist (fail closed).
import type { Hono } from 'hono';
import type { Env } from '../env';
import { identityByPhone, alreadyProcessed } from './store';
import { handleIncoming } from './agent';
import { sendText, markRead } from './send';

interface WaMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
}

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

  const viewer = await identityByPhone(env, msg.from);
  if (!viewer) {
    await sendText(env, msg.from, 'Hola 👋 Este asistente es solo para el equipo de CMP. Si eres vendedor, pide al administrador que dé de alta tu número.');
    return;
  }

  await markRead(env, msg.id);

  if (msg.type !== 'text' || !msg.text?.body) {
    await sendText(env, msg.from, 'Por ahora solo puedo leer mensajes de texto 🙏');
    return;
  }

  try {
    const reply = await handleIncoming(env, viewer, msg.from, msg.text.body);
    await sendText(env, msg.from, reply);
  } catch (err) {
    console.error('wa agent error', err);
    await sendText(env, msg.from, 'Ocurrió un error procesando tu mensaje 😕 Intenta de nuevo en un momento.');
  }
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
    return c.text('ok');
  });

  // Dev-only simulator: same pipeline, reply returned instead of sent to Meta.
  app.post('/wa/dev-chat', async c => {
    if (c.env.ENVIRONMENT === 'prod') return c.text('not found', 404);
    const { phone, text } = await c.req.json<{ phone: string; text: string }>();
    if (!phone || !text) return c.json({ error: 'phone and text required' }, 400);
    const viewer = await identityByPhone(c.env, phone);
    if (!viewer) return c.json({ error: 'phone not in identity whitelist' }, 403);
    const reply = await handleIncoming(c.env, viewer, phone, text);
    return c.json({ reply });
  });
}
