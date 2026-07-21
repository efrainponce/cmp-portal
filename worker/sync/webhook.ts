// POST /api/sync/webhook/:token — Monday webhook intake.
import type { Hono } from 'hono';
import type { Env } from '../env';
import { refetchItem } from './refetch';
import { logSync } from './log';

const DEBOUNCE_MS = 10_000;

interface WebhookEvent {
  type?: string;
  boardId?: number | string;
  pulseId?: number | string;
  itemId?: number | string;
  parentItemId?: number | string;
}

export function syncRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/sync/webhook/:token', async (c) => {
    type WebhookBody = { challenge?: string; event?: WebhookEvent };
    const body = await c.req.json<WebhookBody>().catch((): WebhookBody => ({}));

    // Monday's URL-verification handshake — echo verbatim, no token check.
    if (body?.challenge) return c.json({ challenge: body.challenge });

    if (c.req.param('token') !== c.env.WEBHOOK_TOKEN) return c.notFound();

    const event = body?.event ?? {};
    const boardId = Number(event.boardId);
    const itemId = Number(event.pulseId ?? event.itemId);
    const type = String(event.type ?? '');

    if (!boardId || !itemId) return c.json({ ok: true, skipped: true, reason: 'missing boardId/itemId' });

    if (type === 'item_deleted' || type === 'subitem_deleted') {
      await c.env.DB.prepare(`DELETE FROM items WHERE board_id = ? AND item_id = ?`)
        .bind(boardId, itemId).run();
      await logSync(c.env, 'webhook', boardId, itemId, true, `${type} — mirror row deleted`);
      return c.json({ ok: true });
    }

    const existing = await c.env.DB.prepare(
      `SELECT synced_at FROM items WHERE board_id = ? AND item_id = ?`,
    ).bind(boardId, itemId).first<{ synced_at: string }>();

    if (existing && Date.now() - Date.parse(existing.synced_at) < DEBOUNCE_MS) {
      return c.json({ ok: true, debounced: true });
    }

    await refetchItem(c.env, boardId, itemId);
    return c.json({ ok: true });
  });
}
