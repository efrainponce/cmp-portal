// worker/wa/agent.ts — Claude Haiku agent loop for the WhatsApp bot. Manual
// tool-use loop (not the beta tool runner): history must persist across HTTP
// requests, so each incoming message replays the stored MessageParam[] and the
// loop runs until Claude stops calling tools.
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { TOOLS, runTool } from './tools';
import { loadConversation, saveConversation, clearConversation } from './store';

const MODEL = 'claude-haiku-4-5';
const MAX_TOOL_ITERATIONS = 8;

const RESET_WORDS = new Set(['reiniciar', 'reset', 'cancelar todo', 'borrar']);

function systemPrompt(viewer: Identity): string {
  const today = new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' });
  return `Eres el asistente de CMP por WhatsApp para vendedores en ruta. Ayudas a crear contactos y oportunidades de venta en el CRM (Monday) sin necesidad de abrir la app.

Hoy es ${today}. Hablas con ${viewer.nombre ?? viewer.email} (rol: ${viewer.role}).

Qué puedes hacer:
- Buscar productos del catálogo, contactos e instituciones.
- Crear contactos nuevos.
- Crear oportunidades con líneas de producto. La oportunidad queda en etapa "Nueva oportunidad" con ${viewer.nombre ?? 'el vendedor'} como dueño.

Reglas estrictas:
1. Estilo WhatsApp: mensajes cortos, claros, en español. Una pregunta a la vez. Puedes usar *negritas* y listas simples.
2. NUNCA inventes datos, ids, productos ni resultados. Todo dato viene del vendedor o de una herramienta.
3. Para cada línea de producto: busca primero con buscar_productos. Si hay un match claro, usa su item_id. Si hay varios candidatos, muestra las opciones (nombre + SKU) y pregunta cuál. Si no existe, dilo y pregunta si va fuera de catálogo.
4. Para una oportunidad necesitas mínimo: nombre de la oportunidad y una línea con producto + cantidad. Contacto es opcional pero recomiéndalo: búscalo con buscar_contactos; si no existe, ofrece crearlo primero y luego vincularlo.
5. Antes de crear CUALQUIER cosa, muestra un resumen con todos los datos y espera confirmación explícita ("sí", "confirmo", "dale"). Sin confirmación no llames a crear_contacto ni crear_oportunidad.
6. Después de crear, reporta el resultado real de la herramienta (folio/id y advertencias). Si una herramienta devuelve error, dilo tal cual; jamás digas que algo se creó si la herramienta falló.
7. No compartas costos, márgenes ni información interna. No hagas nada fuera de estas funciones; si te piden otra cosa, di amablemente que solo apoyas con contactos y oportunidades.
8. Fechas en formato YYYY-MM-DD; interpreta expresiones como "en dos semanas" a partir de hoy y confírmalas en el resumen.
9. Si el vendedor escribe "reiniciar", la conversación empieza de cero.`;
}

function finalText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

/** Process one incoming text message and return the reply to send back. */
export async function handleIncoming(env: Env, viewer: Identity, phone: string, text: string): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) {
    return 'El asistente no está configurado todavía (falta la clave del modelo). Avisa al administrador.';
  }

  if (RESET_WORDS.has(text.trim().toLowerCase())) {
    await clearConversation(env, phone);
    return 'Listo, empezamos de cero 👍 ¿En qué te ayudo? Puedo crear contactos y oportunidades.';
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL });
  const history = await loadConversation(env, phone) as Anthropic.MessageParam[];
  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: text }];
  const system = systemPrompt(viewer);

  let reply = '';
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools: TOOLS,
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
      reply = 'No puedo ayudarte con eso. ¿Te apoyo con un contacto o una oportunidad?';
      break;
    }
    reply = finalText(response.content);
    break;
  }

  if (!reply) {
    reply = 'Hice varias consultas pero no llegué a una respuesta clara. ¿Me lo planteas de nuevo, paso a paso?';
  }

  await saveConversation(env, phone, messages);
  return reply;
}
