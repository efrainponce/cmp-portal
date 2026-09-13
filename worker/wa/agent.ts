// worker/wa/agent.ts — canal WhatsApp del agente Claude. El loop real vive en
// worker/lib/agentLoop.ts (compartido con la burbuja del portal); aquí
// queda la persistencia por teléfono, el max_tokens del canal y el CONTEXTO
// del día: la última lista numerada que vio la persona (resumen matutino o
// "cartera"), con item_ids, para que "la 2 sigue viva, piden muestra" se
// resuelva en una sola llamada (plan docs/plan-wa-cartera.md §5). Cambia
// solo cuando cambia la lista, así que el prefijo tools+persona sigue en
// caché.
import type Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { runAgentLoop, RESET_WORDS, RESET_REPLY } from '../lib/agentLoop';
import { etiqueta } from '../lib/cartera';
import { loadConversation, saveConversation, clearConversation } from './store';
import { listaVigente } from './estado';
import { cargarVista } from './comandos';

/** Bloque de system con la lista vigente numerada (null si no hay). */
export async function contextoDeLista(env: Env, viewer: Identity): Promise<string | null> {
  try {
    const lista = await listaVigente(env, viewer.email);
    if (!lista || lista.itemIds.length === 0) return null;
    const vista = await cargarVista(env, viewer);
    const porId = new Map(vista.oportunidades.map(o => [o.item_id, o]));
    const lineas = lista.itemIds.map((id, i) => {
      const o = porId.get(id);
      return o
        ? `${i + 1}. ${etiqueta(o)} (item_id ${o.item_id}) — ${o.etapa}, ${o.diasSinMovimiento} días sin movimiento, siguiente paso: ${o.siguientePaso}`
        : `${i + 1}. (item_id ${id}) — ya no está abierta`;
    });
    return `Última lista que vio ${viewer.nombre ?? viewer.email} (${lista.origen}, ${lista.updatedAt.slice(0, 16)} UTC). Cuando diga "la 2", "la segunda" o "esa", se refiere a esta numeración; usa el item_id:\n${lineas.join('\n')}`;
  } catch {
    return null;
  }
}

/** Process one incoming text message and return the reply to send back. */
export async function handleIncoming(env: Env, viewer: Identity, phone: string, text: string): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) {
    return 'El asistente no está configurado todavía (falta la clave del modelo). Avisa al administrador.';
  }

  if (RESET_WORDS.has(text.trim().toLowerCase())) {
    await clearConversation(env, phone);
    return RESET_REPLY;
  }

  const history = await loadConversation(env, phone) as Anthropic.MessageParam[];
  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: text }];
  const contexto = await contextoDeLista(env, viewer);
  const reply = await runAgentLoop(env, viewer, 'whatsapp', messages, 1024, contexto);
  await saveConversation(env, phone, messages);
  return reply;
}
