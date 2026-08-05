import { describe, it, expect } from 'vitest';
import { batteryFromSubitems, batteryFromMirrorText, ESTADO_BUCKETS } from './estadoProductoBuckets';

describe('batteryFromSubitems', () => {
  it('pondera por cantidad, no por número de líneas', () => {
    const b = batteryFromSubitems([
      { estado: 'Entregado', cantidad: 300 },
      { estado: 'En tránsito', cantidad: 100 },
      { estado: 'Pendiente OC al Prov', cantidad: 100 },
    ]);
    expect(b.total).toBe(500);
    const entregado = b.segments.find(s => s.bucket.key === 'entregado')!;
    expect(entregado.weight).toBe(300);
    expect(entregado.pct).toBe(60);
  });

  it('agrupa varios labels crudos en el mismo bucket visual', () => {
    const b = batteryFromSubitems([
      { estado: 'En CMP para embellecer', cantidad: 40 },
      { estado: 'En embellecimiento', cantidad: 60 },
    ]);
    const embellecimiento = b.segments.find(s => s.bucket.key === 'embellecimiento')!;
    expect(embellecimiento.weight).toBe(100);
    expect(b.total).toBe(100);
  });

  it('cuenta Incidencia/Retraso como su propio bucket, no lo descarta', () => {
    const b = batteryFromSubitems([
      { estado: 'Entregado', cantidad: 90 },
      { estado: 'Incidencia/Retraso', cantidad: 10 },
    ]);
    expect(b.total).toBe(100);
    expect(b.incidencias).toBe(10);
  });

  it('ignora filas sin estado o con cantidad <= 0', () => {
    const b = batteryFromSubitems([
      { estado: undefined, cantidad: 50 },
      { estado: 'Entregado', cantidad: 0 },
      { estado: 'Entregado', cantidad: 5 },
    ]);
    expect(b.total).toBe(5);
  });

  it('vacío cuando no hay filas', () => {
    const b = batteryFromSubitems([]);
    expect(b.total).toBe(0);
    expect(b.incidencias).toBe(0);
    expect(b.segments).toHaveLength(ESTADO_BUCKETS.length);
    expect(b.segments.every(s => s.weight === 0)).toBe(true);
  });
});

describe('batteryFromMirrorText', () => {
  it('pondera por número de líneas (un label por subitem, comma-joined)', () => {
    const b = batteryFromMirrorText('Entregado, Entregado, En tránsito');
    const entregado = b.segments.find(s => s.bucket.key === 'entregado')!;
    expect(entregado.weight).toBe(2);
    expect(b.total).toBe(3);
  });

  it('vacío/undefined no truena', () => {
    expect(batteryFromMirrorText(undefined).total).toBe(0);
    expect(batteryFromMirrorText('').total).toBe(0);
    expect(batteryFromMirrorText('   ').total).toBe(0);
  });
});
