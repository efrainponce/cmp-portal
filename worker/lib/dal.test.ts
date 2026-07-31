// Scoping de renglones por viewer (worker/lib/dal.ts) — la parte pura, que es
// donde vive la decisión: qué monday_user_ids cuentan como "dueño" y qué
// predicado SQL sale de ahí. Lo cubre un test porque es autorización: un cambio
// que ensanche el scope de escritura no lo caza el typecheck (todo son números).
import { describe, it, expect } from 'vitest';
import type { Identity } from '../../shared/types';
import { ownerIdsFor, leadsOthers, scopeFor } from './dal';

const vendedor = (over: Partial<Identity> = {}): Identity => ({
  email: 'ray@mexicanadeproteccion.com',
  monday_user_id: 11,
  role: 'vendedor',
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
  it('admin y compras no llevan predicado (ven todo)', () => {
    for (const role of ['admin', 'compras'] as const) {
      expect(scopeFor('oportunidades', vendedor({ role }))).toEqual({ where: '1=1', binds: [] });
    }
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
