// worker/wa/store.ts — D1 persistence for the WhatsApp bot: identity-by-phone,
// conversation history, and webhook dedupe.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';

/** Normalize any phone representation to its last 10 digits (MX national number).
 * WhatsApp sends e.g. "5214771234567"; identity.phone may be stored with or
 * without country code / separators. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.slice(-10);
}

export async function identityByPhone(env: Env, waPhone: string): Promise<Identity | null> {
  const wanted = normalizePhone(waPhone);
  if (wanted.length < 10) return null;
  const res = await env.DB.prepare(
    `SELECT email, phone, nombre, monday_user_id, role, active FROM identity
     WHERE active = 1 AND phone IS NOT NULL`,
  ).all<{ email: string; phone: string; nombre: string | null; monday_user_id: number; role: Identity['role']; active: number }>();
  const row = (res.results ?? []).find(r => normalizePhone(r.phone) === wanted);
  if (!row) return null;
  return {
    email: row.email,
    phone: row.phone,
    nombre: row.nombre ?? undefined,
    monday_user_id: row.monday_user_id,
    role: row.role,
    active: true,
  };
}

/** True when this webhook message id was already handled (Meta retries deliveries). */
export async function alreadyProcessed(env: Env, msgId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    `INSERT INTO wa_processed (msg_id, at) VALUES (?, ?) ON CONFLICT(msg_id) DO NOTHING`,
  ).bind(msgId, now).run();
  // meta.changes === 0 → row existed → duplicate delivery
  if ((res.meta?.changes ?? 1) === 0) return true;
  // opportunistic cleanup of entries older than 7 days
  await env.DB.prepare(`DELETE FROM wa_processed WHERE at < ?`)
    .bind(new Date(Date.now() - 7 * 86400_000).toISOString()).run();
  return false;
}

const HISTORY_TTL_MS = 24 * 3600_000; // stale conversations restart fresh
const MAX_MESSAGES = 40;              // hard cap sent to the model

/** Load conversation history (Anthropic MessageParam[] as plain JSON). */
export async function loadConversation(env: Env, phone: string): Promise<unknown[]> {
  const row = await env.DB.prepare(
    `SELECT messages, updated_at FROM wa_conversations WHERE phone = ?`,
  ).bind(normalizePhone(phone)).first<{ messages: string; updated_at: string }>();
  if (!row) return [];
  if (Date.now() - new Date(row.updated_at).getTime() > HISTORY_TTL_MS) return [];
  try {
    const parsed = JSON.parse(row.messages);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Trim to the last MAX_MESSAGES, cutting on a plain user text turn so the
 * history never starts with an orphan tool_result (API rejects that). */
function trimHistory(messages: unknown[]): unknown[] {
  if (messages.length <= MAX_MESSAGES) return messages;
  let start = messages.length - MAX_MESSAGES;
  while (start < messages.length) {
    const m = messages[start] as { role?: string; content?: unknown };
    const isPlainUser = m?.role === 'user' && typeof m.content === 'string';
    if (isPlainUser) break;
    start++;
  }
  return messages.slice(start);
}

export async function saveConversation(env: Env, phone: string, messages: unknown[]): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO wa_conversations (phone, messages, updated_at) VALUES (?,?,?)
     ON CONFLICT(phone) DO UPDATE SET messages = excluded.messages, updated_at = excluded.updated_at`,
  ).bind(normalizePhone(phone), JSON.stringify(trimHistory(messages)), now).run();
}

export async function clearConversation(env: Env, phone: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM wa_conversations WHERE phone = ?`)
    .bind(normalizePhone(phone)).run();
}
