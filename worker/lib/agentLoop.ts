// worker/lib/agentLoop.ts — EL loop de agente Claude, compartido por ambos
// canales (WhatsApp: worker/wa/agent.ts, burbuja del portal:
// worker/assistant/agent.ts). Antes cada canal tenía su copia idéntica del
// loop manual de tool-use; ahora solo difieren en persistencia (store por
// teléfono vs por email) y en max_tokens/persona por canal.
//
// PROMPT CACHING (2026-07-16, corte de costos): dos breakpoints ephemeral —
// (1) en el último bloque de system: cachea tools+system juntos (el orden de
//     render de la API es tools → system → messages);
// (2) top-level cache_control: auto-cachea el prefijo completo hasta el último
//     bloque del request. Dentro de un mismo mensaje el loop de tools replaya
//     el historial completo en cada iteración — con esto las iteraciones 2..N
//     leen el prefijo a ~0.1× del precio en vez de reprocesarlo entero.
// El system prompt es estable por usuario+día (today() cambia a medianoche) y
// la lista de tools es determinista por rol — no hay invalidadores silenciosos.
// Ojo: Haiku 4.5 no cachea prefijos < 4096 tokens (falla en silencio, sin
// error); las primeras vueltas de una conversación corta pueden no cachear y
// eso es esperado.
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { toolsFor, runTool } from './assistantTools';
import { systemPromptFor, type Channel } from './assistantPersonas';

// Todos los canales corren Haiku 4.5 por decisión de Efraín (2026-07-15):
// costo/latencia mandan; nada de Opus/Sonnet.
const MODEL = 'claude-haiku-4-5';
const MAX_TOOL_ITERATIONS = 8;

export const RESET_WORDS = new Set(['reiniciar', 'reset', 'cancelar todo', 'borrar']);
export const RESET_REPLY = 'Listo, empezamos de cero 👍 ¿En qué te ayudo?';

export function finalText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

/** Corre el loop completo para un mensaje entrante sobre el historial dado.
 * Muta `messages` in place (el caller lo persiste) y regresa el texto de
 * respuesta para el usuario. */
export async function runAgentLoop(
  env: Env,
  viewer: Identity,
  channel: Channel,
  messages: Anthropic.MessageParam[],
  maxTokens: number,
): Promise<string> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL });
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemPromptFor(viewer, channel), cache_control: { type: 'ephemeral' } },
  ];
  const tools = toolsFor(viewer.role);

  let reply = '';
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      tools,
      messages,
      cache_control: { type: 'ephemeral' },
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
  return reply;
}
