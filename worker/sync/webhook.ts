// POST /api/sync/webhook/:token — Monday webhook intake.
import type { Hono } from 'hono';
import type { Env } from '../env';
import { refetchItem } from './refetch';
import { logSync } from './log';
import { createOportunidadFolderOnCreate } from '../lib/drive';
import { BOARDS } from '../../shared/boards';

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

    // Fase 5 "salir de Monday" (2026-08-13): item nuevo en Oportunidades ->
    // carpeta de Drive + 12 subcarpetas (reemplaza el escenario 100 de Make +
    // create_subfolders.py de cmp-tallas). Best-effort: un fallo aquí nunca debe
    // tumbar el refetch del mirror de abajo. Gateado por DRIVE_NATIVE — Efraín
    // debe desactivar el escenario 100 de Make antes de encenderla, para no
    // crear carpetas duplicadas.
    if (type === 'create_item' && boardId === BOARDS.oportunidades.id && c.env.DRIVE_NATIVE === '1') {
      try {
        await createOportunidadFolderOnCreate(c.env, itemId);
      } catch (err) {
        await logSync(c.env, 'webhook', boardId, itemId, false, `Fase 5 Drive folder failed: ${String(err)}`);
      }
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
