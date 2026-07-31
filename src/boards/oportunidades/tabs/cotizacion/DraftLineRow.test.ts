// isDraftComplete es el gate que decide cuándo una línea nueva por fin manda
// algo a Monday (ver DraftLineRow.tsx) — si se relaja de más, vuelve el bug
// original (crear con datos a medias); si se pone de más estricto, un
// producto sin colores configurados en el catálogo se queda pegado para
// siempre sin poder crear la línea.
import { describe, it, expect } from 'vitest';
import { isDraftComplete, draftColorOptions, emptyDraftLine, draftProductoNombre, type DraftLine } from './DraftLineRow';
import { PRODUCTO_COLOR_DROPDOWN_COL } from './gridMeta';
import type { ItemDTO } from '../../../../../shared/dto';

const catalogItem = (id: string, name: string, colores?: string): ItemDTO => ({
  id, name, syncedAt: '', mondayUpdatedAt: null,
  cols: colores ? { [PRODUCTO_COLOR_DROPDOWN_COL]: { text: colores, type: 'dropdown' } } : {},
});

describe('draftProductoNombre', () => {
  it('sin choice -> vacío', () => {
    expect(draftProductoNombre(emptyDraftLine('k'))).toBe('');
  });
  it('catálogo -> nombre del item; texto libre -> el texto', () => {
    const conItem: DraftLine = { ...emptyDraftLine('k'), choice: { item: catalogItem('1', 'Chaleco') } };
    expect(draftProductoNombre(conItem)).toBe('Chaleco');
    const conTexto: DraftLine = { ...emptyDraftLine('k'), choice: { freeText: '  Fuera de catálogo  ' } };
    expect(draftProductoNombre(conTexto)).toBe('Fuera de catálogo');
  });
});

describe('draftColorOptions', () => {
  it('texto libre o sin choice -> sin colores', () => {
    expect(draftColorOptions(undefined, [])).toEqual([]);
    expect(draftColorOptions({ freeText: 'x' }, [])).toEqual([]);
  });
  it('catálogo con colores configurados -> la lista, separada y sin vacíos', () => {
    const catalog = [catalogItem('1', 'Chaleco', 'Negro, Verde,  Azul ,')];
    expect(draftColorOptions({ item: catalogItem('1', 'Chaleco') }, catalog)).toEqual(['Negro', 'Verde', 'Azul']);
  });
  it('catálogo sin colores configurados -> vacío', () => {
    const catalog = [catalogItem('1', 'Chaleco')];
    expect(draftColorOptions({ item: catalogItem('1', 'Chaleco') }, catalog)).toEqual([]);
  });
});

describe('isDraftComplete', () => {
  const catalogConColor = [catalogItem('1', 'Chaleco', 'Negro, Verde')];
  const catalogSinColor = [catalogItem('2', 'Playera')];

  it('sin producto -> incompleto', () => {
    expect(isDraftComplete({ ...emptyDraftLine('k'), cantidad: '5' }, catalogConColor)).toBe(false);
  });
  it('cantidad vacía, cero o negativa -> incompleto', () => {
    const base: DraftLine = { ...emptyDraftLine('k'), choice: { item: catalogSinColor[0] } };
    expect(isDraftComplete({ ...base, cantidad: '' }, catalogSinColor)).toBe(false);
    expect(isDraftComplete({ ...base, cantidad: '0' }, catalogSinColor)).toBe(false);
    expect(isDraftComplete({ ...base, cantidad: '-1' }, catalogSinColor)).toBe(false);
  });
  it('producto con colores configurados exige color elegido', () => {
    const base: DraftLine = { ...emptyDraftLine('k'), choice: { item: catalogConColor[0] }, cantidad: '3' };
    expect(isDraftComplete({ ...base, color: '' }, catalogConColor)).toBe(false);
    expect(isDraftComplete({ ...base, color: 'Negro' }, catalogConColor)).toBe(true);
  });
  it('producto SIN colores configurados no exige color (si no, la línea nunca podría crearse)', () => {
    const base: DraftLine = { ...emptyDraftLine('k'), choice: { item: catalogSinColor[0] }, cantidad: '3', color: '' };
    expect(isDraftComplete(base, catalogSinColor)).toBe(true);
  });
  it('texto libre (fuera de catálogo) + cantidad ya es suficiente', () => {
    const draft: DraftLine = { ...emptyDraftLine('k'), choice: { freeText: 'Producto nuevo' }, cantidad: '2' };
    expect(isDraftComplete(draft, [])).toBe(true);
  });
  it('mientras saving o con error, sigue siendo "completo" (isDraftComplete no mira esos flags)', () => {
    const draft: DraftLine = {
      key: 'k', choice: { item: catalogSinColor[0] }, color: '', cantidad: '1', saving: true,
    };
    expect(isDraftComplete(draft, catalogSinColor)).toBe(true);
  });
});
