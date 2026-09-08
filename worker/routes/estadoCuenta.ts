// worker/routes/estadoCuenta.ts — rutas del Estado de cuenta del Proyecto
// (board "Estado de Cuenta", Efraín 2026-09-08). Toda la lógica en
// worker/lib/estadoCuenta.ts; aquí solo autorización y forma de la respuesta.
//
// Dos puertas en TODAS las rutas, en este orden:
//   1. la whitelist por CORREO (shared/visibility.ts puedeVerEstadoCuenta —
//      Elisa, el CEO y Efraín): al resto, admin incluido, 403. Es la misma
//      regla que las utilidades y por el mismo motivo.
//   2. el scoping del proyecto de siempre (dal.getItem): 404 si no existe o
//      no le toca. Las que MUTAN piden scope 'own', como todo endpoint que
//      escribe (CLAUDE.md).
//
// Se registra ANTES de oportunidadRoutes en worker/index.ts: allá vive el
// comodín POST /api/proyectos/:id/:action, que si no se comería el POST de
// /api/proyectos/:id/estado-cuenta.
import type { Context, Hono } from 'hono';
import type { Env } from '../env';
import type {
  AddAbonoRequest, AddEstadoCuentaRequest, EstadoCuentaResumenResponse, ListEstadoCuentaResponse, UpdateAbonoRequest,
} from '../../shared/dto';
import { puedeVerEstadoCuenta } from '../../shared/visibility';
import { getItem, scopeFor, type ScopeMode } from '../lib/dal';
import { BOARDS } from '../../shared/boards';
import type { MirrorItem } from '../../shared/types';
import { jsonStatus, rejectUnknownQuery, contentDisposition } from '../lib/http';
import {
  EstadoCuentaError, ARCHIVO_MAX_BYTES,
  addConcepto, removeConcepto, addAbono, updateAbono, removeAbono,
  listEstadoCuenta, listEstadoCuentaCartera, resumenPorProyecto, guardarArchivo, leerArchivo, type ArchivoDestino,
} from '../lib/estadoCuenta';
import { cabeceraDe, nombreArchivo, pdfEstadoCuenta, xlsxEstadoCuenta, proyectoCarteraDe, xlsxCartera } from '../lib/estadoCuentaExport';

type Ctx = Context<{ Bindings: Env }>;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function fail(err: unknown): Response {
  if (err instanceof EstadoCuentaError) return jsonStatus({ ok: false, error: err.message }, err.status);
  console.log('[estado-cuenta] ' + String(err));
  return jsonStatus({ ok: false, error: 'internal error' }, 500);
}

/** Las dos puertas. Devuelve el proyecto autorizado o la respuesta de error. */
async function autorizar(c: Ctx, mode: ScopeMode): Promise<{ id: number; row: NonNullable<Awaited<ReturnType<typeof getItem>>> } | Response> {
  const viewer = c.get('viewer');
  if (!puedeVerEstadoCuenta(viewer.email)) return c.json({ error: 'forbidden' }, 403);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'not found' }, 404);
  const row = await getItem(c.env, 'proyectos', id, viewer, mode);
  if (!row) return c.json({ error: 'not found' }, 404);
  return { id, row };
}

function num(v: string): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function archivoResponse(a: { body: ReadableStream; contentType: string; nombre: string; bytes: number }): Response {
  return new Response(a.body, {
    status: 200,
    headers: {
      'Content-Type': a.contentType,
      'Content-Length': String(a.bytes),
      // inline: el visor del portal lo previsualiza; el <a download> usa el
      // filename de aquí (worker/lib/http.ts contentDisposition).
      'Content-Disposition': contentDisposition(a.nombre),
      'Cache-Control': 'private, max-age=60',
    },
  });
}

