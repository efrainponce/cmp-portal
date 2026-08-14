// Scoping de renglones por viewer (worker/lib/dal.ts) — la parte pura, que es
// donde vive la decisión: qué monday_user_ids cuentan como "dueño" y qué
// predicado SQL sale de ahí. Lo cubre un test porque es autorización: un cambio
// que ensanche el scope de escritura no lo caza el typecheck (todo son números).
import { describe, it, expect } from 'vitest';
import type { Identity, MirrorItem } from '../../shared/types';
import type { Env } from '../env';
import { ownerIdsFor, leadsOthers, scopeFor, hydrateFichaComercial } from './dal';

const vendedor = (over: Partial<Identity> = {}): Identity => ({
  email: 'ray@mexicanadeproteccion.com',
  monday_user_id: 11,
  role: 'vendedor',
  active: true,
  ...over,
});

const compras = (over: Partial<Identity> = {}): Identity => ({
  email: 'compras@mexicanadeproteccion.com',
  monday_user_id: 44,
  role: 'compras',
  active: true,
  ...over,
});

/** Rich lidera una zona con dos vendedores — así lo deja mw/identity.ts. */
const lider = vendedor({ email: 'rich@mexicanadeproteccion.com', monday_user_id: 10, scope_user_ids: [10, 22, 33] });

describe('ownerIdsFor', () => {
  it('sin zona, solo el propio id', () => {
    expect(ownerIdsFor(vendedor(), 'read')).toEqual([11]);
  });

  it('el líder lee su id + los de su zona', () => {
    expect(ownerIdsFor(lider, 'read').sort()).toEqual([10, 22, 33]);
  });

  it("escribir NUNCA mira la zona: 'own' devuelve solo el propio id", () => {
    expect(ownerIdsFor(lider, 'own')).toEqual([10]);
  });

  it('no duplica el id propio cuando ya viene en el scope', () => {
    const v = vendedor({ scope_user_ids: [11, 11, 22] });
    expect(ownerIdsFor(v, 'read')).toEqual([11, 22]);
  });

  it('scope_user_ids vacío se comporta como sin zona', () => {
    expect(ownerIdsFor(vendedor({ scope_user_ids: [] }), 'read')).toEqual([11]);
  });
});

describe('leadsOthers', () => {
  it('falso para un vendedor sin zona (evita la consulta extra de propiedad)', () => {
    expect(leadsOthers(vendedor())).toBe(false);
  });

  it('falso para un líder cuya zona quedó vacía', () => {
    expect(leadsOthers(vendedor({ scope_user_ids: [11] }))).toBe(false);
  });

  it('cierto solo cuando ve ids de alguien más', () => {
    expect(leadsOthers(lider)).toBe(true);
  });
});

describe('scopeFor', () => {
  it('admin no lleva predicado (ve todo) en cualquier board', () => {
    expect(scopeFor('oportunidades', vendedor({ role: 'admin' }))).toEqual({ where: '1=1', binds: [] });
    expect(scopeFor('proyectos', vendedor({ role: 'admin' }))).toEqual({ where: '1=1', binds: [] });
  });

  it('compras ve solo lo suyo en Oportunidades/Proyectos (columna Compras)', () => {
    const scope = scopeFor('oportunidades', compras(), 'read');
    expect(scope.binds).toEqual(['multiple_person_mm03qyw9', 44]);
    expect(scope.where).toContain('personsAndTeams');

    const scopeProyectos = scopeFor('proyectos', compras(), 'read');
    expect(scopeProyectos.binds).toEqual(['project_owner', 44]);
  });

  it('compras: los subitems se scopean por la columna Compras del PADRE', () => {
    const scope = scopeFor('oportunidades_sub', compras(), 'read');
    expect(scope.where).toContain('items.parent_item_id');
    expect(scope.binds).toEqual([expect.any(Number), 'multiple_person_mm03qyw9', 44]);
  });

  it('compras sigue viendo todo en boards sin comprasCol (catálogos)', () => {
    expect(scopeFor('productos', compras(), 'read')).toEqual({ where: '1=1', binds: [] });
    expect(scopeFor('contactos', compras(), 'read')).toEqual({ where: '1=1', binds: [] });
  });

  it('un líder lee las filas de toda su zona', () => {
    const scope = scopeFor('oportunidades', lider, 'read');
    expect(scope.binds).toEqual([10, 22, 33]);
    expect(scope.where).toContain('IN (?,?,?)');
  });

  it("en modo 'own' el mismo líder solo alcanza lo suyo", () => {
    const scope = scopeFor('oportunidades', lider, 'own');
    expect(scope.binds).toEqual([10]);
  });

  it('los subitems se scopean por el dueño del PADRE, no por el suyo', () => {
    const scope = scopeFor('oportunidades_sub', lider, 'read');
    expect(scope.where).toContain('items.parent_item_id');
    // primer bind = board de Oportunidades (el padre), luego los ids de la zona
    expect(scope.binds.slice(1)).toEqual([10, 22, 33]);
  });

  it("y en 'own' el subitem tampoco hereda la zona", () => {
    expect(scopeFor('oportunidades_sub', lider, 'own').binds.slice(1)).toEqual([10]);
  });

  it('boards sin authzCols (catálogos) siguen abiertos a todos', () => {
    expect(scopeFor('productos', lider, 'read')).toEqual({ where: '1=1', binds: [] });
  });
});

