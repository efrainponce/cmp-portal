// worker/lib/conversationHistory.ts — trim/TTL/compact rules shared by every
// stored Claude conversation (WhatsApp bot, portal chat bubble), so history
// never grows unbounded and never starts mid tool-call.
export const HISTORY_TTL_MS = 24 * 3600_000; // stale conversations restart fresh
const MAX_MESSAGES = 40;                     // hard cap sent to the model
const KEEP_FULL_MESSAGES = 10;               // recent tail kept intacto (tool_results completos)

const COMPACTED_NOTE = '[resultado omitido por antigüedad — vuelve a consultar si lo necesitas]';

interface HistoryBlock { type?: string; content?: unknown; [k: string]: unknown }
interface HistoryMessage { role?: string; content?: unknown }

/** Compacta los tool_result de mensajes viejos (todo salvo los últimos
 * KEEP_FULL_MESSAGES): el JSON de un listado de hace 15 turnos ya no aporta y
 * es el grueso de los tokens re-enviados en cada mensaje. Se conserva la
 * estructura user/tool_result (el pairing tool_use↔tool_result debe quedar
 * intacto o la API rechaza el historial); solo se sustituye el contenido.
 * Muta una COPIA del bloque, nunca el original. */
function compactOldToolResults(messages: unknown[]): unknown[] {
  const cutoff = Math.max(0, messages.length - KEEP_FULL_MESSAGES);
  return messages.map((raw, i) => {
    if (i >= cutoff) return raw;
    const m = raw as HistoryMessage;
    if (m?.role !== 'user' || !Array.isArray(m.content)) return raw;
    let touched = false;
    const content = (m.content as HistoryBlock[]).map(b => {
      if (b?.type !== 'tool_result') return b;
      const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
      if (text === COMPACTED_NOTE || text.length <= 200) return b;
      touched = true;
      return { ...b, content: COMPACTED_NOTE };
    });
    return touched ? { ...m, content } : raw;
  });
}

/** Trim to the last MAX_MESSAGES, cutting on a plain user text turn so the
 * history never starts with an orphan tool_result (API rejects that), then
 * compact stale tool_results. */
export function trimHistory(messages: unknown[]): unknown[] {
  let out = messages;
  if (out.length > MAX_MESSAGES) {
    let start = out.length - MAX_MESSAGES;
    while (start < out.length) {
      const m = out[start] as { role?: string; content?: unknown };
      const isPlainUser = m?.role === 'user' && typeof m.content === 'string';
      if (isPlainUser) break;
      start++;
    }
    out = out.slice(start);
  }
  return compactOldToolResults(out);
}
