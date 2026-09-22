// Scoping de renglones por viewer (worker/lib/dal.ts) — la parte pura, que es
// donde vive la decisión: qué monday_user_ids cuentan como "dueño" y qué
// predicado SQL sale de ahí. Lo cubre un test porque es autorización: un cambio
// que ensanche el scope de escritura no lo caza el typecheck (todo son números).
import { describe, it, expect } from 'vitest';
import type { Identity } from '../../shared/types';
import { ownerIdsFor, leadsOthers, scopeFor, SEARCHABLE_COLS } from './dal';

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
/** Paola es AUXILIAR de la zona de Rich (Efraín, 2026-09-15): lee lo mismo que
 * él (miembros + el líder) y además lo escribe — write_user_ids lo trae
 * zonas.resolveZonaScope. */
const auxiliar = vendedor({
  email: 'cdmx.administracion@mexicanadeproteccion.com', monday_user_id: 44,
  scope_user_ids: [44, 10, 22, 33], write_user_ids: [44, 10, 22, 33],
});

describe('ownerIdsFor', () => {
  it('sin zona, solo el propio id', () => {
    expect(ownerIdsFor(vendedor(), 'read')).toEqual([11]);
  });

  it('el líder lee su id + los de su zona', () => {
    expect(ownerIdsFor(lider, 'read').sort()).toEqual([10, 22, 33]);
  });

  it("sin write_user_ids, 'own' devuelve solo el propio id (scope_user_ids no da escritura)", () => {
    expect(ownerIdsFor(lider, 'own')).toEqual([10]);
  });

  it("con write_user_ids (líder o auxiliar desde 2026-09-15): 'own' trae la zona", () => {
    expect(ownerIdsFor(auxiliar, 'own').sort()).toEqual([10, 22, 33, 44]);
    expect(ownerIdsFor(auxiliar, 'read').sort()).toEqual([10, 22, 33, 44]);
  });

  it("'own' solo mira write_user_ids, nunca scope_user_ids (un líder con scope amplio sigue sin escribir)", () => {
    const soloLee = vendedor({ scope_user_ids: [11, 55], write_user_ids: [] });
    expect(ownerIdsFor(soloLee, 'own')).toEqual([11]);
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

  it('compras LEE a todo el equipo en Oportunidades/Proyectos (Efraín, 2026-09-21)', () => {
    for (const slug of ['oportunidades', 'oportunidades_sub', 'proyectos', 'proyectos_sub'] as const) {
      expect(scopeFor(slug, compras(), 'read')).toEqual({ where: '1=1', binds: [] });
    }
  });

  it('compras ESCRIBE solo donde es Responsable compras (columna Compras)', () => {
    const scope = scopeFor('oportunidades', compras(), 'own');
    expect(scope.binds).toEqual(['multiple_person_mm03qyw9', 44]);
    expect(scope.where).toContain('personsAndTeams');

    expect(scopeFor('proyectos', compras(), 'own').binds).toEqual(['project_owner', 44]);

    const sub = scopeFor('oportunidades_sub', compras(), 'own');
    expect(sub.where).toContain('items.parent_item_id');
    expect(sub.binds).toEqual([expect.any(Number), 'multiple_person_mm03qyw9', 44]);
  });

  it('compras no lee la zona privada, salvo donde es Responsable compras', () => {
    const scope = scopeFor('oportunidades', compras({ hidden_owner_ids: [77, 88] }), 'read');
    expect(scope.where).toContain('NOT EXISTS');
    expect(scope.where).toContain('personsAndTeams');
    expect(scope.binds).toEqual([77, 88, 'multiple_person_mm03qyw9', 44]);

    const sub = scopeFor('oportunidades_sub', compras({ hidden_owner_ids: [77] }), 'read');
    expect(sub.binds).toEqual([expect.any(Number), 77, expect.any(Number), 'multiple_person_mm03qyw9', 44]);
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

  it("un auxiliar de zona escribe ('own') la zona entera, también en los subitems", () => {
    expect(scopeFor('oportunidades', auxiliar, 'own').binds).toEqual([44, 10, 22, 33]);
    expect(scopeFor('proyectos_sub', auxiliar, 'own').binds.slice(1)).toEqual([44, 10, 22, 33]);
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


// El buscador de la lista arma su propio haystack en el cliente, pero el server
// ya filtró antes: una columna fuera de esta lista es una búsqueda que devuelve
// cero sin explicación. Pasó con el folio de Proyectos — "PRO-0066" no
// encontraba nada (Efraín, 2026-08-26).
describe('SEARCHABLE_COLS', () => {
  it('cubre el folio de LOS DOS boards con folio', () => {
    expect(SEARCHABLE_COLS).toContain('pulse_id_mm0qcq0m'); // Oportunidades
    expect(SEARCHABLE_COLS).toContain('pulse_id_mm1a12gy'); // Proyectos
  });

  it('cubre Institución en los dos (lookup distinto por board)', () => {
    expect(SEARCHABLE_COLS).toContain('lookup_mm1bs976');  // Oportunidades
    expect(SEARCHABLE_COLS).toContain('lookup_mm1dwn6');   // Proyectos
  });

  it('todos los ids son inertes para el SQL (van inline, no como bind)', () => {
    for (const id of SEARCHABLE_COLS) expect(id).toMatch(/^[a-z0-9_]+$/);
  });
});
