// El filtro de whitelist y la conversión de fecha son la única lógica real de
// este módulo (el resto es I/O de D1) y ambas son fáciles de romper en
// silencio: todo son strings, el typecheck no atrapa nada. ticksToIso está
// anclado contra un valor real verificado en vivo (2026-08-14, MCP monday.com
// get_board_activity) para no reintroducir el bug de Number() perdiendo
// precisión pasado 2^53.
import { describe, it, expect } from 'vitest';
import { ticksToIso, parseEntry, isPortalWriteColumn, actorNameResolver } from './activityLog';
import type { ActivityLogEntry } from './monday';

const OPORTUNIDADES_BOARD_ID = 18395657596;
const OPORTUNIDADES_SUB_BOARD_ID = 18395657607;
const PRODUCTOS_BOARD_ID = 18395657591;
const PROYECTOS_SUB_BOARD_ID = 18395657609;
const INSTITUCIONES_BOARD_ID = 18395657597; // fuera de la whitelist a propósito

function entry(overrides: Omit<Partial<ActivityLogEntry>, 'data'> & { data: object }): ActivityLogEntry {
  return {
    boardId: OPORTUNIDADES_BOARD_ID, entity: 'pulse', event: 'update_column_value',
    userId: '98389537', createdAt: '17867431589600484',
    ...overrides, data: JSON.stringify(overrides.data),
  };
}

describe('ticksToIso', () => {
  it('convierte ticks de 100ns desde epoch Unix a ISO (verificado en vivo 2026-08-14)', () => {
    expect(ticksToIso('17867431589600484')).toBe('2026-08-14T21:32:38.960Z');
  });

  it('no pierde precisión con valores que exceden Number.MAX_SAFE_INTEGER', () => {
    // 17867431589600484 > 2^53 (9007199254740991) — Number() directo redondearía.
    expect(Number('17867431589600484') > Number.MAX_SAFE_INTEGER).toBe(true);
    expect(() => ticksToIso('17867431589600484')).not.toThrow();
  });
});

describe('parseEntry — whitelist de ruido', () => {
  it('acepta una columna en la whitelist (deal_stage, oportunidades)', () => {
    const row = parseEntry(entry({ data: { pulse_id: 123, column_id: 'deal_stage', column_title: 'Etapa', textual_value: 'Ganada', previous_textual_value: 'Costeo Confirmado' } }));
    expect(row).not.toBeNull();
    expect(row?.columnId).toBe('deal_stage');
    expect(row?.newText).toBe('Ganada');
    expect(row?.previousText).toBe('Costeo Confirmado');
  });

  it('descarta una columna fuera de la whitelist (ruido de automatización, ej. cotización auto-generada)', () => {
    const row = parseEntry(entry({ data: { pulse_id: 123, column_id: 'file_mm0fgrzq', column_title: 'Cotizaciones generadas', textual_value: 'x.pdf' } }));
    expect(row).toBeNull();
  });

  it('descarta un board fuera de alcance (instituciones)', () => {
    const row = parseEntry(entry({ boardId: INSTITUCIONES_BOARD_ID, data: { pulse_id: 123, column_id: 'text_mm1bvz12', textual_value: 'x' } }));
    expect(row).toBeNull();
  });

  it('descarta entity !== pulse (eventos a nivel board)', () => {
    const row = parseEntry(entry({ entity: 'board', data: { pulse_id: 123, column_id: 'deal_stage', textual_value: 'x' } }));
    expect(row).toBeNull();
  });

  it('descarta data no parseable como JSON', () => {
    const bad: ActivityLogEntry = { boardId: OPORTUNIDADES_BOARD_ID, entity: 'pulse', event: 'update_column_value', userId: '1', createdAt: '1', data: 'not json' };
    expect(parseEntry(bad)).toBeNull();
  });

  it('descarta un evento sin pulse_id numérico', () => {
    const row = parseEntry(entry({ data: { column_id: 'deal_stage', textual_value: 'x' } }));
    expect(row).toBeNull();
  });

  it('create_pulse siempre se registra, sin importar la columna', () => {
    const row = parseEntry(entry({ event: 'create_pulse', data: { pulse_id: 123, pulse_name: 'OPP-0999 - Cliente X' } }));
    expect(row).not.toBeNull();
    expect(row?.event).toBe('create_pulse');
    expect(row?.newText).toBe('OPP-0999 - Cliente X');
  });

  it('update_name siempre se registra, con previous/next del nombre', () => {
    const row = parseEntry(entry({
      event: 'update_name',
      data: { pulse_id: 123, previous_value: { name: 'Nombre viejo' }, value: { name: 'Nombre nuevo' } },
    }));
    expect(row).not.toBeNull();
    expect(row?.previousText).toBe('Nombre viejo');
    expect(row?.newText).toBe('Nombre nuevo');
  });

  it('acepta la whitelist de oportunidades_sub, incl. Precio de Venta C/U', () => {
    const row = parseEntry(entry({
      boardId: OPORTUNIDADES_SUB_BOARD_ID,
      data: { pulse_id: 456, column_id: 'numeric_mkzneg3d', column_title: 'Precio de Venta C/U', textual_value: '1200', previous_textual_value: '1000' },
    }));
    expect(row).not.toBeNull();
  });

  it('acepta la whitelist de productos', () => {
    const row = parseEntry(entry({
      boardId: PRODUCTOS_BOARD_ID,
      data: { pulse_id: 789, column_id: 'numeric_mkzpx7eb', column_title: 'Costo Distribuidor', textual_value: '50' },
    }));
    expect(row).not.toBeNull();
  });

  it('otros eventos no contemplados (subscribe, move_pulse_from_group) se descartan', () => {
    const row = parseEntry(entry({ event: 'subscribe', data: { pulse_id: 123 } }));
    expect(row).toBeNull();
  });

  it('acepta el costeo de la línea del Proyecto (edición hecha DENTRO de Monday)', () => {
    const row = parseEntry(entry({
      boardId: PROYECTOS_SUB_BOARD_ID,
      data: { pulse_id: 321, column_id: 'numeric_mm1dj4fp', column_title: 'Costo Distr. C/U', textual_value: '180', previous_textual_value: '150' },
    }));
    expect(row).not.toBeNull();
    expect(row?.previousText).toBe('150');
  });

  it('el estado del producto NO entra: ya tiene su propio historial con comentario', () => {
    const row = parseEntry(entry({
      boardId: PROYECTOS_SUB_BOARD_ID,
      data: { pulse_id: 321, column_id: 'color_mm0hqf79', column_title: 'Estado del producto', textual_value: 'Entregado' },
    }));
    expect(row).toBeNull();
  });
});

