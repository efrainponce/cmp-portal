// worker/mw/accionLog.ts — asienta en `accion_log` cada INTENTO de mutación.
// El "por qué" completo está en worker/lib/accionLog.ts; aquí solo el enganche.
//
// Va DESPUÉS de identity en la cadena (worker/index.ts) porque necesita
// `viewer`: sin identidad no hay a quién atribuirle nada, y esas peticiones ya
// mueren con el 403 de identity, que sí deja rastro en los logs del Worker.
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import { logAccion } from '../lib/accionLog';

// Los GET no entran (ver la regla 1 del lib). `/api/telemetry` tampoco: es el
// beacon de la propia telemetría —un POST cada 5s por pestaña abierta— y
// registrarlo llenaría la bitácora de su propio ruido.
const IGNORADAS = new Set(['/api/telemetry']);

/** Motivo del rechazo tal cual lo devolvió la ruta, para no tener que
 * adivinarlo después. Solo se lee en respuestas de error: en un 200 el cuerpo
 * puede ser un PDF de varios MB, y clonarlo para tirarlo sería absurdo. */
async function detalleDeError(res: Response): Promise<string | null> {
  try {
    const tipo = res.headers.get('Content-Type') ?? '';
    if (!tipo.includes('json')) return null;
    const body: unknown = await res.clone().json();
    if (body && typeof body === 'object') {
      const { error, reason } = body as { error?: unknown; reason?: unknown };
      const motivo = error ?? reason;
      if (typeof motivo === 'string') return motivo;
    }
    return null;
  } catch {
    return null;
  }
}

export const accionLog: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const metodo = c.req.method;
  if (metodo === 'GET' || metodo === 'HEAD' || IGNORADAS.has(c.req.path)) return next();

  const t0 = Date.now();
  const asentar = (status: number, detalle: string | null) => {
    const viewer = c.get('viewer');
    const real = c.get('impersonatedBy');
    const fila = {
      email: real?.email ?? viewer.email,
      actuaComo: real ? viewer.email : null,
      role: viewer.role,
      metodo, ruta: c.req.path, status, ms: Date.now() - t0, detalle,
    };
    // waitUntil: la bitácora nunca debe sumarle latencia a la persona. Si el
    // runtime no lo expone (tests), se asienta y ya.
    try { c.executionCtx.waitUntil(logAccion(c.env, fila)); } catch { void logAccion(c.env, fila); }
  };

  try {
    await next();
  } catch (err) {
    // Red de seguridad: hoy Hono atrapa la excepción del handler y la convierte
    // en la respuesta de app.onError ANTES de desenrollar los middlewares, así
    // que ese 500 se asienta por el camino normal de abajo (anclado en el test).
    // Esto cubre el caso en que sí llegue a propagarse — sin él, una acción que
    // truena sería justo la que no deja rastro.
    asentar(500, err instanceof Error ? err.message : String(err));
    throw err;
  }
  asentar(c.res.status, c.res.status >= 400 ? await detalleDeError(c.res) : null);
};
