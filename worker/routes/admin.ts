// Admin-only: manage who can log in (phone, role, active) and pull the Monday
// user directory to import phones/teams instead of retyping them. Movido tal
// cual desde worker/index.ts (2026-07-16) — sin cambios de comportamiento.
import type { Hono } from 'hono';
import type { Env } from '../env';
import type { Role } from '../../shared/types';
import type { IdentityDTO, MondayUserDTO, BoardAccessDTO, ZonaDTO } from '../../shared/dto';
import { TEAM_ROLES } from '../../shared/boardAccess';
import { listIdentities, upsertIdentity } from '../lib/dal';
import { cachedFetchUsers } from '../lib/rosterCache';
import { listAllBoardAccess, setBoardAccess, BoardAccessError } from '../lib/boardAccess';
import { listZonas, createZona, updateZona, deleteZona, ZonaError } from '../lib/zonas';

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
    const validRoles = ['vendedor', 'compras', 'admin', 'almacen'];
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

  app.get('/api/admin/board-access', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const dto: BoardAccessDTO = await listAllBoardAccess(c.env);
    return c.json(dto);
  });

  app.put('/api/admin/board-access/:role', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const role = c.req.param('role') as Role;
    if (!TEAM_ROLES.includes(role)) return c.json({ error: 'role no editable' }, 400);
    const body = await c.req.json<{ boardKeys: string[] }>();
    if (!Array.isArray(body.boardKeys)) return c.json({ error: 'boardKeys is required' }, 400);
    try {
      await setBoardAccess(c.env, role, body.boardKeys);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof BoardAccessError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // Zonas de ventas (worker/lib/zonas.ts): el líder LEE lo de sus miembros. A
  // diferencia de board-access, esto sí es protección de datos — por eso el DAL
  // valida contra el roster y el write path nunca mira la zona.
  app.get('/api/admin/zonas', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const dto: ZonaDTO[] = await listZonas(c.env);
    return c.json(dto);
  });

  app.post('/api/admin/zonas', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const body = await c.req.json<{ nombre?: string }>();
    try {
      return c.json(await createZona(c.env, body.nombre ?? ''));
    } catch (err) {
      if (err instanceof ZonaError) return c.json({ error: err.message }, err.status as 400);
      throw err;
    }
  });

  // Reemplaza el estado completo de la zona (mismo criterio que board-access:
  // el cliente manda el conjunto final, no un diff).
  app.put('/api/admin/zonas/:id', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'not found' }, 404);
    const body = await c.req.json<Partial<Pick<ZonaDTO, 'nombre' | 'liderEmail' | 'miembros'>>>();
    if (body.miembros !== undefined && !Array.isArray(body.miembros)) {
      return c.json({ error: 'miembros debe ser una lista' }, 400);
    }
    try {
      await updateZona(c.env, id, body);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof ZonaError) return c.json({ error: err.message }, err.status as 400);
      throw err;
    }
  });

  app.delete('/api/admin/zonas/:id', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'not found' }, 404);
    await deleteZona(c.env, id);
    return c.json({ ok: true });
  });
}
