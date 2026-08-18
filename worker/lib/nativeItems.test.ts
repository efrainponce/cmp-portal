// Shape de las columnas de un item nativo (Zona Efrain, "salir de Monday").
// Todo aquí son strings dentro de JSON dentro de una columna TEXT de D1: el
// typecheck no cubre nada de esto, y ya costó un bug real (linked_item_ids como
// número en vez de string, 2026-08-13 — el PDF de la OC comparaba con === y
// nunca hacía match). Por eso va anclado en test.
import { describe, it, expect } from 'vitest';
import { toNativeColumns, nativeStatusValue, assertNoNativeLink } from './nativeItems';

describe('toNativeColumns', () => {
  it('board_relation guarda linked_item_ids como STRING, igual que Monday', () => {
    const [col] = toNativeColumns(
      { board_relation_mm1cfgv5: { item_ids: [12017028945] } },
      { board_relation_mm1cfgv5: 'board_relation' },
    );
    expect(JSON.parse(col.value!)).toEqual({ linked_item_ids: ['12017028945'] });
    expect(col.text).toBe('12017028945');
  });

  it('board_relation vacío no truena y queda sin ids', () => {
    const [col] = toNativeColumns({ rel: {} }, { rel: 'board_relation' });
    expect(JSON.parse(col.value!)).toEqual({ linked_item_ids: [] });
    expect(col.text).toBe('');
  });

  it('numeric y text guardan el valor como texto (el mirror siempre lee .text)', () => {
    const cols = toNativeColumns(
      { numeric_mm0hj2q4: 25, text_mm0hs17x: 'Playera piqué' },
      { numeric_mm0hj2q4: 'numeric', text_mm0hs17x: 'text' },
    );
    const byId = Object.fromEntries(cols.map(c => [c.id, c]));
    expect(byId.numeric_mm0hj2q4.text).toBe('25');
    expect(byId.numeric_mm0hj2q4.type).toBe('numeric');
    expect(byId.text_mm0hs17x.text).toBe('Playera piqué');
    expect(JSON.parse(byId.text_mm0hs17x.value!)).toBe('Playera piqué');
  });

  it('una columna sin tipo declarado cae a texto, nunca se pierde', () => {
    const [col] = toNativeColumns({ text_mm0hyrfs: 'SKU-1' }, {});
    expect(col.type).toBe('text');
    expect(col.text).toBe('SKU-1');
  });
});

describe('nativeStatusValue', () => {
  it('project_status guarda {index}, no el label — si no, el item desaparece de los grupos', () => {
    const v = nativeStatusValue('proyectos', 'project_status', 'Desglose de tallas') as { index: number };
    expect(v.index).toBe(5);
  });

  it('el label se compara sin importar mayúsculas ni espacios', () => {
    const v = nativeStatusValue('proyectos', 'project_status', '  ejecución ') as { index: number };
    expect(v.index).toBe(3);
  });

  it('un label que no existe en la metadata se guarda tal cual, sin perder la escritura', () => {
    expect(nativeStatusValue('proyectos', 'project_status', 'Etapa inventada')).toBe('Etapa inventada');
  });

  it('Etapa Costeo de una línea también resuelve su índice', () => {
    const v = nativeStatusValue('oportunidades_sub', 'color_mm084gvf', 'Listo') as { index: number };
    expect(typeof v.index).toBe('number');
  });
});

// El guard vive en createRecord.ts pero se prueba junto a lo demás nativo: es
// la regla que impide que un item REAL de Monday quede ligado a un registro que
// solo existe en el portal (Zona Efrain, 2026-08-18).
describe('assertNoNativeLink', () => {
  const NATIVO = '900000000001';
  const REAL = '12017028945';

  it('deja pasar un board_relation hacia un item real de Monday', () => {
    expect(() => assertNoNativeLink('board_relation', 'deal_contact', REAL)).not.toThrow();
  });

  it('rechaza ligar un registro nativo desde un item real', () => {
    expect(() => assertNoNativeLink('board_relation', 'deal_contact', NATIVO, 'Contacto'))
      .toThrow(/solo existe en el portal/);
  });

  it('también lo detecta en una lista con varios ids', () => {
    expect(() => assertNoNativeLink('board_relation', 'deal_contact', `${REAL},${NATIVO}`)).toThrow();
  });

  it('no aplica a columnas que no son board_relation ni a valores vacíos', () => {
    expect(() => assertNoNativeLink('text', 'text_x', NATIVO)).not.toThrow();
    expect(() => assertNoNativeLink('board_relation', 'deal_contact', '')).not.toThrow();
    expect(() => assertNoNativeLink('board_relation', 'deal_contact', undefined)).not.toThrow();
  });
});
