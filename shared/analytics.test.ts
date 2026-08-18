// El tablero de Análisis se alimenta de JSON crudo del mirror: todo son strings
// y el typecheck no ve nada. Lo que se ancla aquí son las decisiones que
// cambiarían un número en pantalla sin que nadie se entere — la monotonía del
// embudo, qué etapa prueba qué hito, y qué se descarta del tiempo de costeo.
import { describe, it, expect } from 'vitest';
import {
  alcanzo, calcEmbudo, calcTiempoCosteo, calcConversion, calcHuecos, agrupar,
  horasEntre, buildAnalytics, SIN_DATO, type OppRow,
} from './analytics';

const base: OppRow = {
  itemId: 1, name: 'Opp', creada: '2026-07-01T00:00:00Z',
  solCosteo: null, valCosteo: null, cotizada: null,
  etapa: 'Nueva oportunidad', zona: 'Centro', vendedor: 'Ray', monto: 1000, utilidad: 100,
};
const opp = (over: Partial<OppRow>): OppRow => ({ ...base, ...over });

describe('alcanzo — el embudo nunca se ensancha', () => {
  it('un hito posterior prueba el anterior aunque falte su fecha', () => {
    // Caso real del mirror: Sureste tenía 86 validados contra 80 solicitudes.
    const r = opp({ valCosteo: '2026-07-10T00:00:00Z', solCosteo: null });
    expect(alcanzo(r, 'costeo')).toBe(true);
    expect(alcanzo(r, 'validado')).toBe(true);
  });

  it('cada escalón alcanzado implica todos los anteriores', () => {
    const rows = [
      opp({ cotizada: '2026-07-20T00:00:00Z' }),
      opp({ etapa: 'Ganada' }),
      opp({ etapa: 'Esperando OC' }),
      opp({ valCosteo: '2026-07-10T00:00:00Z' }),
    ];
    const e = calcEmbudo(rows);
    for (let i = 1; i < e.length; i++) expect(e[i].n).toBeLessThanOrEqual(e[i - 1].n);
  });

  it('Perdida y Cancelada NO prueban recorrido: se puede perder recién creada', () => {
    for (const etapa of ['Perdida', 'Cancelada']) {
      const r = opp({ etapa });
      expect(alcanzo(r, 'costeo')).toBe(false);
      expect(alcanzo(r, 'cotizada')).toBe(false);
    }
  });

  it('una perdida CON fechas sí cuenta hasta donde llegó', () => {
    const r = opp({ etapa: 'Perdida', solCosteo: '2026-07-01T00:00:00Z' });
    expect(alcanzo(r, 'costeo')).toBe(true);
    expect(alcanzo(r, 'validado')).toBe(false);
  });

  it('Ganada implica haber cotizado', () => {
    expect(alcanzo(opp({ etapa: 'Ganada' }), 'cotizada')).toBe(true);
    expect(alcanzo(opp({ etapa: 'Ganada' }), 'ganada')).toBe(true);
  });

  it('estar En costeo cuenta como mandada a costeo aunque no haya fecha', () => {
    const r = opp({ etapa: 'En costeo' });
    expect(alcanzo(r, 'costeo')).toBe(true);
    expect(alcanzo(r, 'validado')).toBe(false);
  });
});

describe('tiempo de costeo', () => {
  it('mide en horas, no en días: mismo día no es cero', () => {
    expect(horasEntre('2026-07-01T09:00:00Z', '2026-07-01T15:00:00Z')).toBe(6);
  });

  it('la mediana ignora el outlier que sí mueve el promedio', () => {
    const rows = [24, 24, 24, 24, 2400].map((h, i) => opp({
      itemId: i, solCosteo: '2026-07-01T00:00:00Z',
      valCosteo: new Date(Date.parse('2026-07-01T00:00:00Z') + h * 3_600_000).toISOString(),
    }));
    const t = calcTiempoCosteo(rows);
    expect(t.medianaHoras).toBe(24);
    expect(t.promedioHoras).toBeGreaterThan(400);
    expect(t.n).toBe(5);
  });

  it('descarta fechas invertidas y las reporta', () => {
    const t = calcTiempoCosteo([
      opp({ solCosteo: '2026-07-10T00:00:00Z', valCosteo: '2026-07-01T00:00:00Z' }),
    ]);
    expect(t.n).toBe(0);
    expect(t.descartadas).toBe(1);
  });

  it('una oportunidad que nunca fue a costeo no es un descarte', () => {
    const t = calcTiempoCosteo([opp({})]);
    expect(t.descartadas).toBe(0);
    expect(t.medianaHoras).toBeNull();
  });
});

