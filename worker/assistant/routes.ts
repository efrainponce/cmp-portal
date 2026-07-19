// worker/assistant/routes.ts — portal chat bubble endpoints. Registered under
// /api/* so they run behind the access + identity middleware (no separate
// auth needed — same viewer scoping as every other /api/* route). Abierto a
// cualquier identidad activa (vendedor/compras/admin/almacen).
import type { Hono } from 'hono';
import type { Env } from '../env';
import type {
  AssistantChatRequest, AssistantChatResponse, AssistantHistoryResponse,
} from '../../shared/dto';
import { handleChat, loadDisplayHistory, resetChat } from './agent';

export function assistantRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/assistant/messages', async c => {
    const messages = await loadDisplayHistory(c.env, c.get('viewer'));
    return c.json({ messages } satisfies AssistantHistoryResponse);
  });

  app.post('/api/assistant/messages', async c => {
    const body = await c.req.json<AssistantChatRequest>();
    const text = (body.text ?? '').trim();
    if (!text) return c.json({ error: 'text is required' }, 400);
    const reply = await handleChat(c.env, c.get('viewer'), text);
    return c.json({ reply } satisfies AssistantChatResponse);
  });

  app.post('/api/assistant/reset', async c => {
    await resetChat(c.env, c.get('viewer'));
    return c.json({ ok: true });
  });
}
