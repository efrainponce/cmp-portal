// worker/lib/conversationHistory.ts — trim/TTL rules shared by every stored
// Claude conversation (WhatsApp bot, portal chat bubble), so history never
// grows unbounded and never starts mid tool-call.
export const HISTORY_TTL_MS = 24 * 3600_000; // stale conversations restart fresh
const MAX_MESSAGES = 40;                     // hard cap sent to the model

/** Trim to the last MAX_MESSAGES, cutting on a plain user text turn so the
 * history never starts with an orphan tool_result (API rejects that). */
export function trimHistory(messages: unknown[]): unknown[] {
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
