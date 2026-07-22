// Centro de notificaciones del portal — API de lectura/estado sobre la tabla
// `notifications` (worker/lib/notify.ts es el único emisor). Todo scoped al
// viewer autenticado (recipient_email); no hay vista de "todas las notificaciones".
import type { Hono } from 'hono';
import type { Env } from '../env';
import type { NotificationDTO, NotificationsResponse } from '../../shared/dto';
import { md5 } from '../lib/canon';

type Severity = 'importante' | 'actualizacion';

interface NotificationRow {
  id: number;
  recipient_email: string;
  severity: Severity;
  kind: string;
  title: string;
  body: string | null;
  board_key: string | null;
  board_id: number | null;
  item_id: number | null;
  actor: string | null;
  dedupe_key: string;
  read_at: string | null;
  created_at: string;
}

function toDTO(row: NotificationRow): NotificationDTO {
  return {
    id: row.id,
    severity: row.severity,
    kind: row.kind,
    title: row.title,
    body: row.body ?? null,
    boardKey: row.board_key ?? null,
    itemId: row.item_id != null ? String(row.item_id) : null,
    actor: row.actor ?? null,
    read: row.read_at != null,
    createdAt: row.created_at,
  };
}

export function notificationRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/notifications', async c => {
    const viewer = c.get('viewer');
    const filter = c.req.query('filter');
    const validFilter = filter === 'importante' || filter === 'actualizacion' ? filter : undefined;

    const query = validFilter
      ? `SELECT * FROM notifications WHERE recipient_email = ? AND severity = ? ORDER BY id DESC LIMIT 50`
      : `SELECT * FROM notifications WHERE recipient_email = ? ORDER BY id DESC LIMIT 50`;
    const binds = validFilter ? [viewer.email, validFilter] : [viewer.email];
    const { results } = await c.env.DB.prepare(query).bind(...binds).all<NotificationRow>();
    const rows = results ?? [];

    // Conteo de no leídas SIEMPRE por ambas bandejas, sin importar el filtro —
    // los badges del centro de notificaciones necesitan los dos números a la vez.
    const { results: unreadRows } = await c.env.DB.prepare(
      `SELECT severity, COUNT(*) as n FROM notifications WHERE recipient_email = ? AND read_at IS NULL GROUP BY severity`,
    ).bind(viewer.email).all<{ severity: Severity; n: number }>();
    const unread = { importante: 0, actualizacion: 0 };
    for (const r of unreadRows ?? []) unread[r.severity] = r.n;

    const notifications = rows.map(toDTO);
    const response: NotificationsResponse = { notifications, unread };

    const maxId = notifications[0]?.id ?? 0;
    const etag = '"' + md5(`${maxId}:${unread.importante}:${unread.actualizacion}:${validFilter ?? 'all'}`) + '"';
    if (c.req.header('If-None-Match') === etag) return c.body(null, 304, { ETag: etag });
    c.header('ETag', etag);
    return c.json(response);
  });

  app.post('/api/notifications/:id/read', async c => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'not found' }, 404);
    const viewer = c.get('viewer');

    await c.env.DB.prepare(
      `UPDATE notifications SET read_at = ? WHERE id = ? AND recipient_email = ? AND read_at IS NULL`,
    ).bind(new Date().toISOString(), id, viewer.email).run();
    return c.json({ ok: true });
  });

  app.post('/api/notifications/read-all', async c => {
    const viewer = c.get('viewer');
    const filter = c.req.query('filter');
    const validFilter = filter === 'importante' || filter === 'actualizacion' ? filter : undefined;

    const query = validFilter
      ? `UPDATE notifications SET read_at = ? WHERE recipient_email = ? AND read_at IS NULL AND severity = ?`
      : `UPDATE notifications SET read_at = ? WHERE recipient_email = ? AND read_at IS NULL`;
    const binds = validFilter ? [new Date().toISOString(), viewer.email, validFilter] : [new Date().toISOString(), viewer.email];
    await c.env.DB.prepare(query).bind(...binds).run();
    return c.json({ ok: true });
  });
}
