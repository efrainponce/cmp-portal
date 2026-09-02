// La fusión del poll incremental (usePoll + ?since=). Va con test porque su
// falla es silenciosa: un renglón viejo que se queda en pantalla, un borrado
// que no desaparece, o un memo roto por un objeto nuevo que no hacía falta.
import { describe, it, expect } from 'vitest';
import { fusionarIncremental, marcaDeAgua } from './api';
import type { ItemDTO, ListResponse } from '../../shared/dto';

const item = (id: string, syncedAt: string, extra: Partial<ItemDTO> = {}): ItemDTO => ({
  id, name: 'OPP ' + id, syncedAt, mondayUpdatedAt: null, cols: {}, ...extra,
});

const lista = (items: ItemDTO[], extra: Partial<ListResponse> = {}): ListResponse => ({
  board: 'oportunidades', items, total: items.length, etag: 'e', ...extra,
});

describe('fusionarIncremental', () => {
  const prev = lista([item('1', '2026-09-02T10:00:00Z'), item('2', '2026-09-02T10:00:00Z'), item('3', '2026-09-02T10:00:00Z')]);

  it('conserva la IDENTIDAD de los renglones que no cambiaron y toma los nuevos', () => {
    const cambiado = item('2', '2026-09-02T10:05:00Z', { name: 'renombrado' });
    const out = fusionarIncremental(prev, lista([cambiado], {
      etag: 'e2', total: 3, incremental: { since: 'x', ids: ['2', '1', '3'], pendingIds: [] },
    }))!;
    expect(out.items.map(i => i.id)).toEqual(['2', '1', '3']); // orden del server
    expect(out.items[1]).toBe(prev.items[0]); // mismo objeto → memo intacto
    expect(out.items[0]).toBe(cambiado);
    expect(out.etag).toBe('e2');
  });

  it('un id que ya no viene en `ids` desaparece (borrado en Monday)', () => {
    const out = fusionarIncremental(prev, lista([], { incremental: { since: 'x', ids: ['1', '3'], pendingIds: [] } }))!;
    expect(out.items.map(i => i.id)).toEqual(['1', '3']);
  });

  it('un id desconocido que tampoco vino en items → null (pedir la lista completa)', () => {
    expect(fusionarIncremental(prev, lista([], { incremental: { since: 'x', ids: ['1', '9'], pendingIds: [] } }))).toBeNull();
  });

  it('pendingWrite se re-aplica desde pendingIds sin tocar los demás objetos', () => {
    const conPend = lista([item('1', '2026-09-02T10:00:00Z', { pendingWrite: true }), item('2', '2026-09-02T10:00:00Z')]);
    const out = fusionarIncremental(conPend, lista([], { incremental: { since: 'x', ids: ['1', '2'], pendingIds: ['2'] } }))!;
    expect(out.items[0]!.pendingWrite).toBe(false);
    expect(out.items[1]!.pendingWrite).toBe(true);
    expect(out.items[0]).not.toBe(conPend.items[0]); // sí cambió el flag
  });

  const t1 = { lineas: 2, subtotal: 100, total: 116 };
  const conTotales = lista(prev.items, { totalesVersion: '10.a', totales: { '1': t1, '2': { lineas: 1, subtotal: 5, total: 5.8 }, '3': { lineas: 1, subtotal: 1, total: 1 } } });

  it('totales completo: reemplaza, conservando el objeto de la que no cambió', () => {
    const out = fusionarIncremental(conTotales, lista([], {
      totalesVersion: '11.b',
      totales: { '1': { lineas: 2, subtotal: 100, total: 116 }, '2': { lineas: 1, subtotal: 9, total: 10.44 } },
      incremental: { since: 'x', ids: ['1', '2', '3'], pendingIds: [], totales: 'completo' },
    }))!;
    expect(out.totales!['1']).toBe(t1);
    expect(out.totales!['2']!.subtotal).toBe(9);
    expect(out.totales!['3']).toBeUndefined(); // completo = lo que vino, nada más
    expect(out.totalesVersion).toBe('11.b');
  });

  it('totales parcial: los de antes con los nuevos encima', () => {
    const out = fusionarIncremental(conTotales, lista([], {
      totalesVersion: '10.c',
      totales: { '2': { lineas: 1, subtotal: 9, total: 10.44 } },
      incremental: { since: 'x', ids: ['1', '2', '3'], pendingIds: [], totales: 'parcial' },
    }))!;
    expect(out.totales!['1']).toBe(t1);
    expect(out.totales!['2']!.subtotal).toBe(9);
    expect(out.totales!['3']).toBe(conTotales.totales!['3']);
  });

  it('totales igual: se quedan los de antes y su versión', () => {
    const out = fusionarIncremental(conTotales, lista([], {
      incremental: { since: 'x', ids: ['1', '2', '3'], pendingIds: [], totales: 'igual' },
    }))!;
    expect(out.totales).toBe(conTotales.totales);
    expect(out.totalesVersion).toBe('10.a');
  });

  it('sin `incremental` devuelve la respuesta tal cual (lista completa)', () => {
    const completa = lista([item('7', '2026-09-02T11:00:00Z')]);
    expect(fusionarIncremental(prev, completa)).toBe(completa);
  });
});

describe('marcaDeAgua', () => {
  it('es el syncedAt más reciente de la lista', () => {
    expect(marcaDeAgua([item('1', '2026-09-02T10:00:00Z'), item('2', '2026-09-02T12:00:00Z'), item('3', '2026-09-02T11:00:00Z')]))
      .toBe('2026-09-02T12:00:00Z');
    expect(marcaDeAgua([])).toBeUndefined();
  });
});
