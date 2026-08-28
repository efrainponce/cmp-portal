// La whitelist es la ÚNICA defensa real de datos: worker/lib/outbox.ts:43 gatea
// cada write con canWrite(), y worker/lib/serialize.ts filtra cada lectura con
// readableCols(). Un cambio accidental aquí no lo atrapa el typecheck (todo son
// strings), así que estos tests anclan las reglas que importan.
import { describe, it, expect } from 'vitest';
import { VISIBILITY, canRead, canReadActivity, canReadBoard, canWrite, readableCols, puedeEditarTechoEnValidacion, puedeVerUtilidades } from './visibility';
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

  it('la talla se queda de solo lectura (cuadra contra el desglose de tallas)', () => {
    for (const role of ROLES) {
      expect(canWrite('proyectos_sub', 'text_mm1antcb', role)).toBe(false);
    }
    expect(canRead('proyectos_sub', 'text_mm1antcb', 'vendedor')).toBe(true);
  });

  // Efraín, 2026-08-19: "la opción de editar directamente el producto o su
  // color en la orden antes de enviarla". Es lo que sale impreso en la OC, así
  // que lo corrige quien la manda (Compras/Admin) — el vendedor solo lo ve.
  it('producto y color los edita Compras/Admin en la OC, el vendedor no', () => {
    for (const col of ['text_mm0hs17x', 'text_mm0h4a1c']) {
      for (const role of ['compras', 'admin'] as Role[]) {
        expect(canWrite('proyectos_sub', col, role)).toBe(true);
      }
      for (const role of ['vendedor', 'almacen'] as Role[]) {
        expect(canWrite('proyectos_sub', col, role)).toBe(false);
      }
      expect(canRead('proyectos_sub', col, 'vendedor')).toBe(true);
    }
  });
});