describe('conversión', () => {
  it('sin cerradas la tasa es null, no 0%', () => {
    const c = calcConversion([opp({ etapa: 'En costeo' })]);
    expect(c.tasaCierre).toBeNull();
    expect(c.abiertas).toBe(1);
  });

  it('cancelada cuenta como cerrada no ganada, en piezas y en dinero', () => {
    const c = calcConversion([
      opp({ etapa: 'Ganada', monto: 300 }),
      opp({ etapa: 'Perdida', monto: 100 }),
      opp({ etapa: 'Cancelada', monto: 200 }),
    ]);
    expect(c.cerradas).toBe(3);
    expect(c.tasaCierre).toBeCloseTo(1 / 3);
    expect(c.montoPerdido).toBe(300);
    expect(c.tasaCierreMonto).toBeCloseTo(0.5);
  });
});

describe('agrupar', () => {
  it('lo que no tiene zona cae en un grupo propio, no se reparte ni se tira', () => {
    const grupos = agrupar([opp({ zona: null }), opp({ zona: '  ' }), opp({ zona: 'Centro' })], 'zona');
    expect(grupos.map(g => g.clave).sort()).toEqual([SIN_DATO, 'Centro'].sort());
    expect(grupos.find(g => g.clave === SIN_DATO)!.creadas).toBe(2);
  });

  it('ninguna oportunidad se pierde al agrupar', () => {
    const rows = [opp({ zona: 'Centro' }), opp({ zona: null }), opp({ zona: 'Sur' })];
    const total = agrupar(rows, 'zona').reduce((acc, g) => acc + g.creadas, 0);
    expect(total).toBe(rows.length);
  });
});

describe('huecos', () => {
  it('detecta cada caso sucio y trae los items para arreglarlos', () => {
    const rows = [
      opp({ itemId: 10, zona: null }),
      opp({ itemId: 11, valCosteo: '2026-07-05T00:00:00Z' }),
      opp({ itemId: 12, solCosteo: '2026-07-10T00:00:00Z', valCosteo: '2026-07-01T00:00:00Z' }),
      opp({ itemId: 13, monto: null, cotizada: '2026-07-08T00:00:00Z' }),
    ];
    const kinds = calcHuecos(rows).map(h => h.kind);
    expect(kinds).toContain('sin_zona');
    expect(kinds).toContain('validado_sin_solicitud');
    expect(kinds).toContain('fechas_invertidas');
    expect(kinds).toContain('sin_monto');
    const sinZona = calcHuecos(rows).find(h => h.kind === 'sin_zona')!;
    expect(sinZona.items[0].itemId).toBe(10);
  });

  it('una oportunidad nueva sin monto no es un hueco: todavía no se cotiza', () => {
    const nueva = opp({ etapa: 'Nueva oportunidad', monto: null });
    expect(calcHuecos([nueva]).map(h => h.kind)).not.toContain('sin_monto');
  });

  it('marca los registros de prueba pero NO los saca de los números', () => {
    const rows = [
      opp({ itemId: 20, name: 'OPP-0525 - TEST EFRAIN 1', etapa: 'Ganada' }),
      opp({ itemId: 21, name: 'ZZ-TEST tagging actualizaciones (borrar)' }),
      opp({ itemId: 22, name: 'STRESS 2026-07-21 15:39 SMOKE' }),
      opp({ itemId: 23, name: 'OPP-0509 - CAMARA Y BALISTICA CLIENTE QUINTANA ROO (copia)' }),
      opp({ itemId: 24, name: 'OPP-0612 - UNIFORME SERVICIOS PUBLICOS' }),
    ];
    const prueba = calcHuecos(rows).find(h => h.kind === 'parece_prueba')!;
    expect(prueba.n).toBe(3);
    // Duplicar es un flujo real del portal: una copia no es una prueba.
    expect(prueba.items.map(i => i.itemId)).not.toContain(23);
    expect(prueba.items.map(i => i.itemId)).not.toContain(24);
    // Y siguen contando: el tablero las reporta, no las esconde.
    expect(calcConversion(rows).ganadas).toBe(1);
    expect(calcEmbudo(rows)[0].n).toBe(5);
  });

  it('sin filas sucias no inventa huecos', () => {
    const limpia = opp({
      solCosteo: '2026-07-01T00:00:00Z', valCosteo: '2026-07-03T00:00:00Z',
      cotizada: '2026-07-04T00:00:00Z', etapa: 'Cotización',
    });
    expect(calcHuecos([limpia])).toEqual([]);
  });
});

describe('buildAnalytics', () => {
  it('el total del embudo cuadra con las filas recibidas', () => {
    const rows = [opp({ itemId: 1 }), opp({ itemId: 2, etapa: 'Ganada' })];
    const r = buildAnalytics(rows, {
      por: 'zona', desde: null, hasta: null, syncedAt: null, generadoAt: '2026-08-17T00:00:00Z',
    });
    expect(r.totalOportunidades).toBe(2);
    expect(r.embudo[0].n).toBe(2);
    expect(r.conversion.ganadas).toBe(1);
    expect(r.montoPipeline).toBe(2000);
    expect(r.utilidadGanada).toBe(100);
  });
});
