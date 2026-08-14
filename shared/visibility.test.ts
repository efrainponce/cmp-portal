// La whitelist es la ÚNICA defensa real de datos: worker/lib/outbox.ts:43 gatea
// cada write con canWrite(), y worker/lib/serialize.ts filtra cada lectura con
// readableCols(). Un cambio accidental aquí no lo atrapa el typecheck (todo son
// strings), así que estos tests anclan las reglas que importan.
import { describe, it, expect } from 'vitest';
import { VISIBILITY, canRead, canReadBoard, canWrite, readableCols } from './visibility';
import { COLUMN_META } from './column-meta.gen';
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

  it('ventas no ve NADA de costeo ni de proveedores (Efraín, 2026-07-30)', () => {
    // Barrido por título, no por id: si mañana se agrega una columna de costo o
    // de proveedor al grupo del vendedor, esto truena aunque el id sea nuevo.
    // (Las de venta —precio/subtotal/IVA/total/utilidad del CLIENTE— no cuentan:
    // el vendedor cotiza con ellas. Por eso el match es sobre costo/proveedor.)
    const PROHIBIDO = /(costo|proveedor|distribuidor|margen gob|utilidad|historial precios)/i;
    for (const slug of Object.keys(VISIBILITY) as BoardSlug[]) {
      for (const col of readableCols(slug, 'vendedor')) {
        const title = COLUMN_META[slug]?.[col]?.title ?? col;
        // "Etapa Costeo" / las fechas de solicitud de costeo son estados del
        // flujo, no importes: el vendedor necesita saber si ya se costeó.
        if (/^(etapa costeo|fecha (solicitud|validación) costeo|fecha solicitud validación costeo|cotizaciones sin precio)$/i.test(title)) continue;
        // Fechas de entrega del proveedor en proyectos_sub (estimada/prometida/
        // OC enviada): son CUÁNDO llega la mercancía, no quién la surte ni a
        // cuánto — el vendedor las necesita para darle fecha al cliente. Si
        // Efraín las quiere fuera también, se quitan de la whitelist y este
        // `continue` se borra.
        if (/^fecha .*proveedor/i.test(title)) continue;
        expect(PROHIBIDO.test(title), `${slug}.${col} ("${title}") es visible para vendedor`).toBe(false);
      }
    }
  });
});

