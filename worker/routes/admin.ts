// Admin-only: manage who can log in (phone, role, active) and pull the Monday
// user directory to import phones/teams instead of retyping them. Movido tal
// cual desde worker/index.ts (2026-07-16) — sin cambios de comportamiento.
import type { Hono } from 'hono';
import type { Env } from '../env';
import type { Role } from '../../shared/types';
import type { IdentityDTO, MondayUserDTO, BoardAccessDTO, ZonaDTO } from '../../shared/dto';
import { TEAM_ROLES } from '../../shared/boardAccess';
import { BOARDS, type BoardSlug } from '../../shared/boards';
import { listIdentities, getIdentityByEmail, upsertIdentity, createNativeIdentity, mondayUserIdExists } from '../lib/dal';
import { cachedFetchUsers } from '../lib/rosterCache';
import { listAllBoardAccess, setBoardAccess, BoardAccessError } from '../lib/boardAccess';
import {
  listZonas, createZona, updateZona, deleteZona, ZonaError,
  zonaPrivadaMemberIds, isZonaPrivadaAdminPermitido,
} from '../lib/zonas';
import { reconcileBoard } from '../sync/reconcile';
import { backupD1ToR2 } from '../lib/backup';
import { buildAnalyticsResponse } from '../lib/analytics';
import { ACCION_RETENTION_DAYS } from '../lib/accionLog';
import { rejectUnknownQuery } from '../lib/http';
import type { GroupBy } from '../../shared/analytics';

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

  // Alta de usuario sin pasar por Monday (pedido de Efraín, 2026-08-06): a
  // diferencia del PUT de abajo, esto SIEMPRE crea una fila nueva — 409 si el
  // email ya existe. Sin mondayUserId, dal.createNativeIdentity le asigna uno
  // sintético negativo (ver ese comentario para el porqué). Con mondayUserId
  // ("Actuar en Monday como", mismo día: un vendedor real necesitaba poder
  // crear oportunidades antes de tener cuenta propia en Monday), se valida
  // que sea de alguien que ya está en el roster — no cualquier id a mano.
  app.post('/api/admin/identities', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const body = await c.req.json<{ email?: string; nombre?: string; phone?: string | null; role?: string; active?: boolean; mondayUserId?: number }>();
    const email = body.email?.trim() ?? '';
    const nombre = body.nombre?.trim() ?? '';
    if (!/^\S+@\S+\.\S+$/.test(email)) return c.json({ error: 'correo inválido' }, 400);
    if (!nombre) return c.json({ error: 'nombre is required' }, 400);
    const validRoles = ['vendedor', 'compras', 'admin', 'almacen'];
    const role = body.role ?? 'vendedor';
    if (!validRoles.includes(role)) return c.json({ error: 'invalid role' }, 400);
    if (await getIdentityByEmail(c.env, email)) return c.json({ error: 'ya existe un usuario con ese correo' }, 409);
    if (body.mondayUserId !== undefined) {
      if (!Number.isFinite(body.mondayUserId) || body.mondayUserId <= 0) return c.json({ error: 'mondayUserId inválido' }, 400);
      if (!(await mondayUserIdExists(c.env, body.mondayUserId))) return c.json({ error: 'ese mondayUserId no existe en el roster' }, 400);
      const prestado = await idPrestadoBloqueado(c.env, body.mondayUserId);
      if (prestado) return c.json({ error: prestado }, 400);
    }

    const row = await createNativeIdentity(c.env, {
      email, nombre, phone: body.phone?.trim() || null, role, active: body.active === false ? 0 : 1,
      mondayUserId: body.mondayUserId,
    });
    const dto: IdentityDTO = {
      email: row.email, phone: row.phone ?? null, nombre: row.nombre ?? null,
      mondayUserId: row.monday_user_id, role: row.role, active: row.active,
    };
    return c.json(dto, 201);
  });

  // Merge parcial contra la fila existente: la tabla "Usuarios del portal" edita
  // SOLO el teléfono de una fila ya importada (IdentityRow.save en SettingsPage)
  // sin volver a mandar mondayUserId/role/active — si esto tratara el body como
  // el registro completo, cada guardado de teléfono lo borraría todo o fallaba
  // por "mondayUserId is required" (bug real, encontrado 2026-07-31). Solo la
  // importación desde Monday (MondayUserRow) crea una fila nueva, y esa sí manda
  // el patch completo.
  app.put('/api/admin/identities/:email', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const email = decodeURIComponent(c.req.param('email'));
    if (!email.trim()) return c.json({ error: 'email is required' }, 400);
    const body = await c.req.json<Partial<IdentityDTO>>();
    const existing = await getIdentityByEmail(c.env, email);

    const role = body.role ?? existing?.role ?? 'vendedor';
    const validRoles = ['vendedor', 'compras', 'admin', 'almacen'];
    if (!validRoles.includes(role)) return c.json({ error: 'invalid role' }, 400);
    const mondayUserId = body.mondayUserId ?? existing?.monday_user_id;
    if (!Number.isFinite(mondayUserId)) return c.json({ error: 'mondayUserId is required' }, 400);
    if (body.mondayUserId !== undefined && body.mondayUserId !== existing?.monday_user_id) {
      const prestado = await idPrestadoBloqueado(c.env, body.mondayUserId);
      if (prestado) return c.json({ error: prestado }, 400);
    }

    await upsertIdentity(c.env, {
      email,
      phone: body.phone !== undefined ? (body.phone?.trim() || null) : (existing?.phone ?? null),
      nombre: body.nombre !== undefined ? (body.nombre?.trim() || null) : (existing?.nombre ?? null),
      monday_user_id: mondayUserId as number,
      role,
      // `Identity.active` está tipado boolean pero la columna guarda 0/1, y
      // upsertIdentity pide number — se convierte explícito. Mismo resultado
      // que antes: sin fila previa el default es activo (1).
      active: body.active !== undefined ? (body.active === false ? 0 : 1) : (existing ? (existing.active ? 1 : 0) : 1),
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

  // Contador real de calls a Monday por día (worker/lib/monday.ts gql()) — antes
  // de esto, "¿nos comemos el tope diario del plan?" solo se podía estimar
  // (Efraín, 2026-08-11, a raíz del fix de reconcile+delta sync).
  app.get('/api/admin/monday-usage', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const rows = await c.env.DB.prepare(
      `SELECT day, count FROM monday_api_usage ORDER BY day DESC LIMIT 14`,
    ).all<{ day: string; count: number }>().catch(() => ({ results: [] as { day: string; count: number }[] }));
    return c.json(rows.results ?? []);
  });

  // Fuerza un full-sync de un board contra Monday sin esperar al cron (cada 12h,
  // worker/index.ts). Existía la función (reconcileBoard) pero ningún trigger
  // manual — encontrado 2026-08-04 al diagnosticar el board Proveedores vacío.
  app.post('/api/admin/sync/:slug', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const slug = c.req.param('slug') as BoardSlug;
    if (!(slug in BOARDS)) return c.json({ error: 'board desconocido' }, 400);
    try {
      const result = await reconcileBoard(c.env, slug);
      return c.json({ ok: true, ...result });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return c.json({ error: `sync failed: ${detail}` }, 502);
    }
  });

  // Dispara el respaldo de D1 a R2 sin esperar al cron. El respaldo llevaba
  // desde el 2026-08-15 fallando en silencio (`access to _cf_KV.key is
  // prohibited`) y NADIE se enteraba: el cron es semanal, el error solo se
  // asentaba en sync_log y no había forma de probarlo sin esperar al sábado.
  // Encontrado 2026-08-19 revisando qué red de seguridad tiene D1 — la
  // respuesta era "solo Time Travel", porque en R2 no había un solo archivo.
  // Devuelve la llave escrita y su tamaño para poder verificar de inmediato.
  app.post('/api/admin/backup', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    await backupD1ToR2(c.env);
    const row = await c.env.DB.prepare(
      "SELECT ok, detail, at FROM sync_log WHERE kind = 'backup' ORDER BY at DESC LIMIT 1",
    ).first<{ ok: number; detail: string; at: string }>();
    if (!row?.ok) return c.json({ ok: false, error: row?.detail ?? 'sin registro' }, 500);
    const obj = await c.env.FILES.head(row.detail);
    return c.json({ ok: true, key: row.detail, bytes: obj?.size ?? null, at: row.at });
  });

  // Tablero de Análisis (Efraín, 2026-08-17): embudo de conversión, tiempo de
  // costeo y montos, cortados por Zona o Vendedor. Todo se calcula sobre D1 —
  // ni una llamada a Monday, ver worker/lib/analytics.ts.
  //
  // El gate de admin es el de siempre, pero además la consulta pasa por
  // scopeFor(): un admin fuera de la whitelist de la Zona privada "Efrain"
  // tampoco la ve aquí, ni sumada dentro de un total.
  app.get('/api/admin/analytics', async c => {
    const viewer = c.get('viewer');
    if (viewer.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

    const por = c.req.query('por') === 'vendedor' ? 'vendedor' : 'zona';
    // `dias` es la forma cómoda (el selector de la UI manda 30/90/180); `desde`
    // y `hasta` explícitos ganan si vienen, para poder pedir un mes cerrado.
    const dias = Number(c.req.query('dias'));
    let desde = c.req.query('desde') ?? null;
    if (!desde && Number.isFinite(dias) && dias > 0) {
      desde = new Date(Date.now() - dias * 86_400_000).toISOString();
    }
    const hasta = c.req.query('hasta') ?? null;

    const response = await buildAnalyticsResponse(c.env, viewer, {
      por: por as GroupBy, desde, hasta,
    });
    return c.json(response);
  });

  // Bitácora de intentos de escritura (worker/lib/accionLog.ts). Existe para
  // contestar "¿qué hizo fulano esa tarde y qué le contestó el portal?" con UNA
  // consulta: el 2026-08-20 esa pregunta —"el CEO validó precios y no llegó a
  // Monday"— costó media hora de cruzar outbox, sync_log, activity_log,
  // ux_event y los logs del Worker, porque ninguna de las cinco guarda los
  // intentos RECHAZADOS.
  //
  // Filtros: `email` (quien actuó), `ruta` (subcadena — sirve para pasarle el
  // id de una oportunidad y ver todo lo que se intentó sobre ella), `dias`
  // (default 7) y `solo=errores`. Query desconocida = 400 (nunca degradar a
  // "sin filtro", ver rejectUnknownQuery).
  app.get('/api/admin/acciones', async c => {
    if (c.get('viewer').role !== 'admin') return c.json({ error: 'forbidden' }, 403);
    const queryMala = rejectUnknownQuery(c.req.url, ['email', 'ruta', 'dias', 'solo', 'limite']);
    if (queryMala) return queryMala;

    const dias = Math.min(Math.max(Number(c.req.query('dias')) || 7, 1), ACCION_RETENTION_DAYS);
    const limite = Math.min(Math.max(Number(c.req.query('limite')) || 200, 1), 1000);
    const desde = new Date(Date.now() - dias * 86_400_000).toISOString();

    const where = ['at >= ?'];
    const binds: (string | number)[] = [desde];
    const email = c.req.query('email');
    if (email) {
      // Cuenta como "de fulano" tanto lo que hizo él como lo que alguien hizo
      // suplantándolo: las dos cosas salen a Monday a su nombre.
      where.push('(email = ? OR actua_como = ?)');
      binds.push(email, email);
    }
    const ruta = c.req.query('ruta');
    if (ruta) { where.push('ruta LIKE ?'); binds.push(`%${ruta}%`); }
    if (c.req.query('solo') === 'errores') where.push('ok = 0');

    const { results } = await c.env.DB.prepare(
      `SELECT at, email, actua_como, role, metodo, ruta, status, ok, ms, detalle
         FROM accion_log WHERE ${where.join(' AND ')} ORDER BY at DESC LIMIT ${limite}`,
    ).bind(...binds).all().catch(() => ({ results: [] }));
    return c.json(results ?? []);
  });
}

