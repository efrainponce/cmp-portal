// toItemDTO es el único productor de ItemDTO, o sea el punto por donde sale
// TODA lectura de columnas hacia el front. La proyección `only` (?cols= en la
// ruta de listas) existe solo para no mandar 2.15 MB cuando la vista pinta 8
// columnas — es transporte, no permisos. Estos tests anclan que siga siendo
// así: que pueda quitar columnas pero jamás agregar una que el rol no puede
// leer, porque el typecheck no ve nada de esto (todo son strings).
import { describe, it, expect } from 'vitest';
import { toItemDTO, itemDetailEtag } from './serialize';
import { readableCols } from '../../shared/visibility';
import type { MirrorItem } from '../../shared/types';
import type { ItemDetailDTO } from '../../shared/dto';

/** Fila de espejo con una columna por cada id que se le pase. */
function fila(colIds: string[]): MirrorItem {
  return {
    board_id: 1,
    item_id: 42,
    name: 'OPP-0001 - Prueba',
    group_id: 'group_x',
    parent_item_id: null,
    synced_at: '2026-08-13T00:00:00.000Z',
    monday_updated_at: '2026-08-13T00:00:00Z',
    columns: JSON.stringify(colIds.map(id => ({ id, type: 'text', text: `valor de ${id}`, value: null }))),
  } as MirrorItem;
}

describe('toItemDTO — proyección de columnas', () => {
  // Columnas que un vendedor SÍ puede leer en Oportunidades; se toman de la
  // whitelist real para que el test siga los cambios de visibility.ts.
  const legibles = readableCols('oportunidades', 'vendedor');

  it('sin `only` devuelve todas las columnas legibles del rol', () => {
    const dto = toItemDTO(fila([...legibles]), 'oportunidades', 'vendedor');
    expect(Object.keys(dto.cols).sort()).toEqual([...legibles].sort());
  });

  it('`only` recorta a lo pedido', () => {
    const pedidas = legibles.slice(0, 3);
    const dto = toItemDTO(fila([...legibles]), 'oportunidades', 'vendedor', false, new Set(pedidas));
    expect(Object.keys(dto.cols).sort()).toEqual([...pedidas].sort());
  });

  it('`only` NO puede pedir una columna que el rol no puede leer', () => {
    // Una columna que existe en el board pero está fuera de lo legible para
    // vendedor: pedirla explícitamente no debe devolverla.
    const prohibidas = readableCols('oportunidades', 'admin').filter(c => !legibles.includes(c));
    // Si algún día vendedor y admin leen exactamente lo mismo, este test se
    // queda sin caso que probar y hay que revisar la whitelist, no borrarlo.
    expect(prohibidas.length, 'no hay columnas admin-only con que probar').toBeGreaterThan(0);

    const dto = toItemDTO(
      fila([...legibles, ...prohibidas]),
      'oportunidades',
      'vendedor',
      false,
      new Set([...legibles.slice(0, 2), ...prohibidas]),
    );
    for (const col of prohibidas) {
      expect(dto.cols[col], `${col} se filtró vía ?cols=`).toBeUndefined();
    }
    expect(Object.keys(dto.cols).sort()).toEqual([...legibles.slice(0, 2)].sort());
  });

  it('un `only` VACÍO significa ninguna columna, no "todas"', () => {
    // Es la diferencia entre `?cols=` ausente y `?cols=` vacío en la ruta: los
    // selectores de catálogo (Productos, Instituciones…) solo pintan `name`, un
    // campo propio del item, y piden cero columnas. Si el vacío se tratara como
    // "sin proyección" volverían a bajar el board completo (1.86 MB en
    // Productos), que es justo lo que se quería evitar.
    const dto = toItemDTO(fila([...legibles]), 'oportunidades', 'vendedor', false, new Set());
    expect(dto.cols).toEqual({});
    // …pero los campos propios del item siguen ahí: son lo que el picker pinta.
    expect(dto.name).toBe('OPP-0001 - Prueba');
    expect(dto.id).toBe('42');
  });

  it('pedir una columna inexistente no rompe ni inventa nada', () => {
    const dto = toItemDTO(fila([...legibles]), 'oportunidades', 'vendedor', false, new Set(['no_existe']));
    expect(dto.cols).toEqual({});
  });
});

describe('itemDetailEtag', () => {
  const base = (): ItemDetailDTO => ({
    id: '42',
    name: 'OPP-0001',
    syncedAt: '2026-08-13T00:00:00.000Z',
    mondayUpdatedAt: '2026-08-13T00:00:00Z',
    cols: { deal_stage: { text: 'En costeo', type: 'status' } },
  } as ItemDetailDTO);

  it('ignora syncedAt — es la razón de existir del ETag', async () => {
    // Cada ?fresh=1 reescribe synced_at aunque Monday no haya cambiado nada.
    // Si eso moviera el ETag, la relectura nunca podría contestar 304 y
    // seguiría re-mandando el cuerpo completo, que es lo que se quiso evitar.
    const a = base();
    const b = { ...base(), syncedAt: '2026-08-13T23:59:59.999Z' };
    expect(await itemDetailEtag(a)).toBe(await itemDetailEtag(b));
  });

  it('cambia cuando cambia un dato de verdad', async () => {
    const a = base();
    const b = base();
    b.cols.deal_stage = { text: 'Ganada', type: 'status' };
    expect(await itemDetailEtag(a)).not.toBe(await itemDetailEtag(b));
  });

  it('ignora syncedAt también en las líneas', async () => {
    const a = { ...base(), children: [{ ...base(), id: '99' }] } as ItemDetailDTO;
    const b = {
      ...base(),
      children: [{ ...base(), id: '99', syncedAt: '2026-08-13T23:59:59.999Z' }],
    } as ItemDetailDTO;
    expect(await itemDetailEtag(a)).toBe(await itemDetailEtag(b));
  });

  it('cambia cuando cambia una línea', async () => {
    const a = { ...base(), children: [{ ...base(), id: '99' }] } as ItemDetailDTO;
    const b = { ...base(), children: [{ ...base(), id: '99', name: 'otra cosa' }] } as ItemDetailDTO;
    expect(await itemDetailEtag(a)).not.toBe(await itemDetailEtag(b));
  });
});