describe('boards internos — el gate es de board, no solo de columnas', () => {
  // El `name` del item viaja SIEMPRE en el ItemDTO (worker/lib/serialize.ts), así
  // que filtrar columnas no basta: sin canReadBoard, un GET a
  // /api/boards/proveedores/items le devolvía al vendedor los 98 nombres de
  // proveedores con `cols: {}`. worker/routes/boards.ts responde 404 cuando esto
  // es false — para ese rol el board no existe.
  it('proveedores es invisible para ventas y almacén', () => {
    expect(canReadBoard('proveedores', 'compras')).toBe(true);
    expect(canReadBoard('proveedores', 'admin')).toBe(true);
    expect(canReadBoard('proveedores', 'vendedor')).toBe(false);
    expect(canReadBoard('proveedores', 'almacen')).toBe(false);
  });

  it('almacén solo alcanza el catálogo de Productos, ningún board de venta', () => {
    // El picker de "Nuevo movimiento" busca productos por nombre/SKU.
    expect(canReadBoard('productos', 'almacen')).toBe(true);
    expect(readableCols('productos', 'almacen').sort())
      .toEqual(['name', 'product_and_service_sku', 'text_mm0wvga2']);
    for (const slug of ['oportunidades', 'oportunidades_sub', 'proyectos', 'proyectos_sub',
      'instituciones', 'contactos', 'proveedores'] as BoardSlug[]) {
      expect(canReadBoard(slug, 'almacen'), slug).toBe(false);
    }
  });

  it('el vendedor sí alcanza todos los boards que usa el portal', () => {
    for (const slug of ['oportunidades', 'oportunidades_sub', 'proyectos', 'proyectos_sub',
      'productos', 'instituciones', 'contactos'] as BoardSlug[]) {
      expect(canReadBoard(slug, 'vendedor'), slug).toBe(true);
    }
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

describe('moneda e IVA de la línea (Efraín, 2026-07-30)', () => {
  it('la Moneda editable es la columna propia de la línea, no el espejo del catálogo', () => {
    // color_mm5s709s = "Moneda (línea)", creada 2026-07-30. lookup_mm11t8gj es
    // el MIRROR de la Moneda del producto en Productos: Monday no deja
    // escribirlo, así que si alguien le pone `w` aquí el write se aceptaría en
    // el portal y luego reventaría contra Monday.
    for (const role of ['compras', 'admin'] as Role[]) {
      expect(canWrite('oportunidades_sub', 'color_mm5s709s', role)).toBe(true);
    }
    for (const role of ['vendedor', 'almacen'] as Role[]) {
      expect(canWrite('oportunidades_sub', 'color_mm5s709s', role)).toBe(false);
    }
    for (const role of ROLES) {
      expect(canWrite('oportunidades_sub', 'lookup_mm11t8gj', role)).toBe(false);
    }
  });

  it('el IVA % lo escribe compras y lo ve el vendedor', () => {
    // numeric_mm0cg0bm alimenta Subtotal/IVA/Total c/IVA — el vendedor ya ve las
    // tres fórmulas, así que ocultarle el % no protegía nada y rompía el preview.
    expect(canRead('oportunidades_sub', 'numeric_mm0cg0bm', 'vendedor')).toBe(true);
    expect(canWrite('oportunidades_sub', 'numeric_mm0cg0bm', 'compras')).toBe(true);
    expect(canWrite('oportunidades_sub', 'numeric_mm0cg0bm', 'vendedor')).toBe(false);
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

describe('cantidad por talla — editable inline post-import (Efraín, 2026-08-05)', () => {
  it('vendedor, compras y admin corrigen la cantidad de una línea ya importada', () => {
    for (const role of ['vendedor', 'compras', 'admin'] as Role[]) {
      expect(canWrite('proyectos_sub', 'numeric_mm0hj2q4', role)).toBe(true);
    }
    expect(canWrite('proyectos_sub', 'numeric_mm0hj2q4', 'almacen')).toBe(false);
  });

  it('talla y color se quedan de solo lectura (texto libre del catálogo cmp-tallas)', () => {
    for (const col of ['text_mm1antcb', 'text_mm0h4a1c']) {
      for (const role of ROLES) {
        expect(canWrite('proyectos_sub', col, role)).toBe(false);
      }
      expect(canRead('proyectos_sub', col, 'vendedor')).toBe(true);
    }
  });
});

describe('nombre del item — renombrable desde el drawer (Efraín, 2026-08-13)', () => {
  // `name` no es una columna de Monday: viaja como pseudo-columna en el mismo
  // PATCH y worker/lib/outbox.ts la trata aparte (espejo en items.name, echo
  // contra item.name). El permiso es el normal de la whitelist, así que este es
  // el candado real de "todos pueden renombrar" y de "solo en estos 2 boards".
  it('vendedor, compras y admin renombran oportunidades y proyectos', () => {
    for (const slug of ['oportunidades', 'proyectos'] as BoardSlug[]) {
      for (const role of ['vendedor', 'compras', 'admin'] as Role[]) {
        expect(canWrite(slug, 'name', role), `${slug}/${role}`).toBe(true);
      }
      expect(canWrite(slug, 'name', 'almacen'), slug).toBe(false);
      expect(canRead(slug, 'name', 'vendedor'), slug).toBe(true);
    }
  });

  it('el resto de los boards siguen con el nombre de solo lectura', () => {
    for (const slug of ['oportunidades_sub', 'proyectos_sub', 'productos',
      'instituciones', 'contactos', 'proveedores'] as BoardSlug[]) {
      for (const role of ROLES) {
        expect(canWrite(slug, 'name', role), `${slug}/${role}`).toBe(false);
      }
    }
  });
});
