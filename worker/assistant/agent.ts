// worker/assistant/agent.ts — Claude agent loop for the portal chat bubble.
// Same manual tool-use loop as the WhatsApp bot (worker/wa/agent.ts): history
// persists across HTTP requests, so each message replays the stored
// MessageParam[] and the loop runs until Claude stops calling tools.
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { toolsFor, runTool } from '../lib/assistantTools';
import { systemPromptFor } from '../lib/assistantPersonas';
import { loadConversation, saveConversation, clearConversation } from './store';

// Todos los canales corren Haiku 4.5 por decisión de Efraín (2026-07-15):
// costo/latencia mandan; nada de Opus/Sonnet.
const MODEL = 'claude-haiku-4-5';
const MAX_TOOL_ITERATIONS = 8;

const RESET_WORDS = new Set(['reiniciar', 'reset', 'cancelar todo', 'borrar']);

function finalText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

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
    return 'Listo, empezamos de cero 👍 ¿En qué te ayudo?';
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL });
  const history = await loadConversation(env, viewer.email) as Anthropic.MessageParam[];
  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: text }];
  const system = systemPromptFor(viewer, 'portal');
  const tools = toolsFor(viewer.role);

  let reply = '';
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
      tools,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const { content, isError } = await runTool(env, viewer, tu.name, tu.input as Record<string, unknown>);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content, is_error: isError });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }

    if (response.stop_reason === 'max_tokens') {
      reply = finalText(response.content) || 'Me quedé a medias, ¿me repites lo último?';
      break;
    }
    if (response.stop_reason === 'refusal') {
      reply = 'No puedo ayudarte con eso. ¿Te apoyo con otra consulta del CRM?';
      break;
    }
    reply = finalText(response.content);
    break;
  }

  if (!reply) {
    reply = 'Hice varias consultas pero no llegué a una respuesta clara. ¿Me lo planteas de nuevo, paso a paso?';
  }

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
