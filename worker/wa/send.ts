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

/** Send a plain text message. WhatsApp caps text bodies at 4096 chars. */
export async function sendText(env: Env, to: string, body: string): Promise<void> {
  await graphPost(env, { to, type: 'text', text: { body: body.slice(0, 4000) } });
}

/** Mark an incoming message as read (blue ticks) — best-effort, never throws. */
export async function markRead(env: Env, messageId: string): Promise<void> {
  try {
    await graphPost(env, { status: 'read', message_id: messageId });
  } catch { /* cosmetic only */ }
}