// Zona privada 'Efrain' (worker/lib/zonas.ts) — la única excepción a "admin ve
// todo". viewer.hidden_owner_ids lo resuelve mw/identity.ts; scopeFor solo lo
// consume.
describe('scopeFor: zona privada (hidden_owner_ids)', () => {
  const adminBloqueado = (over: Partial<Identity> = {}): Identity =>
    vendedor({ email: 'pam@mexicanadeproteccion.com', monday_user_id: 99, role: 'admin', hidden_owner_ids: [77], ...over });

  it('un admin sin hidden_owner_ids sigue viendo todo', () => {
    expect(scopeFor('oportunidades', adminBloqueado({ hidden_owner_ids: [] }))).toEqual({ where: '1=1', binds: [] });
  });

  it('excluye del board de Oportunidades las filas del dueño oculto', () => {
    const scope = scopeFor('oportunidades', adminBloqueado());
    expect(scope.where).toContain('NOT EXISTS');
    expect(scope.binds).toEqual([77]);
  });

  it('excluye también en el subitem, por el dueño del PADRE', () => {
    const scope = scopeFor('oportunidades_sub', adminBloqueado());
    expect(scope.where).toContain('NOT EXISTS');
    expect(scope.where).toContain('items.parent_item_id');
    expect(scope.binds).toEqual([expect.any(Number), 77]);
  });

  it('no aplica en boards fuera de la zona privada (ej. productos)', () => {
    expect(scopeFor('productos', adminBloqueado())).toEqual({ where: '1=1', binds: [] });
  });

  it('el mismo bloqueo aplica en modo own (escritura): 404, no acceso', () => {
    const scope = scopeFor('oportunidades', adminBloqueado(), 'own');
    expect(scope.where).toContain('NOT EXISTS');
    expect(scope.binds).toEqual([77]);
  });
});

// ── hydrateFichaComercial ────────────────────────────────────────────────────
// Monday recalcula el mirror de la ficha (lookup_mm0xw8p7) asíncrono y sin
// webhook: la línea recién ligada a su producto se quedaba marcada "Falta
// descripción" y bloqueada para costeo aunque el catálogo SÍ la trae. El
// relleno es la red de seguridad y vale un test porque es un GATE (Efraín,
// 2026-08-14).
describe('hydrateFichaComercial', () => {
  const SUB_FICHA = 'lookup_mm0xw8p7';
  const SUB_REL = 'board_relation_mkzmafgp';
  const PRODUCTO_FICHA = 'long_text_mm0xse7v';

  const linea = (cols: { id: string; text?: string | null; value?: string | null }[]): MirrorItem =>
    ({ item_id: 1, columns: JSON.stringify(cols) } as unknown as MirrorItem);

  const relCol = (productoId: number) => ({ id: SUB_REL, value: JSON.stringify({ linked_item_ids: [productoId] }) });

  /** env.DB mínimo: devuelve los productos pedidos, y cuenta las consultas. */
  const fakeEnv = (productos: { item_id: number; ficha: string }[]) => {
    const stats = { queries: 0 };
    const results = productos.map(p => ({
      item_id: p.item_id,
      columns: JSON.stringify([{ id: PRODUCTO_FICHA, text: p.ficha }]),
    }));
    const env = {
      DB: {
        prepare: () => {
          stats.queries++;
          return { bind: () => ({ all: async () => ({ results }) }) };
        },
      },
    } as unknown as Env;
    return { env, stats };
  };

  it('rellena la ficha desde el producto ligado cuando el mirror viene vacío', async () => {
    const { env } = fakeEnv([{ item_id: 500, ficha: 'Bota táctica FAST TAC de 6"' }]);
    const lineas = [linea([relCol(500), { id: SUB_FICHA, text: '' }])];
    await hydrateFichaComercial(env, lineas);
    const cols: { id: string; text?: string }[] = JSON.parse(lineas[0].columns);
    expect(cols.find(c => c.id === SUB_FICHA)?.text).toBe('Bota táctica FAST TAC de 6"');
  });

  it('no toca la línea cuando el mirror ya trae la ficha (ni consulta D1)', async () => {
    const { env, stats } = fakeEnv([{ item_id: 500, ficha: 'del catálogo' }]);
    const lineas = [linea([relCol(500), { id: SUB_FICHA, text: 'del mirror' }])];
    await hydrateFichaComercial(env, lineas);
    expect(JSON.parse(lineas[0].columns).find((c: { id: string }) => c.id === SUB_FICHA).text).toBe('del mirror');
    expect(stats.queries).toBe(0);
  });

  it('sin producto ligado no inventa nada: la línea sigue sin ficha', async () => {
    const { env, stats } = fakeEnv([]);
    const lineas = [linea([{ id: SUB_FICHA, text: '' }])];
    await hydrateFichaComercial(env, lineas);
    expect(JSON.parse(lineas[0].columns).find((c: { id: string }) => c.id === SUB_FICHA).text).toBe('');
    expect(stats.queries).toBe(0);
  });

  it('producto sin descripción en el catálogo: sigue faltando (el aviso es real)', async () => {
    const { env } = fakeEnv([{ item_id: 500, ficha: '' }]);
    const lineas = [linea([relCol(500), { id: SUB_FICHA, text: '' }])];
    await hydrateFichaComercial(env, lineas);
    expect(JSON.parse(lineas[0].columns).find((c: { id: string }) => c.id === SUB_FICHA).text).toBe('');
  });

  it('varias líneas del mismo producto: una sola consulta a D1', async () => {
    const { env, stats } = fakeEnv([{ item_id: 500, ficha: 'ficha' }]);
    const lineas = [
      linea([relCol(500), { id: SUB_FICHA, text: '' }]),
      linea([relCol(500)]),
    ];
    await hydrateFichaComercial(env, lineas);
    expect(stats.queries).toBe(1);
    for (const l of lineas) {
      expect(JSON.parse(l.columns).find((c: { id: string }) => c.id === SUB_FICHA).text).toBe('ficha');
    }
  });
});
