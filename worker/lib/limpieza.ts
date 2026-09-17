// worker/lib/limpieza.ts — Borrar items de PRUEBA (nombre con test / prueba /
// borrar) de Monday y de D1, con sus líneas (Efraín, 2026-09-16: "tenemos
// cientos de oportunidades y proyectos de prueba… haz un clean en Monday y por
// ende en nuestra base de datos; asegúrate de que no haya nada firmado").
//
// El DELETE genérico de /api/boards solo acepta líneas de cotización a
// propósito: borrar un padre se lleva en cascada sus subitems en Monday sin
// respaldo. Aquí el respaldo se hace ANTES: cada línea queda en `item_borrado`
// y luego el padre pasa por borrarItem (worker/lib/itemBorrado.ts), el único
// lugar del worker que borra en Monday. Monday borra los subitems solo; al
// final se limpian sus filas del mirror.
//
// Guardas (del lado del server, aunque el script las repita):
//   - Un item por llamada, por id Y por nombre exacto: si no coinciden no se
//     borra nada (protege contra un id pegado mal).
//   - El nombre tiene que decir test / prueba / borrar, y NO "pruebas de lab"
//     (esos son proyectos y productos reales de laboratorio para clientes).
//   - Nada con firma MANUAL en `document_signatures` (los acuses automáticos
//     con ATTEST_INTENT no cuentan: son constancia de que se generó el PDF).
//   - Mismo tope por hora de borrarItem (40 por persona): cada padre cuenta 1.
//
// Dos entradas: POST /api/admin/limpieza/borrar (worker/routes/limpieza.ts,
// con sesión de Access) y la cola `limpieza_cola`, que el cron de 15 min
// procesa de a LOTE_POR_CORRIDA (la sesión de Access de los scripts expira y
// no hay forma de borrar desde fuera sin ella; encolar solo necesita D1 —
// scripts/limpiar-pruebas.mjs --encolar). A 10 por corrida son 40 por hora,
// justo el tope; al primer 429 la corrida se detiene y la siguiente sigue.
import type { Env } from '../env';
import { BOARDS, type BoardSlug } from '../../shared/boards';
import { ATTEST_INTENT } from '../../shared/documents';
import { borrarItem, BorradoError, ensureItemBorradoTable } from './itemBorrado';
import { registrarError } from './errores';

export const SLUGS_LIMPIEZA: BoardSlug[] = ['oportunidades', 'proyectos', 'contactos', 'instituciones'];
const LOTE_POR_CORRIDA = 10;
/** Presupuesto de pared por corrida. Medido 2026-09-17: cada borrado tarda
 * ~4-5 s (delete_item de Monday); la corrida de las 06:00 se cortó a los 6
 * items y la de 06:15 no procesó ninguno, sin error asentado — la invocación
 * del cron se termina antes de acabar el lote. Con 20 s se cierran ~4 por
 * corrida y, como también procesa el cron de 10 min, salen ~40 por hora. */
const PRESUPUESTO_MS = 20_000;

export class LimpiezaError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function esNombreDePrueba(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes('pruebas de lab')) return false;
  return /test|prueba|borrar/.test(n);
}

/** Borra el padre (y sus líneas) tras verificar todas las guardas. Devuelve
 * cuántas líneas se llevó. Lanza LimpiezaError (400/404/409) o BorradoError
 * (429 tope, 502 Monday). */
