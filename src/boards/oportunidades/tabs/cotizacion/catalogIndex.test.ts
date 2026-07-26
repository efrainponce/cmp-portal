// catalogIndex reemplazó varios catalog.find() por fila/render. Estos tests
// verifican que la semántica sea IDÉNTICA a find() en los casos borde que
// importan (duplicados, ids no numéricos, mayúsculas/espacios).
import { describe, it, expect } from 'vitest';
import { catalogIndex } from './gridMeta';
import type { ItemDTO } from '../../../../../shared/dto';

const item = (id: string, name: string): ItemDTO => ({
  id, name, syncedAt: '', mondayUpdatedAt: null, cols: {},
});

describe('catalogIndex', () => {
  it('encuentra por id y por nombre normalizado', () => {
    const catalog = [item('1', 'Chaleco Cerbero IIIA'), item('2', 'Playera Táctica')];
    const idx = catalogIndex(catalog);
    expect(idx.byId.get(1)?.name).toBe('Chaleco Cerbero IIIA');
    expect(idx.byName.get('playera táctica')?.id).toBe('2');
  });

  it('normaliza espacios y mayúsculas igual que el find() original', () => {
    const catalog = [item('1', '  Chaleco Cerbero IIIA  ')];
    const idx = catalogIndex(catalog);
    expect(idx.byName.get('chaleco cerbero iiia')?.id).toBe('1');
  });

  it('ante duplicados gana el PRIMERO, como find()', () => {
    const catalog = [item('1', 'Repetido'), item('2', 'Repetido')];
    const byName = catalogIndex(catalog).byName;
    expect(byName.get('repetido')?.id).toBe('1');

    const dupId = [item('7', 'A'), item('7', 'B')];
    expect(catalogIndex(dupId).byId.get(7)?.name).toBe('A');
  });

  it('omite ids no numéricos (find() con Number(x)===NaN nunca hacía match)', () => {
    const catalog = [item('no-numerico', 'X')];
    const idx = catalogIndex(catalog);
    expect(idx.byId.get(NaN)).toBeUndefined();
    expect(idx.byId.size).toBe(0);
    expect(idx.byName.get('x')?.name).toBe('X'); // por nombre sí sigue estando
  });

  it('memoiza por referencia del array y se reconstruye si el catálogo cambia', () => {
    const catalog = [item('1', 'A')];
    expect(catalogIndex(catalog)).toBe(catalogIndex(catalog));
    expect(catalogIndex([item('1', 'A')])).not.toBe(catalogIndex(catalog));
  });

  it('catálogo vacío no truena', () => {
    expect(catalogIndex([]).byId.size).toBe(0);
  });
});