/** "Actuar en Monday como" presta un monday_user_id, y TODO el scoping de
 * renglón va por ese id (worker/lib/dal.ts): quien lo recibe ve y edita las
 * oportunidades de esa persona como si fueran suyas. Si la persona prestada
 * está en la zona privada 'Efrain' (worker/lib/zonas.ts), eso le abre la zona
 * completa sin dejar rastro visible en ninguna pantalla — que es justo lo que
 * pasó con un vendedor dado de alta con el id del CEO (2026-08-18). Se bloquea
 * el préstamo; el resto de los ids sigue igual. Devuelve el mensaje de error o
 * null si el préstamo es legítimo. */
async function idPrestadoBloqueado(env: Env, mondayUserId: number): Promise<string | null> {
  const privados = await zonaPrivadaMemberIds(env);
  if (privados.includes(mondayUserId)) {
    return 'ese usuario de Monday es de la zona privada: prestar su id le daría acceso a sus oportunidades';
  }
  // La whitelist de la zona privada va por correo (worker/lib/zonas.ts), pero
  // el scoping de renglón va por id: prestar el id de un permitido igual deja
  // ver todo lo suyo, aunque ya no herede el tab ni el alta.
  const { results } = await env.DB
    .prepare('SELECT email FROM identity WHERE monday_user_id = ?')
    .bind(mondayUserId).all<{ email: string }>();
  if ((results ?? []).some(r => isZonaPrivadaAdminPermitido(r.email))) {
    return 'ese usuario ve la zona privada: prestar su id le daría acceso a sus oportunidades';
  }
  return null;
}