describe('costeo de la OC — editable por Compras (Efraín, 2026-08-18)', () => {
  // "No se puede modificar el COSTO C/U en órdenes de compra, eso se debe poder
  // hacer": estas columnas eran `vis: AC` SIN `w`, así que el server rechazaba
  // el PATCH viniera de donde viniera y había que entrar a Monday.
  const COSTEO_OC = [
    'numeric_mm1dj4fp',        // Costo Distr. C/U
    'numeric_mm1dmsaz',        // Descuento %
    'text_mm1gdsvg',           // Moneda
    'board_relation_mm1cfgv5', // Proveedor (mueve la línea de una OC a otra)
  ];

  it('compras y admin escriben el costeo de la línea del Proyecto', () => {
    for (const col of COSTEO_OC) {
      for (const role of ['compras', 'admin'] as Role[]) {
        expect(canWrite('proyectos_sub', col, role), `${col}/${role}`).toBe(true);
      }
    }
  });

  it('ventas y almacén NO los escriben ni los ven (regla dura 2026-07-30)', () => {
    for (const col of COSTEO_OC) {
      for (const role of ['vendedor', 'almacen'] as Role[]) {
        expect(canWrite('proyectos_sub', col, role), `${col}/${role}`).toBe(false);
        expect(canRead('proyectos_sub', col, role), `${col}/${role}`).toBe(false);
      }
    }
  });

  it('la fecha de entrega del proveedor la escribe compras y el vendedor la VE', () => {
    expect(canWrite('proyectos_sub', 'date_mm20xdtm', 'compras')).toBe(true);
    expect(canWrite('proyectos_sub', 'date_mm20xdtm', 'admin')).toBe(true);
    expect(canWrite('proyectos_sub', 'date_mm20xdtm', 'vendedor')).toBe(false);
    expect(canRead('proyectos_sub', 'date_mm20xdtm', 'vendedor')).toBe(true);
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

describe('historial de actividad — solo Compras y Admin (Efraín, 2026-08-18)', () => {
  // El endpoint entero se niega con 403 (worker/routes/boards.ts): el vendedor
  // sí puede leer sus oportunidades, así que sin este gate veía el rastro de
  // quién cambió qué. La UI solo esconde el tab y los accesos (📋/🕐).
  it('vendedor y almacén no ven el historial', () => {
    expect(canReadActivity('vendedor')).toBe(false);
    expect(canReadActivity('almacen')).toBe(false);
  });

  it('compras y admin sí', () => {
    expect(canReadActivity('compras')).toBe(true);
    expect(canReadActivity('admin')).toBe(true);
  });
});

describe('Compras escribe TODO lo de Ventas (Efraín, 2026-08-28)', () => {
  // Primero fueron color y cantidad (2026-08-19: "en cotización los de compras
  // siempre pueden modificar colores y cantidades"); el 2026-08-28 Elizabeth
  // (Compras) reportó que no podía ponerle el PRODUCTO a una línea de una
  // oportunidad nueva y Efraín cerró la regla: "compras puede hacer todo lo de
  // ventas". El candado real es este `w` — outbox.ts gatea con canWrite() y la
  // grid solo lo refleja.
  it('compras escribe todas las columnas de línea que escribe el vendedor', () => {
    for (const col of ['text_mm07s2mg', 'numeric_mkzm6399',          // Color, Cantidad
      'text_mm0bkm1j', 'board_relation_mkzmafgp',                     // Producto (texto + relación)
      'color_mm1b34bg', 'long_text_mm1bj4pt', 'file_mm5akjy5']) {     // Embellecimiento
      for (const role of ['vendedor', 'compras', 'admin'] as Role[]) {
        expect(canWrite('oportunidades_sub', col, role), `${col}/${role}`).toBe(true);
      }
      expect(canWrite('oportunidades_sub', col, 'almacen'), col).toBe(false);
    }
  });

  it('barrido: no queda ninguna columna que el vendedor escriba y compras no', () => {
    // La regla completa, no una lista de ids: si mañana alguien agrega una
    // columna con `w` de puro vendedor, esto truena. La única excepción viva es
    // el Precio de Venta, que es de ADMIN y tampoco lo escribe el vendedor.
    for (const slug of Object.keys(VISIBILITY) as BoardSlug[]) {
      for (const col of Object.keys(VISIBILITY[slug])) {
        if (!canWrite(slug, col, 'vendedor')) continue;
        expect(canWrite(slug, col, 'compras'), `${slug}.${col}`).toBe(true);
      }
    }
  });

  it('el precio de venta sigue siendo la excepción: solo admin', () => {
    expect(canWrite('oportunidades_sub', 'numeric_mkzneg3d', 'compras')).toBe(false);
    expect(canWrite('oportunidades_sub', 'numeric_mkzneg3d', 'vendedor')).toBe(false);
  });
});

describe('Techo en Validación de Costeo — por correo, solo el CEO (2026-08-26)', () => {
  // "Sí se puede para mi papá Efraín pero no Eli": la celda de Techo se pinta
  // editable en el board de Validación SOLO para el CEO, aunque Elisa (y PAM)
  // también sean admin. Va por correo porque "Actuar en Monday como" presta el
  // monday_user_id — mismo criterio que la zona privada (worker/lib/zonas.ts).
  it('los dos correos del CEO sí', () => {
    expect(puedeEditarTechoEnValidacion('efrainponce@mexicanadeproteccion.com')).toBe(true);
    expect(puedeEditarTechoEnValidacion('efrain.ponce@mexicanadeproteccion.com')).toBe(true);
    expect(puedeEditarTechoEnValidacion('  Efrain.Ponce@Mexicanadeproteccion.com ')).toBe(true);
  });

  it('los demás admins no — Elisa incluida', () => {
    for (const email of [
      'administracion@mexicanadeproteccion.com',   // Elisa Vallado (admin)
      'compras@mexicanadeproteccion.com',          // Pamela Ricalde (admin)
      'salinasefrain@mexicanadeproteccion.com',    // Efrain Ponce Salinas (admin)
      'ventas@mexicanadeproteccion.com',
      '', null, undefined,
    ]) {
      expect(puedeEditarTechoEnValidacion(email), String(email)).toBe(false);
    }
  });

  it('no cambia el candado del server: compras/admin siguen escribiendo el Techo desde Costeo', () => {
    // Esta whitelist es de UI (dónde se pinta la celda). El write path no sabe
    // de qué board viene el PATCH, así que `w` no se tocó.
    expect(canWrite('oportunidades_sub', 'numeric_mkznpn83', 'compras')).toBe(true);
    expect(canWrite('oportunidades_sub', 'numeric_mkznpn83', 'admin')).toBe(true);
    expect(canWrite('oportunidades_sub', 'numeric_mkznpn83', 'vendedor')).toBe(false);
  });
});


// ── Utilidades por CORREO ────────────────────────────────────────────────────
// Efraín, 2026-08-27: "todas las utilidades, incluyendo validación de costeo y
// proyectos; eso solo lo ve Eli y mi papá". Hasta ese día las veía cualquier
// compras/admin (grupo AC) — o sea PAM y EMY entre ellos. Va por correo y no
// por rol: un rol nuevo obligaría a re-etiquetar las ~100 columnas de la
// whitelist, y el monday_user_id se presta con "Actuar en Monday como".
describe('utilidades: whitelist por correo', () => {
  // Las seis cifras de RESULTADO. Si mañana Monday agrega otra fórmula de
  // utilidad hay que meterla a UTILIDAD_COLS o se cuela por aquí.
  const UTILIDAD = [
    'formula_mkzne7gd',   // Utilidad (C/U)
    'formula_mkznry25',   // Utilidad Total
    'formula_mkznpw5p',   // Utilidad (%)
    'formula_mkzn28xk',   // Diferencia
    'formula_mkznpp33',   // Margen Gob (C/U)
    'formula_mkznsb7m',   // Margen Gob Total
  ];
  const PERMITIDOS = [
    'administracion@mexicanadeproteccion.com',   // Elisa Vallado
    'efrainponce@mexicanadeproteccion.com',      // CEO
    'efrain.ponce@mexicanadeproteccion.com',     // CEO, 2º correo
    'salinasefrain@mexicanadeproteccion.com',    // Efraín Ponce Salinas
    'efrain.ponces@gmail.com',                   // Efraín, personal
  ];
  const FUERA = [
    'compras@mexicanadeproteccion.com',          // Pamela Ricalde "PAM" (admin)
    'cotizaciones4@mexicanadeproteccion.com',    // Emily Martínez "EMY" (compras)
    'ventas@mexicanadeproteccion.com',
  ];

  it('la whitelist normaliza espacios y mayúsculas', () => {
    expect(puedeVerUtilidades('  Administracion@Mexicanadeproteccion.com ')).toBe(true);
    for (const email of FUERA) expect(puedeVerUtilidades(email), email).toBe(false);
  });

  it('sin correo NO se ven — el default es el seguro', () => {
    // Es la regla que sostiene todo: si algún camino del worker se queda sin
    // pasar el correo, las utilidades se ocultan en vez de filtrarse.
    for (const col of UTILIDAD) {
      expect(canRead('oportunidades_sub', col, 'admin'), col).toBe(false);
      expect(canRead('oportunidades_sub', col, 'admin', null), col).toBe(false);
      expect(canRead('oportunidades_sub', col, 'admin', ''), col).toBe(false);
    }
  });

  it('la whitelist sí las lee; PAM y EMY no, aunque el rol se las permitiera', () => {
    for (const col of UTILIDAD) {
      for (const email of PERMITIDOS) {
        expect(canRead('oportunidades_sub', col, 'admin', email), `${col} ${email}`).toBe(true);
      }
      for (const email of FUERA) {
        expect(canRead('oportunidades_sub', col, 'admin', email), `${col} ${email}`).toBe(false);
        expect(canRead('oportunidades_sub', col, 'compras', email), `${col} ${email}`).toBe(false);
      }
    }
  });

  it('el vendedor sigue sin verlas — el correo no ABRE nada que el rol cierre', () => {
    // La whitelist solo QUITA. Un vendedor en la lista (no lo hay, pero por si
    // alguien agrega un correo equivocado) seguiría sin ver costos ni utilidad.
    for (const col of UTILIDAD) {
      expect(canRead('oportunidades_sub', col, 'vendedor', PERMITIDOS[0]), col).toBe(false);
    }
  });

  it('NO toca los costos ni el Margen Gob % que Compras captura', () => {
    // El costeo es el trabajo de Compras: si esto se lo quita, EMY no puede
    // costear. Margen Gob % es un input, no un resultado.
    const suyas = [
      'numeric_mkznnm5s',   // Margen Gob % (input de captura)
      'formula_mkznrm5a',   // Costo Total
      'formula_mkznpfgg',   // Costo Total Unitario
      'numeric_mm0bph99',   // Costo Distr. C/U
      'numeric_mkznpn83',   // Techo
    ];
    for (const col of suyas) {
      expect(canRead('oportunidades_sub', col, 'compras', 'cotizaciones4@mexicanadeproteccion.com'), col).toBe(true);
      expect(canRead('oportunidades_sub', col, 'admin', 'compras@mexicanadeproteccion.com'), col).toBe(true);
    }
    expect(canWrite('oportunidades_sub', 'numeric_mkznnm5s', 'compras')).toBe(true);
  });

  it('readableCols las quita también — es la lista que filtra cada lectura', () => {
    const dePam = readableCols('oportunidades_sub', 'admin', 'compras@mexicanadeproteccion.com');
    const deEli = readableCols('oportunidades_sub', 'admin', 'administracion@mexicanadeproteccion.com');
    for (const col of UTILIDAD) {
      expect(dePam, col).not.toContain(col);
      expect(deEli, col).toContain(col);
    }
    // Y no se llevó nada de paso: la diferencia son EXACTAMENTE las seis.
    expect(deEli.length - dePam.length).toBe(UTILIDAD.length);
  });
});