export async function borrarPrueba(
  env: Env, slug: BoardSlug, itemId: number, nombre: string, byEmail: string,
): Promise<{ lineas: number }> {
  if (!SLUGS_LIMPIEZA.includes(slug) || !Number.isFinite(itemId) || !nombre) {
    throw new LimpiezaError(400, 'se requiere slug (oportunidades|proyectos|contactos|instituciones), itemId y nombre');
  }
  const board = BOARDS[slug];
  const row = await env.DB
    .prepare('SELECT name FROM items WHERE board_id = ? AND item_id = ? AND parent_item_id IS NULL')
    .bind(board.id, itemId).first<{ name: string }>();
  if (!row) throw new LimpiezaError(404, 'not found');
  if (row.name !== nombre) {
    throw new LimpiezaError(409, `el nombre no coincide: el item ${itemId} se llama "${row.name}"`);
  }
  if (!esNombreDePrueba(row.name)) {
    throw new LimpiezaError(409, 'el nombre no dice test/prueba/borrar; por aquí solo se borran pruebas');
  }
  const firmas = await env.DB.prepare(
    `SELECT count(*) AS n FROM document_signatures s JOIN documents d ON d.id = s.document_id
     WHERE d.source_id = ? AND s.intent <> ?`,
  ).bind(String(itemId), ATTEST_INTENT).first<{ n: number }>().catch(() => ({ n: 0 }));
  if ((firmas?.n ?? 0) > 0) throw new LimpiezaError(409, 'tiene un documento con firma manual; no se borra');

  const sub = Object.values(BOARDS).find(b => b.parent === slug);
  const lineas = sub
    ? (await env.DB.prepare('SELECT board_id, item_id, name, columns FROM items WHERE parent_item_id = ?')
        .bind(itemId).all<{ board_id: number; item_id: number; name: string; columns: string }>()).results ?? []
    : [];

  await ensureItemBorradoTable(env);
  const ahora = new Date().toISOString();
  for (const l of lineas) {
    await env.DB.prepare(
      `INSERT INTO item_borrado (board_id, item_id, parent_item_id, name, columns, deleted_at, by_email)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(board_id, item_id) DO UPDATE SET name = excluded.name, columns = excluded.columns,
         deleted_at = excluded.deleted_at, by_email = excluded.by_email`,
    ).bind(l.board_id, l.item_id, itemId, l.name, l.columns, ahora, byEmail).run();
  }
  // Monday borra los subitems en cascada con el padre.
  await borrarItem(env, board.id, itemId, byEmail);
  if (lineas.length) {
    await env.DB.prepare('DELETE FROM items WHERE parent_item_id = ?').bind(itemId).run();
  }
  return { lineas: lineas.length };
}

// ── Cola ────────────────────────────────────────────────────────────────────
let colaLista = false;
export async function ensureLimpiezaCola(env: Env): Promise<void> {
  if (colaLista) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS limpieza_cola (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    slug         TEXT NOT NULL,
    item_id      INTEGER NOT NULL,
    nombre       TEXT NOT NULL,
    encolado_por TEXT NOT NULL,
    encolado_at  TEXT NOT NULL,
    procesado_at TEXT,
    resultado    TEXT,
    UNIQUE (slug, item_id)
  )`).run();
  colaLista = true;
}

interface Pendiente { id: number; slug: BoardSlug; item_id: number; nombre: string; encolado_por: string }

/** Procesa hasta LOTE_POR_CORRIDA pendientes. Un 429 (tope por hora) detiene
 * la corrida y deja el resto para la siguiente; cualquier otro error queda
 * asentado en `resultado` y el item no se reintenta. */
export async function procesarColaLimpieza(env: Env): Promise<{ ok: number; fallidos: number; tope: boolean }> {
  const res = { ok: 0, fallidos: 0, tope: false };
  const inicio = Date.now();
  try {
    await ensureLimpiezaCola(env);
    const { results } = await env.DB
      .prepare('SELECT id, slug, item_id, nombre, encolado_por FROM limpieza_cola WHERE procesado_at IS NULL ORDER BY id LIMIT ?')
      .bind(LOTE_POR_CORRIDA).all<Pendiente>();
    for (const p of results ?? []) {
      if (Date.now() - inicio > PRESUPUESTO_MS) break;
      let resultado: string;
      try {
        const r = await borrarPrueba(env, p.slug, p.item_id, p.nombre, p.encolado_por);
        resultado = `ok (${r.lineas} líneas)`;
        res.ok++;
      } catch (err) {
        if (err instanceof BorradoError && err.status === 429) { res.tope = true; break; }
        resultado = `error: ${err instanceof Error ? err.message : String(err)}`;
        res.fallidos++;
      }
      await env.DB.prepare('UPDATE limpieza_cola SET procesado_at = ?, resultado = ? WHERE id = ?')
        .bind(new Date().toISOString(), resultado, p.id).run();
    }
  } catch (err) {
    await registrarError(env, 'cron limpieza_cola', err);
  }
  return res;
}
