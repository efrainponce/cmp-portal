// worker/wa/agent.ts — canal WhatsApp del agente Claude. El loop real vive en
// worker/lib/agentLoop.ts (compartido con la burbuja del portal); aquí solo
// queda la persistencia por teléfono y el max_tokens del canal.
import type Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { runAgentLoop, RESET_WORDS, RESET_REPLY } from '../lib/agentLoop';
import { loadConversation, saveConversation, clearConversation } from './store';

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
  const reply = await runAgentLoop(env, viewer, 'whatsapp', messages, 1024);
  await saveConversation(env, phone, messages);
  return reply;
}
