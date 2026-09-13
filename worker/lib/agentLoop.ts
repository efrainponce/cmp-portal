// worker/lib/agentLoop.ts — EL loop de agente Claude, compartido por ambos
// canales (WhatsApp: worker/wa/agent.ts, burbuja del portal:
// worker/assistant/agent.ts). Antes cada canal tenía su copia idéntica del
// loop manual de tool-use; ahora solo difieren en persistencia (store por
// teléfono vs por email) y en max_tokens/persona por canal.
//
// PROMPT CACHING (2026-07-16, corte de costos): dos breakpoints ephemeral —
// (1) en el bloque de la persona del system: cachea tools+persona juntos (el
//     orden de render de la API es tools → system → messages);
// (2) top-level cache_control: auto-cachea el prefijo completo hasta el último
//     bloque del request. Dentro de un mismo mensaje el loop de tools replaya
//     el historial completo en cada iteración — con esto las iteraciones 2..N
//     leen el prefijo a ~0.1× del precio en vez de reprocesarlo entero.
// El system prompt es estable por usuario+día (today() cambia a medianoche) y
// la lista de tools es determinista por rol — no hay invalidadores silenciosos.
// Ojo: Haiku 4.5 no cachea prefijos < 4096 tokens (falla en silencio, sin
// error); las primeras vueltas de una conversación corta pueden no cachear y
// eso es esperado.
//
// RESPUESTA DIRECTA (Efraín, 2026-09-12: "que sea barato para Haiku"): las
// tools de DIRECT_REPLY_TOOLS devuelven texto YA formateado para la persona
// (lo arma el código, worker/lib/cartera.ts). Si el modelo llamó exactamente
// una de ellas, ese texto se manda tal cual y NO se vuelve a llamar al modelo:
// se ahorra la segunda llamada, la cara (es la que genera texto). Al historial
// se le anexa un turno assistant con ese texto para que la conversación siga
// bien formada (user → assistant → user…).
//
// BITÁCORA (2026-09-12): cada llamada (tokens, costo) y cada tool (input,
// resultado resumidos) quedan en `agente_evento` (worker/wa/bitacora.ts).
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { toolsFor, runTool, DIRECT_REPLY_TOOLS } from './assistantTools';
import { systemPromptFor, type Channel } from './assistantPersonas';
import { registrarAgenteEvento } from '../wa/bitacora';

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
 * respuesta para el usuario. `contexto` es un bloque extra de system (p. ej.
 * el resumen matutino del día, numerado) — va DESPUÉS del breakpoint de caché
 * de la persona, así que no invalida el prefijo tools+persona. */
export async function runAgentLoop(
  env: Env,
  viewer: Identity,
  channel: Channel,
  messages: Anthropic.MessageParam[],
  maxTokens: number,
  contexto?: string | null,
): Promise<string> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL });
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemPromptFor(viewer, channel), cache_control: { type: 'ephemeral' } },
  ];
  if (contexto) system.push({ type: 'text', text: contexto });
  const tools = toolsFor(viewer);

  let reply = '';
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const t0 = Date.now();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      tools,
      messages,
      cache_control: { type: 'ephemeral' },
    });
    await registrarAgenteEvento(env, {
      canal: channel, email: viewer.email, tipo: 'llamada', modelo: MODEL, uso: response.usage, ms: Date.now() - t0,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const results: Anthropic.ToolResultBlockParam[] = [];
      let directa: string | null = null;
      for (const tu of toolUses) {
        const t1 = Date.now();
        const { content, isError } = await runTool(env, viewer, tu.name, tu.input as Record<string, unknown>);
        await registrarAgenteEvento(env, {
          canal: channel, email: viewer.email, tipo: 'tool', tool: tu.name, input: tu.input, resultado: content, isError, ms: Date.now() - t1,
        });
        results.push({ type: 'tool_result', tool_use_id: tu.id, content, is_error: isError });
        if (toolUses.length === 1 && !isError && DIRECT_REPLY_TOOLS.has(tu.name)) directa = content;
      }
      messages.push({ role: 'user', content: results });
      if (directa) {
        messages.push({ role: 'assistant', content: [{ type: 'text', text: directa }] });
        reply = directa;
        break;
      }
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