export function estadoCuentaRoutes(app: Hono<{ Bindings: Env }>) {
  // Resumen de TODOS los proyectos visibles — lo que la lista del board suma
  // por grupo. Va bajo /api/estado-cuenta (no /api/proyectos/...) para no
  // colisionar con ningún /api/proyectos/:id.
  app.get('/api/estado-cuenta/resumen', async c => {
    const bad = rejectUnknownQuery(c.req.url, []);
    if (bad) return bad;
    const viewer = c.get('viewer');
    if (!puedeVerEstadoCuenta(viewer.email)) return c.json({ error: 'forbidden' }, 403);
    try {
      const response: EstadoCuentaResumenResponse = { resumen: await resumenPorProyecto(c.env, viewer) };
      return c.json(response);
    } catch (err) {
      return fail(err);
    }
  });

  // Excel de TODOS los proyectos visibles (Efraín, 2026-09-08): un renglón por
  // proyecto con las columnas del board + hojas de detalle. Mismo scoping
  // que la lista (dal.scopeFor sobre `items`), misma whitelist.
  app.get('/api/estado-cuenta/export.xlsx', async c => {
    const bad = rejectUnknownQuery(c.req.url, []);
    if (bad) return bad;
    const viewer = c.get('viewer');
    if (!puedeVerEstadoCuenta(viewer.email)) return c.json({ error: 'forbidden' }, 403);
    try {
      const scope = scopeFor('proyectos', viewer, 'read');
      const [filas, resumen, cartera] = await Promise.all([
        c.env.DB.prepare(`SELECT * FROM items WHERE board_id = ? AND (${scope.where})`)
          .bind(BOARDS.proyectos.id, ...scope.binds).all<MirrorItem>(),
        resumenPorProyecto(c.env, viewer),
        listEstadoCuentaCartera(c.env, viewer),
      ]);
      const proyectos = (filas.results ?? []).map(row =>
        proyectoCarteraDe(row, resumen[String(row.item_id)], cartera.get(row.item_id) ?? []));
      const bytes = xlsxCartera(proyectos);
      const nombre = `Estado-de-cuenta-proyectos-${new Date().toISOString().slice(0, 10)}.xlsx`;
      return new Response(bytes as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': XLSX,
          'Content-Length': String(bytes.length),
          'Content-Disposition': contentDisposition(nombre, 'attachment'),
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (err) {
      return fail(err);
    }
  });

  // ── Conceptos ─────────────────────────────────────────────────────────────
  app.get('/api/proyectos/:id/estado-cuenta', async c => {
    const bad = rejectUnknownQuery(c.req.url, []);
    if (bad) return bad;
    const auth = await autorizar(c, 'read');
    if (auth instanceof Response) return auth;
    try {
      const response: ListEstadoCuentaResponse = { conceptos: await listEstadoCuenta(c.env, auth.id) };
      return c.json(response);
    } catch (err) {
      return fail(err);
    }
  });

  app.post('/api/proyectos/:id/estado-cuenta', async c => {
    const auth = await autorizar(c, 'own');
    if (auth instanceof Response) return auth;
    const body = await c.req.json<AddEstadoCuentaRequest>().catch(() => null);
    if (!body) return jsonStatus({ ok: false, error: 'cuerpo inválido' }, 400);
    try {
      return c.json(await addConcepto(c.env, auth.id, {
        tipo: body.tipo, total: Number(body.total), fecha: body.fecha, concepto: body.concepto,
        abonoInicial: body.abonoInicial === undefined ? undefined : Number(body.abonoInicial),
        fechaEstimada: body.fechaEstimada,
      }, c.get('viewer')));
    } catch (err) {
      return fail(err);
    }
  });

  // Exportar: descarga directa, no deja rastro — es una FOTO de lo que ya
  // está en D1 (mismo listEstadoCuenta que la pantalla). Van ANTES de
  // /:conceptoId para que "export.pdf" no se lea como un id.
  app.get('/api/proyectos/:id/estado-cuenta/export.pdf', async c => {
    const bad = rejectUnknownQuery(c.req.url, []);
    if (bad) return bad;
    const auth = await autorizar(c, 'read');
    if (auth instanceof Response) return auth;
    try {
      const info = cabeceraDe(auth.row);
      const bytes = pdfEstadoCuenta(info, await listEstadoCuenta(c.env, auth.id));
      return new Response(bytes as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(bytes.length),
          'Content-Disposition': contentDisposition(nombreArchivo(info.folio, 'pdf'), 'attachment'),
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (err) {
      return fail(err);
    }
  });

  app.get('/api/proyectos/:id/estado-cuenta/export.xlsx', async c => {
    const bad = rejectUnknownQuery(c.req.url, []);
    if (bad) return bad;
    const auth = await autorizar(c, 'read');
    if (auth instanceof Response) return auth;
    try {
      const info = cabeceraDe(auth.row);
      const bytes = xlsxEstadoCuenta(info, await listEstadoCuenta(c.env, auth.id));
      return new Response(bytes as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': XLSX,
          'Content-Length': String(bytes.length),
          'Content-Disposition': contentDisposition(nombreArchivo(info.folio, 'xlsx'), 'attachment'),
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (err) {
      return fail(err);
    }
  });

  app.delete('/api/proyectos/:id/estado-cuenta/:conceptoId', async c => {
    const auth = await autorizar(c, 'own');
    if (auth instanceof Response) return auth;
    const conceptoId = num(c.req.param('conceptoId'));
    if (conceptoId === null) return c.json({ error: 'not found' }, 404);
    try {
      await removeConcepto(c.env, auth.id, conceptoId, c.get('viewer'));
      return c.json({ ok: true });
    } catch (err) {
      return fail(err);
    }
  });

  // La factura del concepto: cuerpo = los bytes crudos, nombre en ?nombre=
  // (mismo patrón que POST /api/proyectos/:id/imagenes).
  app.post('/api/proyectos/:id/estado-cuenta/:conceptoId/archivo', async c => {
    const bad = rejectUnknownQuery(c.req.url, ['nombre']);
    if (bad) return bad;
    const auth = await autorizar(c, 'own');
    if (auth instanceof Response) return auth;
    const conceptoId = num(c.req.param('conceptoId'));
    if (conceptoId === null) return c.json({ error: 'not found' }, 404);
    const buf = await c.req.arrayBuffer();
    if (buf.byteLength > ARCHIVO_MAX_BYTES) return jsonStatus({ ok: false, error: 'el archivo pasa de 10 MB' }, 413);
    try {
      const destino: ArchivoDestino = { tabla: 'estado_cuenta', proyectoId: auth.id, rowId: conceptoId };
      const archivo = await guardarArchivo(c.env, destino, new Uint8Array(buf), c.req.query('nombre') ?? '', c.get('viewer'));
      return c.json({ ok: true, archivo });
    } catch (err) {
      return fail(err);
    }
  });

  app.get('/api/proyectos/:id/estado-cuenta/:conceptoId/archivo', async c => {
    const bad = rejectUnknownQuery(c.req.url, []);
    if (bad) return bad;
    const auth = await autorizar(c, 'read');
    if (auth instanceof Response) return auth;
    const conceptoId = num(c.req.param('conceptoId'));
    if (conceptoId === null) return c.json({ error: 'not found' }, 404);
    const a = await leerArchivo(c.env, { tabla: 'estado_cuenta', proyectoId: auth.id, rowId: conceptoId });
    if (!a) return c.json({ error: 'sin archivo' }, 404);
    return archivoResponse(a);
  });

  // ── Abonos (cobros / pagos) ───────────────────────────────────────────────
  app.post('/api/proyectos/:id/estado-cuenta/:conceptoId/abonos', async c => {
    const auth = await autorizar(c, 'own');
    if (auth instanceof Response) return auth;
    const conceptoId = num(c.req.param('conceptoId'));
    if (conceptoId === null) return c.json({ error: 'not found' }, 404);
    const body = await c.req.json<AddAbonoRequest>().catch(() => null);
    if (!body) return jsonStatus({ ok: false, error: 'cuerpo inválido' }, 400);
    try {
      return c.json(await addAbono(c.env, auth.id, conceptoId, {
        monto: Number(body.monto), fecha: body.fecha, fechaEstimada: body.fechaEstimada, nota: body.nota,
      }, c.get('viewer')));
    } catch (err) {
      return fail(err);
    }
  });

  // Marcar un programado como ya cobrado, corregir el monto o moverlo de mes.
  app.patch('/api/proyectos/:id/estado-cuenta/:conceptoId/abonos/:abonoId', async c => {
    const auth = await autorizar(c, 'own');
    if (auth instanceof Response) return auth;
    const conceptoId = num(c.req.param('conceptoId'));
    const abonoId = num(c.req.param('abonoId'));
    if (conceptoId === null || abonoId === null) return c.json({ error: 'not found' }, 404);
    const body = await c.req.json<UpdateAbonoRequest>().catch(() => null);
    if (!body) return jsonStatus({ ok: false, error: 'cuerpo inválido' }, 400);
    try {
      return c.json(await updateAbono(c.env, auth.id, conceptoId, abonoId, {
        monto: body.monto === undefined ? undefined : Number(body.monto),
        fecha: body.fecha, fechaEstimada: body.fechaEstimada, nota: body.nota,
      }, c.get('viewer')));
    } catch (err) {
      return fail(err);
    }
  });

  app.delete('/api/proyectos/:id/estado-cuenta/:conceptoId/abonos/:abonoId', async c => {
    const auth = await autorizar(c, 'own');
    if (auth instanceof Response) return auth;
    const conceptoId = num(c.req.param('conceptoId'));
    const abonoId = num(c.req.param('abonoId'));
    if (conceptoId === null || abonoId === null) return c.json({ error: 'not found' }, 404);
    try {
      await removeAbono(c.env, auth.id, conceptoId, abonoId, c.get('viewer'));
      return c.json({ ok: true });
    } catch (err) {
      return fail(err);
    }
  });

  // El comprobante de UN abono (la transferencia, el cheque).
  app.post('/api/proyectos/:id/estado-cuenta/:conceptoId/abonos/:abonoId/archivo', async c => {
    const bad = rejectUnknownQuery(c.req.url, ['nombre']);
    if (bad) return bad;
    const auth = await autorizar(c, 'own');
    if (auth instanceof Response) return auth;
    const conceptoId = num(c.req.param('conceptoId'));
    const abonoId = num(c.req.param('abonoId'));
    if (conceptoId === null || abonoId === null) return c.json({ error: 'not found' }, 404);
    const buf = await c.req.arrayBuffer();
    if (buf.byteLength > ARCHIVO_MAX_BYTES) return jsonStatus({ ok: false, error: 'el archivo pasa de 10 MB' }, 413);
    try {
      const destino: ArchivoDestino = { tabla: 'estado_cuenta_abono', proyectoId: auth.id, conceptoId, rowId: abonoId };
      const archivo = await guardarArchivo(c.env, destino, new Uint8Array(buf), c.req.query('nombre') ?? '', c.get('viewer'));
      return c.json({ ok: true, archivo });
    } catch (err) {
      return fail(err);
    }
  });

  app.get('/api/proyectos/:id/estado-cuenta/:conceptoId/abonos/:abonoId/archivo', async c => {
    const bad = rejectUnknownQuery(c.req.url, []);
    if (bad) return bad;
    const auth = await autorizar(c, 'read');
    if (auth instanceof Response) return auth;
    const conceptoId = num(c.req.param('conceptoId'));
    const abonoId = num(c.req.param('abonoId'));
    if (conceptoId === null || abonoId === null) return c.json({ error: 'not found' }, 404);
    const a = await leerArchivo(c.env, { tabla: 'estado_cuenta_abono', proyectoId: auth.id, conceptoId, rowId: abonoId });
    if (!a) return c.json({ error: 'sin archivo' }, 404);
    return archivoResponse(a);
  });
}
