// La matemática del checkpoint del delta sync. Va con test porque es la pieza
// que falla EN SILENCIO: un checkpoint que no avanza deja el portal mudo sin
// una sola fila de error (pasó 3 días en 2026-08-14), y uno que avanza de más
// pierde cambios hasta el reconcile de 12h (2026-08-27, ventana saturada).
import { describe, it, expect } from 'vitest';
import { ordenarCola, calcularCheckpoints, agruparPorBoard } from './delta';

const OPP = 18395657596;
const LINEAS = 18395657607;
const PRODUCTOS = 18395657591;
const PRIORIDAD = new Set([OPP, LINEAS]);

// ticks de Monday = 100ns desde epoch Unix (ver ticksToIso)
const ticks = (iso: string) => String(BigInt(Date.parse(iso)) * 10000n);

describe('ordenarCola', () => {
  it('atiende el pipeline antes que los catálogos aunque sean más viejos', () => {
    const orden = ordenarCola([
      { boardId: PRODUCTOS, itemId: 1, ticks: ticks('2026-08-27T17:00:00Z') },
      { boardId: OPP, itemId: 2, ticks: ticks('2026-08-27T17:30:00Z') },
      { boardId: PRODUCTOS, itemId: 3, ticks: ticks('2026-08-27T17:10:00Z') },
    ], PRIORIDAD);
    expect(orden.map(p => p.itemId)).toEqual([2, 1, 3]);
  });

  it('dentro de cada grupo respeta el orden cronológico', () => {
    const orden = ordenarCola([
      { boardId: LINEAS, itemId: 9, ticks: ticks('2026-08-27T18:00:00Z') },
      { boardId: OPP, itemId: 8, ticks: ticks('2026-08-27T17:00:00Z') },
    ], PRIORIDAD);
    expect(orden.map(p => p.itemId)).toEqual([8, 9]);
  });
});

describe('agruparPorBoard', () => {
  it('un lote por board, en el orden en que cada board aparece en la cola', () => {
    // La cola ya viene ordenada (pipeline primero): el primer lote tiene que
    // ser el del board del primer pendiente, o los catálogos se colarían
    // antes que las oportunidades ahora que se relee por lotes.
    const cola = ordenarCola([
      { boardId: PRODUCTOS, itemId: 1, ticks: ticks('2026-09-01T17:00:00Z') },
      { boardId: OPP, itemId: 2, ticks: ticks('2026-09-01T17:30:00Z') },
      { boardId: LINEAS, itemId: 3, ticks: ticks('2026-09-01T17:20:00Z') },
      { boardId: OPP, itemId: 4, ticks: ticks('2026-09-01T17:40:00Z') },
      { boardId: PRODUCTOS, itemId: 5, ticks: ticks('2026-09-01T17:10:00Z') },
    ], PRIORIDAD);
    const lotes = agruparPorBoard(cola);
    expect(lotes.map(l => l[0]!.boardId)).toEqual([LINEAS, OPP, PRODUCTOS]);
    expect(lotes.map(l => l.map(p => p.itemId))).toEqual([[3], [2, 4], [1, 5]]);
  });

  it('cola vacía = sin lotes', () => {
    expect(agruparPorBoard([])).toEqual([]);
  });
});

describe('calcularCheckpoints', () => {
  const w = (boardId: number) => ({ boardId, from: '2026-08-27T17:00:00.000Z', to: '2026-08-27T17:20:00.000Z' });

  it('sin pendientes avanza cada board al final de SU ventana', () => {
    const cps = calcularCheckpoints([w(OPP), w(PRODUCTOS)], [], new Set());
    expect(cps.get(OPP)).toBe('2026-08-27T17:20:00.000Z');
    expect(cps.get(PRODUCTOS)).toBe('2026-08-27T17:20:00.000Z');
  });

  it('un board atrasado NO frena al que sí se atendió (el bug de las 17:31)', () => {
    // Productos se quedó con 40 items sin refetchear; Oportunidades terminó.
    const cps = calcularCheckpoints(
      [w(OPP), w(PRODUCTOS)],
      [{ boardId: PRODUCTOS, itemId: 1, ticks: ticks('2026-08-27T17:05:00Z') }],
      new Set(),
    );
    expect(cps.get(OPP)).toBe('2026-08-27T17:20:00.000Z');        // avanza igual
    expect(cps.get(PRODUCTOS)).toBe('2026-08-27T17:04:59.999Z');  // reintenta desde su pendiente
  });

  it('retrocede al primer pendiente, no al último', () => {
    const cps = calcularCheckpoints([w(OPP)], [
      { boardId: OPP, itemId: 1, ticks: ticks('2026-08-27T17:12:00Z') },
      { boardId: OPP, itemId: 2, ticks: ticks('2026-08-27T17:03:00Z') },
    ], new Set());
    expect(cps.get(OPP)).toBe('2026-08-27T17:02:59.999Z');
  });

  it('un board saturado se queda en `from`: lo truncado es lo más viejo', () => {
    // Monday devuelve los activity_logs más RECIENTES primero, así que al tocar
    // el tope de 200 lo que falta es el arranque de la ventana. Avanzar a `to`
    // ahí es perder esos eventos para siempre.
    const cps = calcularCheckpoints([w(OPP)], [], new Set([OPP]));
    expect(cps.get(OPP)).toBe('2026-08-27T17:00:00.000Z');
  });

  it('nunca retrocede antes de `from`', () => {
    const cps = calcularCheckpoints([w(OPP)], [
      { boardId: OPP, itemId: 1, ticks: ticks('2026-08-27T16:00:00Z') }, // anterior a la ventana
    ], new Set());
    expect(cps.get(OPP)).toBe('2026-08-27T17:00:00.000Z');
  });
});
