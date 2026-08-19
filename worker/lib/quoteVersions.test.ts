// El versionado automático dejó de tirar el costeo de las líneas que nadie tocó
// (Efraín, 2026-08-19: "no podemos perder toda la info"). Lo que se puede
// probar sin D1 ni Monday son las dos decisiones puras que lo gobiernan: a qué
// líneas se les borra la Etapa Costeo, y cuándo la cotización ya cuenta como
// "en revisión" (que es lo que evita apilar una versión por cada tecleo y lo
// que reactiva "Mandar a costeo").
import { describe, it, expect } from 'vitest';
import { lineasAResetear, esDraftVigente, hayLineaPendiente } from './quoteVersions';
import type { QuoteLineSnapshot } from '../../shared/dto';
import type { MirrorItem } from '../../shared/types';

const linea = (subitemId: number, etapaCosteo?: string): QuoteLineSnapshot => ({
  subitemId, producto: `P${subitemId}`, color: 'NEGRO', cantidad: 10,
  embellecimiento: false, precioUnitario: 100, etapaCosteo,
});

// Fila del espejo tal como la lee colsOf(): columns es el JSON crudo de Monday.
const fila = (etapa?: string): MirrorItem => ({
  columns: JSON.stringify(etapa ? [{ id: 'color_mm084gvf', type: 'status', text: etapa, value: '' }] : []),
} as MirrorItem);

describe('lineasAResetear', () => {
  const vigente = [linea(1, 'Listo'), linea(2, 'Listo'), linea(3, 'No iniciado'), linea(4, 'En curso')];

  it('"+ Nueva versión" explícito sigue mandando TODA la cotización a costeo', () => {
    expect(lineasAResetear(vigente, 'todas')).toEqual([1, 2, 4]);
  });

  it('el versionado automático solo descostea la línea que cambió', () => {
    // Este es el bug que Efraín mandó resolver: editar el color de la línea 2
    // dejaba las 4 en "No iniciado" y Compras tenía que recostear todo.
    expect(lineasAResetear(vigente, [2])).toEqual([2]);
  });

  it('borrar o agregar una línea no descostea ninguna (lista vacía)', () => {
    expect(lineasAResetear(vigente, [])).toEqual([]);
  });

  it('no reescribe una línea que ya estaba pendiente ni una sin id', () => {
    expect(lineasAResetear(vigente, [3])).toEqual([]);
    expect(lineasAResetear([{ ...linea(9, 'Listo'), subitemId: undefined }], 'todas')).toEqual([]);
  });
});

describe('esDraftVigente vs hayLineaPendiente', () => {
  it('borrador = TODAS pendientes; pendiente = con que haya UNA', () => {
    const mixta = [fila('Listo'), fila('No iniciado')];
    expect(esDraftVigente(mixta)).toBe(false);
    expect(hayLineaPendiente(mixta)).toBe(true);
  });

  it('una vigente enteramente costeada no tiene nada pendiente', () => {
    const costeada = [fila('Listo'), fila('En curso')];
    expect(hayLineaPendiente(costeada)).toBe(false);
    expect(esDraftVigente(costeada)).toBe(false);
  });

  it('la Etapa Costeo vacía cuenta como pendiente (líneas recién creadas)', () => {
    expect(hayLineaPendiente([fila()])).toBe(true);
    expect(esDraftVigente([fila(), fila('No iniciado')])).toBe(true);
  });

  it('sin líneas no hay borrador ni pendientes', () => {
    expect(esDraftVigente([])).toBe(false);
    expect(hayLineaPendiente([])).toBe(false);
  });
});
