// worker/wa/send.ts — WhatsApp Cloud API (Meta Graph) outbound helpers.
import type { Env } from '../env';

const GRAPH = 'https://graph.facebook.com/v20.0';

async function graphPost(env: Env, body: Record<string, unknown>): Promise<void> {
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
}

// Meta's Cloud API reports MX inbound numbers with a legacy "1" after the
// country code (5215512345678), but sending to that exact string 400s with
// #131030 "not in allowed list" — the allow-list (and real delivery) only
// recognizes the number without it (525512345678). Strip it before sending.
function normalizeMxTo(to: string): string {
  return /^521\d{10}$/.test(to) ? `52${to.slice(3)}` : to;
}

/** Send a plain text message. WhatsApp caps text bodies at 4096 chars. */
export async function sendText(env: Env, to: string, body: string): Promise<void> {
  await graphPost(env, { to: normalizeMxTo(to), type: 'text', text: { body: body.slice(0, 4000) } });
}

/** Mark an incoming message as read (blue ticks) — best-effort, never throws. */
export async function markRead(env: Env, messageId: string): Promise<void> {
  try {
    await graphPost(env, { status: 'read', message_id: messageId });
  } catch { /* cosmetic only */ }
}
