// worker/routes/limpieza.ts — Borrar un item de PRUEBA con todo y sus líneas
// (Efraín, 2026-09-16: "tenemos cientos de oportunidades y proyectos de prueba
// … haz un clean en Monday y por ende en nuestra base de datos").
//
// El DELETE genérico de /api/boards solo acepta líneas de cotización a
// propósito: borrar un padre se lleva en cascada sus subitems en Monday sin
// respaldo. Aquí el respaldo se hace ANTES: cada línea queda en `item_borrado`
// y luego el padre pasa por borrarItem (worker/lib/itemBorrado.ts), el único
// lugar del worker que le manda `delete_item` a Monday. Monday borra los
// subitems solo; al final se limpian sus filas del mirror.
//
// Guardas (todas del lado del server, aunque el script las repita):
//   - Solo admin, un item por llamada, por id Y por nombre exacto: si el id
//     y el nombre no coinciden no se borra nada (protege contra un id
//     pegado mal en el script).
//   - El nombre tiene que decir test / prueba / borrar, y NO "pruebas de lab"
//     (esos son proyectos reales de laboratorio para clientes).
//   - Nada con firma MANUAL en `document_signatures` (los acuses automáticos
//     con ATTEST_INTENT no cuentan: son constancia de que se generó el PDF).
//   - Mismo tope por hora de borrarItem (40 por persona): cada padre cuenta 1.
// Lo que se llama desde scripts/limpiar-pruebas.mjs.
import type { Hono } from 'hono';
import type { Env } from '../env';
import { BOARDS, type BoardSlug } from '../../shared/boards';
import { ATTEST_INTENT } from '../../shared/documents';
import { borrarItem, BorradoError, ensureItemBorradoTable } from '../lib/itemBorrado';
import { jsonStatus } from '../lib/http';
import { errorInterno } from '../lib/errores';

const SLUGS_PERMITIDOS: BoardSlug[] = ['oportunidades', 'proyectos', 'contactos', 'instituciones'];

export function esNombreDePrueba(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes('pruebas de lab')) return false;
  return /test|prueba|borrar/.test(n);
}

interface Body { slug?: unknown; itemId?: unknown; nombre?: unknown }

export function limpiezaRoutes(app: Hono<{ Bindings: Env }>) {
  app.post('/api/admin/limpieza/borrar', async c => {
    const viewer = c.get('viewer');
    if (viewer.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

    let body: Body;
    try { body = await c.req.json<Body>(); } catch { return jsonStatus({ ok: false, error: 'body inválido' }, 400); }
    const slug = body.slug as BoardSlug;
    const itemId = Number(body.itemId);
    const nombre = typeof body.nombre === 'string' ? body.nombre : '';
    if (!SLUGS_PERMITIDOS.includes(slug) || !Number.isFinite(itemId) || !nombre) {
      return jsonStatus({ ok: false, error: 'se requiere slug (oportunidades|proyectos|contactos|instituciones), itemId y nombre' }, 400);
    }
    const board = BOARDS[slug];

    const row = await c.env.DB
      .prepare('SELECT name FROM items WHERE board_id = ? AND item_id = ? AND parent_item_id IS NULL')
      .bind(board.id, itemId).first<{ name: string }>();
    if (!row) return c.json({ error: 'not found' }, 404);
    if (row.name !== nombre) {
      return jsonStatus({ ok: false, error: `el nombre no coincide: el item ${itemId} se llama "${row.name}"` }, 409);
    }
    if (!esNombreDePrueba(row.name)) {
      return jsonStatus({ ok: false, error: 'el nombre no dice test/prueba/borrar; por aquí solo se borran pruebas' }, 409);
    }

    const firmas = await c.env.DB.prepare(
      `SELECT count(*) AS n FROM document_signatures s JOIN documents d ON d.id = s.document_id
       WHERE d.source_id = ? AND s.intent <> ?`,
    ).bind(String(itemId), ATTEST_INTENT).first<{ n: number }>().catch(() => ({ n: 0 }));
    if ((firmas?.n ?? 0) > 0) {
      return jsonStatus({ ok: false, error: 'tiene un documento con firma manual; no se borra' }, 409);
    }

    const sub = Object.values(BOARDS).find(b => b.parent === slug);
    const lineas = sub
      ? (await c.env.DB.prepare('SELECT board_id, item_id, name, columns FROM items WHERE parent_item_id = ?')
          .bind(itemId).all<{ board_id: number; item_id: number; name: string; columns: string }>()).results ?? []
      : [];

    try {
      await ensureItemBorradoTable(c.env);
      const ahora = new Date().toISOString();
      for (const l of lineas) {
        await c.env.DB.prepare(
          `INSERT INTO item_borrado (board_id, item_id, parent_item_id, name, columns, deleted_at, by_email)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(board_id, item_id) DO UPDATE SET name = excluded.name, columns = excluded.columns,
             deleted_at = excluded.deleted_at, by_email = excluded.by_email`,
        ).bind(l.board_id, l.item_id, itemId, l.name, l.columns, ahora, viewer.email).run();
      }
      // Monday borra los subitems en cascada con el padre.
      await borrarItem(c.env, board.id, itemId, viewer.email);
      if (lineas.length) {
        await c.env.DB.prepare('DELETE FROM items WHERE parent_item_id = ?').bind(itemId).run();
      }
    } catch (err) {
      if (err instanceof BorradoError) return jsonStatus({ ok: false, error: err.message }, err.status);
      return errorInterno(c, err, { ok: false, error: 'internal error' });
    }
    return c.json({ ok: true, itemId, nombre: row.name, lineas: lineas.length });
  });
}
