// Admin-only: manage who can log in (phone, role, active) and pull the Monday
// user directory to import phones/teams instead of retyping them. Movido tal
// cual desde worker/index.ts (2026-07-16) — sin cambios de comportamiento.
import type { Hono } from 'hono';
import type { Env } from '../env';
import type { IdentityDTO, MondayUserDTO } from '../../shared/dto';
import { listIdentities, upsertIdentity } from '../lib/dal';
import { cachedFetchUsers } from '../lib/rosterCache';

export function adminRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/admin/identities', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const rows = await listIdentities(c.env);
    const dto: IdentityDTO[] = rows.map(r => ({
      email: r.email, phone: r.phone ?? null, nombre: r.nombre ?? null,
      mondayUserId: r.monday_user_id, role: r.role, active: !!r.active,
    }));
    return c.json(dto);
  });

  app.put('/api/admin/identities/:email', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const email = decodeURIComponent(c.req.param('email'));
    const body = await c.req.json<Partial<IdentityDTO>>();
    if (!email.trim()) return c.json({ error: 'email is required' }, 400);
    const role = body.role ?? 'vendedor';
    const validRoles = ['vendedor', 'compras', 'admin', 'cliente'];
    if (!validRoles.includes(role)) return c.json({ error: 'invalid role' }, 400);
    if (!Number.isFinite(body.mondayUserId)) return c.json({ error: 'mondayUserId is required' }, 400);

    await upsertIdentity(c.env, {
      email,
      phone: body.phone?.trim() || null,
      nombre: body.nombre?.trim() || null,
      monday_user_id: body.mondayUserId as number,
      role,
      active: body.active === false ? 0 : 1,
    });
    return c.json({ ok: true });
  });

  app.get('/api/admin/monday-users', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    try {
      // TTL corto: el admin importa teléfonos/equipos y espera datos recientes.
      const users = await cachedFetchUsers(c.env, 10 * 60_000);
      const dto: MondayUserDTO[] = users.map(u => ({
        id: Number(u.id), nombre: u.name, email: u.email, phone: u.phone ?? null,
        teams: (u.teams ?? []).map(t => t.name),
      }));
      return c.json(dto);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return c.json({ error: `monday fetch failed: ${detail}` }, 502);
    }
  });
}
