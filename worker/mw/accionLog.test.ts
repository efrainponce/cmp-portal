// La bitácora existe para contestar "¿qué intentó fulano y qué le contestó el
// portal?" (worker/lib/accionLog.ts). Sus cuatro reglas se anclan aquí porque
// cada una se puede romper sin que nada más se entere: si entran los GET la
// tabla se ahoga y deja de servir para auditar; si se pierde el motivo del
// rechazo vuelve a no haber rastro de los 403; y si la suplantación se guarda
// como si fuera el suplantado, el log miente justo en el caso que más importa.
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../env';
import { accionLog } from './accionLog';

interface Fila { sql: string; binds: unknown[] }
let escrituras: Fila[] = [];

function fakeDB() {
  const prepare = (sql: string) => ({
    bind: (...binds: unknown[]) => ({
      run: async () => { if (sql.startsWith('INSERT INTO accion_log')) escrituras.push({ sql, binds }); return { meta: {} }; },
    }),
    run: async () => ({ meta: {} }),
  });
  return { prepare, batch: async () => [] };
}

const VIEWER = { email: 'ventas@cmp.com', role: 'vendedor' };
const ADMIN = { email: 'admin@cmp.com', role: 'admin' };

/** Monta la cadena real (middleware + una ruta) y devuelve lo que se asentó. */
async function correr(
  metodo: string, ruta: string,
  handler: (c: { json: (b: unknown, s?: number) => Response }) => Response,
  impersonatedBy: typeof ADMIN | null = null,
) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.set('viewer', VIEWER as never);
    c.set('impersonatedBy', impersonatedBy as never);
    await next();
  });
  app.use('*', accionLog);
  app.all('*', handler as never);
  await app.fetch(
    new Request(`https://portal.test${ruta}`, { method: metodo }),
    { DB: fakeDB() } as unknown as Env,
  );
  // El INSERT va en waitUntil; sin executionCtx real corre suelto, así que se
  // le da un tick al event loop antes de mirar.
  await new Promise(r => setTimeout(r, 0));
  return escrituras;
}

const campos = (f: Fila) => ({
  email: f.binds[1], actuaComo: f.binds[2], role: f.binds[3],
  metodo: f.binds[4], ruta: f.binds[5], status: f.binds[6], ok: f.binds[7], detalle: f.binds[9],
});

describe('accionLog', () => {
  beforeEach(() => { escrituras = []; });

  it('no registra GET: son el 99% del tráfico y su latencia ya vive en ux_event', async () => {
    expect(await correr('GET', '/api/boards/oportunidades/items', c => c.json([]))).toHaveLength(0);
  });

  it('no registra el beacon de telemetría (llenaría la bitácora de su propio ruido)', async () => {
    expect(await correr('POST', '/api/telemetry', c => c.json(null, 204))).toHaveLength(0);
  });

  it('registra una mutación exitosa con su ruta y su status', async () => {
    const filas = await correr('PATCH', '/api/boards/oportunidades/items/123', c => c.json({ ok: true }));
    expect(filas).toHaveLength(1);
    expect(campos(filas[0])).toMatchObject({
      email: 'ventas@cmp.com', actuaComo: null, role: 'vendedor',
      metodo: 'PATCH', ruta: '/api/boards/oportunidades/items/123', status: 200, ok: 1,
    });
  });

  it('guarda el MOTIVO del rechazo, que es lo único que no queda en ningún otro lado', async () => {
    const filas = await correr('POST', '/api/oportunidades/9/validar-costeo', c => c.json({ error: 'ninguna línea tiene Precio de Venta' }, 409));
    expect(campos(filas[0])).toMatchObject({ status: 409, ok: 0, detalle: 'ninguna línea tiene Precio de Venta' });
  });

  it('un 403 por rol queda asentado (antes se iba sin dejar rastro)', async () => {
    const filas = await correr('DELETE', '/api/boards/oportunidades/items/5', c => c.json({ error: 'forbidden' }, 403));
    expect(campos(filas[0])).toMatchObject({ status: 403, ok: 0, detalle: 'forbidden' });
  });

  it('suplantación: registra a QUIEN actuó y a quién suplantaba, no solo al segundo', async () => {
    const filas = await correr('PATCH', '/api/boards/oportunidades/items/1', c => c.json({ ok: true }), ADMIN);
    expect(campos(filas[0])).toMatchObject({ email: 'admin@cmp.com', actuaComo: 'ventas@cmp.com', role: 'vendedor' });
  });

  it('una excepción no capturada queda asentada como 500 (Hono la convierte antes de desenrollar)', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', async (c, next) => { c.set('viewer', VIEWER as never); c.set('impersonatedBy', null); await next(); });
    app.use('*', accionLog);
    app.all('*', () => { throw new Error('Monday 500'); });
    // Mismo onError que worker/index.ts: responde JSON, y ahí se queda el
    // mensaje crudo del error (ese va a sync_log, no aquí).
    app.onError(() => new Response(JSON.stringify({ error: 'internal error' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
    await app.fetch(new Request('https://portal.test/api/oportunidades/1/cotizacion', { method: 'POST' }), { DB: fakeDB() } as unknown as Env);
    await new Promise(r => setTimeout(r, 0));
    expect(campos(escrituras[0])).toMatchObject({ status: 500, ok: 0, detalle: 'internal error' });
  });
});
