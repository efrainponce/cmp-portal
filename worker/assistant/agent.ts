// worker/assistant/agent.ts — canal "burbuja de chat" del portal. El loop real
// vive en worker/lib/agentLoop.ts (compartido con el bot de WhatsApp); aquí
// queda la persistencia por email y la proyección del historial para la UI.
import type Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { runAgentLoop, finalText, RESET_WORDS, RESET_REPLY } from '../lib/agentLoop';
import { loadConversation, saveConversation, clearConversation } from './store';

export interface ChatMessage { role: 'user' | 'assistant'; text: string }

/** Reduce the stored MessageParam[] to what the chat UI should render: the
 * user's own plain-text turns and the assistant's text replies — tool_use /
 * tool_result blocks are internal, never shown. */
export function toDisplayMessages(messages: unknown[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const raw of messages) {
    const m = raw as Anthropic.MessageParam;
    if (m.role === 'user' && typeof m.content === 'string') {
      out.push({ role: 'user', text: m.content });
    } else if (m.role === 'assistant' && Array.isArray(m.content)) {
      const text = finalText(m.content as Anthropic.ContentBlock[]);
      if (text) out.push({ role: 'assistant', text });
    }
  }
  return out;
}

/** Process one incoming chat message and return the reply to show. */
export async function handleChat(env: Env, viewer: Identity, text: string): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) {
    return 'El asistente no está configurado todavía (falta la clave del modelo). Avisa al administrador.';
  }

  if (RESET_WORDS.has(text.trim().toLowerCase())) {
    await clearConversation(env, viewer.email);
    return RESET_REPLY;
  }

  const history = await loadConversation(env, viewer.email) as Anthropic.MessageParam[];
  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: text }];
  const reply = await runAgentLoop(env, viewer, 'portal', messages, 2048);
  await saveConversation(env, viewer.email, messages);
  return reply;
}

/** Conversation history for the chat panel to restore on mount/reopen. */
export async function loadDisplayHistory(env: Env, viewer: Identity): Promise<ChatMessage[]> {
  const history = await loadConversation(env, viewer.email);
  return toDisplayMessages(history);
}

export async function resetChat(env: Env, viewer: Identity): Promise<void> {
  await clearConversation(env, viewer.email);
}
