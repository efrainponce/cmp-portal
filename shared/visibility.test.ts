// La whitelist es la ÚNICA defensa real de datos: worker/lib/outbox.ts:43 gatea
// cada write con canWrite(), y worker/lib/serialize.ts filtra cada lectura con
// readableCols(). Un cambio accidental aquí no lo atrapa el typecheck (todo son
// strings), así que estos tests anclan las reglas que importan.
import { describe, it, expect } from 'vitest';
import { VISIBILITY, canRead, canWrite, readableCols } from './visibility';
import type { BoardSlug } from './boards';
import type { Role } from './types';

const ROLES: Role[] = ['vendedor', 'compras', 'admin', 'almacen'];

describe('fail-closed', () => {
  it('una columna que no está en la tabla es invisible y no escribible para todos', () => {
    for (const role of ROLES) {
      expect(canRead('oportunidades', 'columna_que_no_existe', role)).toBe(false);
      expect(canWrite('oportunidades', 'columna_que_no_existe', role)).toBe(false);
    }
  });

  it('poder leer nunca implica poder escribir', () => {
    for (const slug of Object.keys(VISIBILITY) as BoardSlug[]) {
      for (const [col, rule] of Object.entries(VISIBILITY[slug])) {
        for (const role of rule.w ?? []) {
          // Toda columna escribible debe ser legible por ese mismo rol; si no,
          // el usuario escribiría a ciegas un campo que no puede ver.
          expect(canRead(slug, col, role), `${slug}.${col} escribible por ${role} pero no legible`).toBe(true);
        }
      }
    }
  });

  it('almacen no tiene acceso a ninguna columna de los boards de venta', () => {
    // El rol almacen es inventario-only (feature nativa D1, no espejada).
    for (const slug of ['oportunidades', 'oportunidades_sub'] as BoardSlug[]) {
      expect(readableCols(slug, 'almacen')).toEqual([]);
    }
  });
});

describe('costos internos', () => {
  it('el vendedor no puede leer el costo de distribuidor', () => {
    // numeric_mm0bph99 = "Costo Distr. C/U" — vis: AC (compras/admin).
    expect(canRead('oportunidades_sub', 'numeric_mm0bph99', 'vendedor')).toBe(false);
    expect(canRead('oportunidades_sub', 'numeric_mm0bph99', 'compras')).toBe(true);
    expect(canWrite('oportunidades_sub', 'numeric_mm0bph99', 'vendedor')).toBe(false);
  });

  it('readableCols del vendedor excluye toda columna marcada solo compras/admin', () => {
    const cols = readableCols('oportunidades_sub', 'vendedor');
    expect(cols).not.toContain('numeric_mm0bph99');
    expect(cols.length).toBeGreaterThan(0);
  });
});

describe('etapa y reasignación', () => {
  it('deal_stage es escribible (Ganar/Perder/Archivar del drawer)', () => {
    // Estuvo roto (403 para todo rol) hasta el stress test 2026-07-21: no tenía
    // `w` en absoluto. Si alguien lo vuelve a quitar, esto truena.
    for (const role of ['vendedor', 'compras', 'admin'] as Role[]) {
      expect(canWrite('oportunidades', 'deal_stage', role)).toBe(true);
    }
    expect(canWrite('oportunidades', 'deal_stage', 'almacen')).toBe(false);
  });
});

describe('precio de venta — solo admin escribe (Efraín, 2026-07-24)', () => {
  // numeric_mkzneg3d = "P. venta C/U". Estuvo como `w: WV` (vendedor+admin), lo
  // que dejaba al server aceptar un PATCH directo del vendedor aunque la UI no
  // pintara el campo editable. outbox.ts gatea SOLO con canWrite(), así que este
  // es el candado real: si alguien vuelve a agregar vendedor o compras, truena.
  it('ningún rol salvo admin puede escribir el precio', () => {
    expect(canWrite('oportunidades_sub', 'numeric_mkzneg3d', 'admin')).toBe(true);
    for (const role of ['vendedor', 'compras', 'almacen'] as Role[]) {
      expect(canWrite('oportunidades_sub', 'numeric_mkzneg3d', role)).toBe(false);
    }
  });

  it('el vendedor SÍ lo sigue viendo, junto con subtotal/IVA/total', () => {
    // Decisión explícita: el vendedor cotiza al cliente, necesita ver el precio
    // y los totales — lo que se cerró es la escritura, no la lectura.
    expect(canRead('oportunidades_sub', 'numeric_mkzneg3d', 'vendedor')).toBe(true);
    for (const total of ['formula_mkznmjh6', 'formula_mm0rtdqp', 'formula_mm00xy0n']) {
      expect(canRead('oportunidades_sub', total, 'vendedor')).toBe(true);
    }
  });
});

describe('condiciones de la cotización — las escribe compras (Efraín, 2026-07-30)', () => {
  // Condiciones comerciales / tiempo de entrega / vigencia: son de la cotización
  // completa (shared/quoteTerms.ts), no de una línea. Estuvieron como `w: WV`
  // (vendedor+admin) y sin UI; Efraín las pasó a compras+admin porque salen del
  // costeo. El vendedor las sigue viendo: son lo que cotiza al cliente.
  const COND = ['long_text_mm1m416j', 'text_mm0gjrrd', 'text_mm0gje0'];

  it('compras y admin escriben; vendedor y almacén no', () => {
    for (const col of COND) {
      for (const role of ['compras', 'admin'] as Role[]) {
        expect(canWrite('oportunidades', col, role)).toBe(true);
      }
      for (const role of ['vendedor', 'almacen'] as Role[]) {
        expect(canWrite('oportunidades', col, role)).toBe(false);
      }
    }
  });

  it('el vendedor las sigue leyendo', () => {
    for (const col of COND) {
      expect(canRead('oportunidades', col, 'vendedor')).toBe(true);
    }
  });
});
