// worker/assistant/store.ts — D1 persistence for the portal chat bubble:
// conversation history keyed by the authenticated viewer's email (no phone
// concept here — identity already comes from Access + the identity table).
import type { Env } from '../env';
import { HISTORY_TTL_MS, trimHistory } from '../lib/conversationHistory';

/** Load conversation history (Anthropic MessageParam[] as plain JSON). */
export async function loadConversation(env: Env, email: string): Promise<unknown[]> {
  const row = await env.DB.prepare(
    `SELECT messages, updated_at FROM assistant_conversations WHERE email = ?`,
  ).bind(email).first<{ messages: string; updated_at: string }>();
  if (!row) return [];
  if (Date.now() - new Date(row.updated_at).getTime() > HISTORY_TTL_MS) return [];
  try {
    const parsed = JSON.parse(row.messages);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveConversation(env: Env, email: string, messages: unknown[]): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO assistant_conversations (email, messages, updated_at) VALUES (?,?,?)
     ON CONFLICT(email) DO UPDATE SET messages = excluded.messages, updated_at = excluded.updated_at`,
  ).bind(email, JSON.stringify(trimHistory(messages)), now).run();
}

export async function clearConversation(env: Env, email: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM assistant_conversations WHERE email = ?`)
    .bind(email).run();
}
