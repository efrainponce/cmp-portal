// Centro de notificaciones del portal — API de lectura/estado sobre la tabla
// `notifications` (worker/lib/notify.ts es el único emisor). Todo scoped al
// viewer autenticado (recipient_email); no hay vista de "todas las notificaciones".
import type { Hono } from 'hono';
import type { Env } from '../env';
import type { NotificationDTO, NotificationsResponse } from '../../shared/dto';
import { md5 } from '../lib/canon';
import { etagCoincide } from '../lib/http';

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
  link?: string | null;         // columna agregada 2026-09-25
  dedupe_key: string;
  read_at: string | null;
  created_at: string;
  item_name?: string | null;    // del JOIN con items (nombre de la oportunidad/proyecto)
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
    itemName: row.item_name ?? null,
    link: row.link ?? null,
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

    // 120 y con el nombre del item: la campana las AGRUPA por oportunidad
    // (2026-10-01 — en 7 días salieron 659 avisos sobre 298 oportunidades, y
    // solo se leyó el 7%: una persona tenía 31 "Nuevo comentario" del mismo
    // OPP, uno debajo del otro). Con 50 sueltas no alcanzaba ni para un día.
    const base = `SELECT n.*, i.name AS item_name FROM notifications n
                    LEFT JOIN items i ON i.board_id = n.board_id AND i.item_id = n.item_id
                   WHERE n.recipient_email = ?`;
    const query = validFilter
      ? `${base} AND n.severity = ? ORDER BY n.id DESC LIMIT 120`
      : `${base} ORDER BY n.id DESC LIMIT 120`;
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
    if (etagCoincide(c.req.header('If-None-Match'), etag)) return c.body(null, 304, { ETag: etag });
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

  // Marcar como leído TODO lo de un item (oportunidad/proyecto) de una bandeja:
  // es lo que hace el clic sobre un grupo de la campana. `itemId` va en el body.
  app.post('/api/notifications/read-item', async c => {
    const viewer = c.get('viewer');
    const body = await c.req.json<{ itemId?: unknown; severity?: unknown }>().catch(() => null);
    const itemId = Number(body?.itemId);
    if (!body || !Number.isSafeInteger(itemId) || itemId <= 0) return c.json({ error: 'itemId inválido' }, 400);
    const severity = body.severity === 'importante' || body.severity === 'actualizacion' ? body.severity : undefined;
    const sql = `UPDATE notifications SET read_at = ? WHERE recipient_email = ? AND item_id = ? AND read_at IS NULL`
      + (severity ? ' AND severity = ?' : '');
    const binds = [new Date().toISOString(), viewer.email, itemId, ...(severity ? [severity] : [])];
    await c.env.DB.prepare(sql).bind(...binds).run();
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