// El write del portal a estas columnas se asienta directo (worker/lib/outbox.ts)
// porque Monday lo atribuiría al dueño del token de la API, no a quien editó.
// Si una columna sale de este set, el log deja de tener actor real en silencio.
describe('PORTAL_WRITE_COLUMNS — actor real en el costeo de la OC', () => {
  it('el costeo de la línea del Proyecto se registra desde el portal', () => {
    for (const col of ['numeric_mm1dj4fp', 'numeric_mm1dmsaz', 'text_mm1gdsvg',
      'numeric_mm0hj2q4', 'board_relation_mm1cfgv5', 'date_mm20xdtm']) {
      expect(isPortalWriteColumn('proyectos_sub', col), col).toBe(true);
    }
  });

  it('los boards que sí quedan bien atribuidos en Monday no pasan por ahí', () => {
    // Oportunidades y Productos siguen 100% sourced del activity_log de Monday
    // — meterlos aquí duplicaría cada cambio (el eco solo se descarta para las
    // columnas de PORTAL_WRITE_COLUMNS).
    expect(isPortalWriteColumn('oportunidades', 'deal_stage')).toBe(false);
    expect(isPortalWriteColumn('oportunidades_sub', 'numeric_mkzneg3d')).toBe(false);
    expect(isPortalWriteColumn('productos', 'numeric_mkzpx7eb')).toBe(false);
  });
});

// Regresión 2026-08-18: un vendedor dado de alta con "Actuar en Monday como"
// comparte monday_user_id con la persona prestada, y el tab Actividad firmaba
// TODAS las ediciones de ese id con el nombre del último identity que lo tuviera
// — el vendedor apareció cambiando el Precio de Venta (columna que su rol no
// puede escribir, shared/visibility.ts) de una oportunidad nativa.
describe('actorNameResolver — quién firma la actividad', () => {
  const ROSTER = [{ id: 98389537, name: 'Efrain Ponce Salinas' }];
  const IDENTITIES = [
    { email: 'jefe@cmp.com', monday_user_id: 98389537, nombre: 'Efrain Ponce Salinas' },
    { email: 'jefe.personal@gmail.com', monday_user_id: 98389537, nombre: 'Efrain Ponce Salinas' },
    { email: 'vendedor@cmp.com', monday_user_id: 98389537, nombre: 'Rodrigo' },   // id prestado
    { email: 'nativo@cmp.com', monday_user_id: -3, nombre: 'Usuario Nativo' },
  ];

  it('el correo del actor manda sobre el id compartido', () => {
    const name = actorNameResolver(ROSTER, IDENTITIES);
    expect(name({ actor_email: 'jefe@cmp.com', user_id: 98389537 })).toBe('Efrain Ponce Salinas');
    expect(name({ actor_email: 'vendedor@cmp.com', user_id: 98389537 })).toBe('Rodrigo');
  });

  it('sin correo (filas viejas) usa el roster de Monday, no el identity prestado', () => {
    const name = actorNameResolver(ROSTER, IDENTITIES);
    expect(name({ actor_email: null, user_id: 98389537 })).toBe('Efrain Ponce Salinas');
  });

  it('un id que comparten dos personas y no está en el roster se queda sin nombre', () => {
    const name = actorNameResolver([], IDENTITIES);
    expect(name({ actor_email: null, user_id: 98389537 })).toBeNull();
  });

  it('usuario nativo del portal (id sintético, único) sí se resuelve por identity', () => {
    const name = actorNameResolver(ROSTER, IDENTITIES);
    expect(name({ actor_email: null, user_id: -3 })).toBe('Usuario Nativo');
  });

  it('correo sin fila de identity se muestra tal cual, nunca el nombre de otro', () => {
    const name = actorNameResolver(ROSTER, IDENTITIES);
    expect(name({ actor_email: 'borrado@cmp.com', user_id: 98389537 })).toBe('borrado@cmp.com');
  });
});
