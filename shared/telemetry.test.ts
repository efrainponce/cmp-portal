// Guardarraíl del guardarraíl: shared/telemetry.ts es la contención EJECUTABLE
// de "nunca texto capturado por el usuario" (ver cabecera de ese archivo). Todo
// son strings y regex, o sea justo lo que `npm run typecheck` no revisa — si
// esto se relaja sin querer, no truena nada, simplemente empieza a guardarse
// información de personas que no debería existir. De ahí que el grueso de los
// casos de abajo sean intentos de colar texto libre.
import { describe, it, expect } from 'vitest';
import {
  isValidTarget, isValidUxId, isUxKind, sanitizeMeta, routeSlug,
  UX_MAX_BATCH, UX_RETENTION_DAYS,
} from './telemetry';

describe('isValidTarget', () => {
  it('acepta los slugs de control que usa el portal', () => {
    for (const t of ['drawer:mandar-costeo', 'drawer:open', 'cotizacion:linea-edit', 'api:patch:boards:slug:items:id']) {
      expect(isValidTarget(t)).toBe(true);
    }
  });

  it('rechaza cualquier cosa que huela a texto capturado', () => {
    for (const t of [
      'Hospital General de México',   // nombre de cliente
      'efrain@mexicanadeproteccion.com',
      'OPP-0504 Cotización',
      'drawer Mandar A Costeo',       // espacios/mayúsculas
      'Precio de Venta C/U',
      '',
      'x'.repeat(65),                 // se pasa del tope
    ]) {
      expect(isValidTarget(t)).toBe(false);
    }
  });
});

describe('sanitizeMeta', () => {
  it('deja pasar números, booleanos y slugs cortos', () => {
    expect(sanitizeMeta({ busy: true, intento: 2, origen: 'drawer' }))
      .toBe(JSON.stringify({ busy: true, intento: 2, origen: 'drawer' }));
  });

  it('tira el valor si es texto libre, y con él el riesgo de fuga', () => {
    // El caso real que esto previene: alguien mete el nombre del cliente
    // "solo para depurar" y se queda seis meses.
    expect(sanitizeMeta({ cliente: 'Hospital General de México' })).toBeNull();
    expect(sanitizeMeta({ nota: 'el vendedor escribió esto a mano' })).toBeNull();
    expect(sanitizeMeta({ correo: 'alguien@ejemplo.com' })).toBeNull();
  });

  it('conserva lo válido y descarta solo lo inválido en el mismo objeto', () => {
    expect(sanitizeMeta({ busy: true, cliente: 'Hospital General' }))
      .toBe(JSON.stringify({ busy: true }));
  });

  it('no se mete a objetos ni arreglos anidados (por ahí se colaría todo)', () => {
    expect(sanitizeMeta({ payload: { cliente: 'Hospital' } })).toBeNull();
    expect(sanitizeMeta({ lineas: ['Casco', 'Chaleco'] })).toBeNull();
    expect(sanitizeMeta(['Hospital General'])).toBeNull();
    expect(sanitizeMeta('Hospital General')).toBeNull();
    expect(sanitizeMeta(null)).toBeNull();
  });

  it('capea el número de llaves', () => {
    const gordo = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(JSON.parse(sanitizeMeta(gordo)!)).length).toBe(8);
  });
});

describe('routeSlug', () => {
  it('colapsa ids numéricos y el board, para que el slug sea estable', () => {
    expect(routeSlug('PATCH', '/boards/oportunidades/items/12345'))
      .toBe('api:patch:boards:slug:items:id');
    expect(routeSlug('GET', '/boards/productos/items'))
      .toBe('api:get:boards:slug:items');
  });

  it('dos items distintos del mismo endpoint dan el MISMO slug', () => {
    // Si no, p50/p90 por endpoint no existirían: cada item sería su propio grupo.
    expect(routeSlug('PATCH', '/boards/oportunidades/items/1'))
      .toBe(routeSlug('PATCH', '/boards/oportunidades/items/999999999'));
  });

  it('tira query string y fragmento (ahí viajan filtros y búsquedas del usuario)', () => {
    expect(routeSlug('GET', '/boards/contactos/items?q=Hospital%20General&cols=name'))
      .toBe('api:get:boards:slug:items');
  });

  it('colapsa a `id` cualquier segmento que no sea una palabra de ruta', () => {
    // Default seguro: uuids, folios y correos nunca llegan al slug.
    expect(routeSlug('GET', '/documents/9f8b7a6c-1234-4def-8888-aabbccddeeff'))
      .toBe('api:get:documents:id');
    expect(routeSlug('GET', '/oportunidades/OPP-0504')).toBe('api:get:oportunidades:id');
    expect(routeSlug('POST', '/oportunidades/12345/enviar-costeo'))
      .toBe('api:post:oportunidades:id:enviar-costeo');
    expect(routeSlug('POST', '/identity/efrain@mexicanadeproteccion.com'))
      .toBe('api:post:identity:id');
  });

  it('el resultado siempre es un target válido', () => {
    for (const p of ['/boards/oportunidades_sub/items/12', '/me', '/anuncios', '/documents/abc-uuid-9999']) {
      expect(isValidTarget(routeSlug('GET', p))).toBe(true);
    }
  });
});

describe('constantes de contrato', () => {
  it('el lote y la retención son los que asume el worker', () => {
    expect(UX_MAX_BATCH).toBe(200);
    expect(UX_RETENTION_DAYS).toBe(90);
  });

  it('isUxKind / isValidUxId', () => {
    expect(isUxKind('click')).toBe(true);
    expect(isUxKind('pageview')).toBe(false);
    expect(isValidUxId('9f8b7a6c-1234-4def-8888-aabbccddeeff')).toBe(true);
    expect(isValidUxId('corto')).toBe(false);
    expect(isValidUxId('Hospital General')).toBe(false);
  });
});
