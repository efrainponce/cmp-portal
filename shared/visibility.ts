// ── THE WHITELIST AS DATA ─────────────────────────────────────────────────────
// vis: roles that may READ a column. w: roles that may WRITE it (via outbox).
// FAIL-CLOSED: a column not listed here is invisible to every role and the
// serializer must drop it. Tags for oportunidades(+sub) follow the approved
// docs/monday-column-map.md; tags for proyectos/productos/instituciones/contactos
// are PROPOSED (2026-07-14 overnight build) — pending Efraín's review.
// 'admin' must be tagged explicitly; there is no implicit superuser in DTOs.
import type { Role } from './types';
import type { BoardSlug } from './boards';

export interface ColRule { vis: Role[]; w?: Role[] }

const V: Role[] = ['vendedor', 'compras', 'admin'];   // seller-visible
const AC: Role[] = ['compras', 'admin'];              // internal: costs, proveedor, ops
const WV: Role[] = ['vendedor', 'admin'];             // PROPOSED writable set
const WAC: Role[] = ['compras', 'admin'];             // writable: costeo capture (compras/admin)
const WA: Role[] = ['admin'];                         // writable: solo admin (precio de venta)
// Catálogo de Productos, columnas de pura identificación (nombre/SKU): las ve
// TODO rol, almacén incluido — es lo que el formulario de movimientos de
// inventario usa para elegir el producto. Nunca lleva costos ni proveedor.
const CAT: Role[] = ['vendedor', 'compras', 'admin', 'almacen'];

const vis = (ids: string[], r: Role[]): Record<string, ColRule> =>
  Object.fromEntries(ids.map(id => [id, { vis: r }]));

export const VISIBILITY: Record<BoardSlug, Record<string, ColRule>> = {
  oportunidades: {
    // Nombre de la oportunidad — editable desde el drawer por vendedor, compras
    // y admin en LOS 6 boards de etapa (Efraín, 2026-08-13). No es una columna
    // de Monday: viaja como pseudo-columna `name` en change_multiple_column_values
    // (aceptado, verificado en vivo 2026-08-13) y en el espejo vive en
    // items.name — ver el caso especial en worker/lib/outbox.ts.
    name: { vis: V, w: V },
    ...vis(['pulse_id_mm0qcq0m',
      'multiple_person_mm0wt53c', 'deal_expected_close_date',
      'lookup_mm1bs976', 'lookup_mm0xf2r5', 'dropdown_mm03g067', 'lookup_mm0pt4mj',
      'lookup_mkznd66k', 'lookup_mm00p07m', 'date_mm09mv5b', 'file_mm0fgrzq',
      'file_mm0zjras', 'color_mm47f0ca', 'dropdown_mm0mg00', 'text_mm47xmh',
      'lookup_mm087at6', 'file_mm0z6rze', 'date_mm094kzf', 'date_mm09b6nz',
      'date_mm0mc3dj',
      // PROPOSED 2026-07-15 (create-oportunidad form): ¿nuevos productos?
      'color_mm0ex0ed'], V),
    // Ganar/Perder/Archivar (OpportunityDrawer.tsx) write deal_stage directly via
    // the generic PATCH — found completely broken (403, unconditionally, for
    // every role) during the 2026-07-21 stress test: this column had no `w` at
    // all, so canWrite() always failed. Bug-fixed per Efraín's go-ahead in that
    // session; same role set as deal_owner/comprador reassignment just below.
    deal_stage: { vis: V, w: V },
    // Condiciones de la cotización (bloque del tab Cotización, shared/quoteTerms.ts):
    // condiciones comerciales, tiempo de entrega y vigencia. Son de la cotización
    // completa, no de una línea. Estuvieron como `w: WV` (vendedor+admin) y nunca
    // tuvieron UI; Efraín (2026-07-30) los pasó a **compras y admin**: el tiempo de
    // entrega y las condiciones salen del costeo, no de ventas. El vendedor los
    // sigue VIENDO (vis: V) porque son lo que cotiza al cliente.
    text_mm0gje0:       { vis: V, w: WAC },   // Vigencia de la cotización
    text_mm0gjrrd:      { vis: V, w: WAC },   // Tiempo de entrega
    long_text_mm1m416j: { vis: V, w: WAC },   // Comentarios cotización (= condiciones comerciales)
    // Cliente (board_relation → Contactos) — mismo tipo de columna que
    // contact_account, ya verificado escribible en vivo (2026-07-14). El
    // vendedor lo relinkea para corregir Institución cuando quedó mal
    // capturada al crear la oportunidad (Institución es mirror de este campo).
    deal_contact: { vis: V, w: WV },
    // Vendedor / Comprador — reasignables desde el drawer (Efraín, 2026-07-16:
    // vendedor, compras y admin pueden cambiar cualquiera de los dos).
    deal_owner:              { vis: V, w: V },
    multiple_person_mm03qyw9: { vis: V, w: V },
    ...vis(['lookup_mm4g2hqf', 'lookup_mm35sk4e', 'lookup_mm0cvyfc',
      'lookup_mm1w47fq', 'multiple_person_mm1m73qp'], AC),
    // Inventario Actual (Imagen) — Compras sube evidencia de inventario junto a
    // la cotización firmada (tab Documentación); el vendedor la ve (Efraín,
    // 2026-08-10).
    file_mm0hpefr: { vis: V, w: WAC },
  },

  oportunidades_sub: {
    ...vis(['name', 'lookup_mm0x4kda', 'lookup_mkzn7x9a',
      'text_mm0bxy39', 'lookup_mm0xn98d', 'lookup_mm5v1qb',
      'lookup_mm0w4f4v', 'lookup_mm0xw8p7',
      'long_text_mm1hyszv',
      'formula_mkznmjh6', 'formula_mm0rtdqp', 'formula_mm00xy0n'], V),
    // Precio de Venta C/U — el vendedor lo VE (cotiza al cliente, necesita el
    // precio y los totales) pero solo admin lo cambia (Efraín, 2026-07-24).
    // Antes era `w: WV`, lo que dejaba al server aceptar un PATCH del vendedor
    // aunque la UI no pintara el campo editable; el resto del código ya asumía
    // esta regla — quoteVersions.ts restaura el precio con `trusted: true`
    // precisamente porque "no es escribible por vendedor".
    numeric_mkzneg3d: { vis: V, w: WA },
    // Etapa Costeo — dropdown editable por compras/admin en la vista Costeo
    // (Efraín, 2026-07-16). submitVersion también la escribe directo (fuera de
    // este gate) para resetearla a "No iniciado" cuando el vendedor edita una
    // línea ya costeada.
    color_mm084gvf: { vis: V, w: WAC },
    // PROPOSED writable 2026-07-15 (versiones de cotización): el vendedor edita
    // producto/color/cantidad/embellecimiento de una línea — nunca las columnas de
    // costo (grupo AC/WAC abajo, las llena compras aparte). Pendiente confirmación
    // de Efraín, mismo patrón que text_mm0gje0 en `oportunidades`.
    text_mm0bkm1j:        { vis: V, w: WV },   // Producto (texto libre)
    board_relation_mkzmafgp: { vis: V, w: WV }, // Producto (auto) → Productos; ya probado en createOportunidad.ts
    // Color y Cantidad — también los escribe COMPRAS, en cualquier etapa
    // (Efraín, 2026-08-19: "en cotización los de compras siempre pueden
    // modificar colores y cantidades"). Elizabeth abría una oportunidad en
    // Costeo y los dos campos salían de solo lectura: el `w: WV` de aquí es
    // el candado real (outbox.ts gatea con canWrite), la grid solo lo refleja.
    // Un cambio de Compras o de ADMIN no reinicia el ciclo de costeo como el
    // del vendedor: queda como mini versión V{n}.{m} — worker/routes/boards.ts
    // (esAjusteInline) y worker/lib/lineaAjustes.ts.
    text_mm07s2mg:        { vis: V, w: V },    // Color
    numeric_mkzm6399:     { vis: V, w: V },    // Cantidad
    color_mm1b34bg:       { vis: V, w: WV },   // Embellecimiento (status)
    // Descripción/imagen de zonas — Compras también las captura/edita desde
    // el board Costeo (tab Embellecimientos), no solo Ventas (Efraín, 2026-08-12).
    long_text_mm1bj4pt:   { vis: V, w: V },    // Descripción Embellecimientos
    file_mm5akjy5:        { vis: V, w: V },    // Imagen embellecimiento (per-zona, filename-prefixed)
    ...vis(['lookup_mm11t8gj',
      'lookup_mm0bdwb5', 'formula_mkznqx51', 'formula_mkzngnjm',
      'formula_mm0rqjv1', 'lookup_mm0bbz02', 'long_text_mm1b9bh8',
      'formula_mkznpfgg', 'formula_mkznrm5a',
      'numeric_mm2qzzbe', 'formula_mkznsb7m', 'formula_mkznpp33',
      'formula_mkzne7gd', 'formula_mkznry25', 'formula_mkznpw5p', 'formula_mkzn28xk',
      'lookup_mm1tjv9n'], AC),                  // the Costeo view columns
    // Techo — tope de precio capturado en Monday; compras/admin lo editan
    // desde la Costeo (Efraín, 2026-08-13).
    numeric_mkznpn83: { vis: AC, w: WAC },
    // Costeo inputs — writable by compras/admin (Costeo capture, stage 15).
    numeric_mm0bph99: { vis: AC, w: WAC },   // Costo Distr. C/U
    numeric_mkzn2q51: { vis: AC, w: WAC },   // Descuento Distr. %
    numeric_mm0rvhgs: { vis: AC, w: WAC },   // Valor de Conversión
    numeric_mkzngs9x: { vis: AC, w: WAC },   // Gastos %
    numeric_mm0gxvpa: { vis: AC, w: WAC },   // Costo Total Embellecimiento C/U
    // Margen Gob % — input real en Monday (no fórmula) que alimenta Margen Gob
    // C/U, Diferencia, Utilidad y el % de "Margen"; editable en Costeo, solo
    // lectura en Validación (Efraín, 2026-07-16).
    numeric_mkznnm5s: { vis: AC, w: WAC },   // Margen Gob %
    // Moneda (línea) — columna status creada en Monday el 2026-07-30. La
    // Moneda que ya existía (lookup_mm11t8gj, arriba) es un MIRROR del catálogo
    // y Monday no deja escribirlo: el mismo producto puede llegar costeado en
    // dólares o en pesos según el proveedor, así que la moneda de ESTE costeo
    // se captura por línea. Mismo grupo que el resto de los inputs de costeo.
    color_mm5s709s: { vis: AC, w: WAC },     // Moneda (línea)
    // IVA % de la línea (16) — es el input de las fórmulas Subtotal/IVA/Total
    // c/IVA, que el vendedor ya VE. No estaba en la whitelist, así que el
    // server lo borraba del DTO y ni la grid de Costeo ni el preview local
    // podían mostrar el IVA (Efraín, 2026-07-30). Lo escribe Compras.
    numeric_mm0cg0bm: { vis: V, w: WAC },    // IVA %
  },

  proyectos: {
    // Nombre del proyecto — mismo trato que el de la oportunidad (Efraín, 2026-08-13).
    name: { vis: V, w: V },
    ...vis(['pulse_id_mm1a12gy', 'project_status', 'lookup_mm20g4n6',
      'link_mm1amwz8', 'file_mm0hwapr', 'lookup_mm1dwn6',
      'color_mm0mcrjq',                          // Estado Pago — recomendación aceptada
      'multiple_person_mm0hrnqq', 'board_relation_mm0hb0gy', 'lookup_mm1d1546',
      'dropdown_mm0hnyv', 'lookup_mm1d56mp', 'board_relation_mm0hf0y3',
      'lookup_mm0pd55m', 'lookup_mm0mbkjk'], V),
    ...vis(['color_mm0md4z8', 'date_mm0mwqzw', 'project_owner', 'file_mm0hcrtz',
      'file_mm1dm11c', 'file_mm0hj9pn', 'file_mm1g7cqz',
      'date_mm21c5ka', 'multiple_person_mm164em1', 'multiple_person_mm16qysk',
      'multiple_person_mm169k2f', 'file_mm478mkq', 'link_mm462saa',
      'text_mm4cct6a', 'text_mm4cdyjb', 'color_mm52csps',
      'file_mm4pa2h8', 'date_mm525k42', 'file_mm3393nf'], AC),
    // Comentarios — lo que cmp-tallas imprime en la OC. El portal lo escribe
    // como puente de la "nota al proveedor" del tab Órdenes de compra
    // (worker/lib/ocNotas.ts, Efraín 2026-08-19).
    text_mm4c74f8: { vis: AC, w: WAC },
    // Fecha Entrega — obligatoria (tab Documentación del Proyecto), la captura
    // el vendedor; compras/admin la ven pero no la tocan (Efraín, 2026-08-05).
    date_mm0m1vfv: { vis: V, w: WV },
    // OC / cotización / contrato firmado por el cliente — sube el vendedor
    // (quien lo recibe) o compras/admin (Efraín, 2026-07-17). En Monday es
    // "OC/contrato/cotización firmada (oculto)": es donde el equipo lo sube de
    // verdad (worker/lib/portalFiles.ts PROYECTO_DOCUMENTO_COL, 2026-08-26).
    file_mm33yv4p: { vis: V, w: V },
    // "Cotización Firmada Institucion" — a donde apuntaba el portal antes del
    // 2026-08-26. Solo lectura: 4 proyectos viejos siguen mostrando su
    // documento, pero lo nuevo ya se escribe en file_mm33yv4p.
    file_mm0hayh4: { vis: V },
  },

  proyectos_sub: {
    // Producto y Color de la línea — editables desde el tab "Órdenes de compra"
    // por compras/admin (Efraín, 2026-08-19: "la opción de editar directamente
    // el producto o su color en la orden antes de enviarla"). Antes eran de
    // solo lectura por venir del catálogo de cmp-tallas, pero lo que va impreso
    // en la OC es justo esto y corregirlo obligaba a entrar a Monday. Talla
    // sigue de solo lectura: es la que cuadra contra el desglose de tallas.
    text_mm0hs17x: { vis: V, w: AC },
    text_mm0h4a1c: { vis: V, w: AC },
    ...vis(['name',
      'text_mm1antcb', 'text_mm1a5yyq', 'text_mm0hyrfs',
      'text_mm52x1bx', 'text_mm56dbkm', 'text_mm0mzet0',
      'date_mm20fq6t', 'date_mm20y5t3', 'date_mm21p1ex',
      'date_mm217ms0', 'date_mm21w46m', 'date_mm20t4kr', 'date_mm21swc5',
      'long_text_mm1cqh8e', 'long_text_mm1cyqts', 'long_text_mm1c59cg',
      'long_text_mm1c2eyf', 'long_text_mm1cyq91', 'long_text_mm1c6ya0',
      'long_text_mm1cnbbr', 'long_text_mm2077h1'], V),   // incl. 8 zonas embellecimiento
    // Cantidad por talla — editable inline (tab Tallas del Proyecto) por
    // vendedor/compras/admin para corregir una línea ya importada sin tener
    // que regresar al Sheet (Efraín, 2026-08-05). Talla se queda de solo
    // lectura: es texto libre del catálogo de cmp-tallas y un typo aquí no
    // calzaría con el Sheet/Monday (Color dejó de serlo el 2026-08-19, arriba).
    numeric_mm0hj2q4: { vis: V, w: V },
    // Estado del producto + su comentario — tab Ejecución del Proyecto (2026-08-05).
    // El vendedor VE el avance (batería/chips) pero no lo cambia; compras/admin son
    // quienes reciben/embarcan y actualizan el estado. Cada cambio queda en
    // estado_producto_historial (worker/lib/estadoProducto.ts) — ver ahí antes de
    // agregar más columnas de fecha en Monday por cada estado nuevo.
    color_mm0hqf79: { vis: V, w: AC },
    text_mm20gzsb: { vis: V, w: AC },
    // Costeo de la línea del Proyecto — tab "Órdenes de compra" (Efraín,
    // 2026-08-18: "no se puede modificar el COSTO C/U en órdenes de compra,
    // eso se debe poder hacer"). Compras negocia con el proveedor DESPUÉS de
    // que se importaron las tallas, así que el costo con el que se cotizó no
    // es el que va en la OC; hasta aquí eran de solo lectura y había que
    // entrar a Monday. Reasignar Proveedor mueve la línea de una OC a otra.
    // Cada cambio queda en activity_log con el actor REAL del portal
    // (worker/lib/activityLog.ts, PORTAL_WRITE_COLUMNS) — no el usuario del
    // token de la API, que es lo único que registra Monday.
    numeric_mm1dj4fp:        { vis: AC, w: WAC },   // Costo Distr. C/U
    numeric_mm1dmsaz:        { vis: AC, w: WAC },   // Descuento %
    text_mm1gdsvg:           { vis: AC, w: WAC },   // Moneda
    board_relation_mm1cfgv5: { vis: AC, w: WAC },   // Proveedor
    ...vis(['lookup_mm1d2y9b', 'lookup_mm2145g'], AC),   // espejos del proveedor (Monday los calcula)
    // Fecha estimada de entrega del proveedor — el vendedor la VE (es lo que
    // le promete al cliente), la captura Compras al cerrar la OC. Estaba en el
    // grupo `vis: V` de arriba sin `w`; se saca de ahí para darle escritura.
    date_mm20xdtm: { vis: V, w: WAC },
    // Tab Logística del Proyecto (2026-08-17): Compras/Admin capturan la
    // recolección — encargado, folio/guías, evidencia, confirmación de
    // tallas completas y fecha. Vendedor sigue sin ver estas columnas (ya
    // eran AC antes de este tab, se les agrega `w`). `text_mm6aapc8`
    // ("Comentarios") es columna nueva del board, agregada por Compras junto
    // con el resto del grupo de recolección.
    multiple_person_mm4pc2ns: { vis: AC, w: AC },
    text_mm4ph3a9: { vis: AC, w: AC },
    text_mm6aapc8: { vis: AC, w: AC },
    text_mm4pywyx: { vis: AC, w: AC },
    file_mm4pz90b: { vis: AC, w: AC },
    file_mm4pc4tj: { vis: AC, w: AC },
    boolean_mm4p7eqb: { vis: AC, w: AC },
    date_mm4p59q2: { vis: AC, w: AC },
  },

  productos: {
    // Identificación del producto — también para almacén (picker de "Nuevo
    // movimiento" de inventario, que solo usa el nombre). El resto del catálogo
    // sigue siendo ventas/compras/admin.
    ...vis(['name', 'product_and_service_sku', 'text_mm0wvga2'], CAT),
    ...vis(['product_and_service_description',
      'dropdown_mkztty4b', 'text_mkzp9428', 'text_mkzpbhb5', 'long_text_mm0xse7v',
      'dropdown_mm07pjsv'], V),
    ...vis(['numeric_mkzpx7eb', 'text_mkzp59zf', 'numeric_mm0bnkch',
      'numeric_mm0bgd2f', 'long_text_mm1tcga0',
      'lookup_mm1cyy7f', 'lookup_mm1dv3jy', 'text_mkzmgvc7'], AC),
    // Tallas — lista simple ("S,M,XL" / "unitalla" / vacío), creada 2026-08-03
    // en reemplazo del JSON viejo por género (long_text_mm174q0j, retirado).
    // Compras la edita por SKU desde el panel de detalle de la línea en Costeo
    // (Efraín, 2026-08-03) — mismo patrón que boolean_mm5cqtjs de abajo.
    text_mm5v6jhj: { vis: V, w: WAC },
    // "Descripción y tallas confirmadas" (checkbox, creada 2026-07-18) — Compras
    // confirma por SKU que la ficha del catálogo (Descripción/Tallas) es correcta;
    // bloquea "Mandar a Validación de costeo" (worker/lib/costeo.ts checkValidacion).
    boolean_mm5cqtjs: { vis: V, w: WAC },
    // Proveedor — vive en AC (nunca V: "ventas cero proveedores", 2026-07-30).
    // No era escribible desde el portal hasta ahora: Compras lo asignaba en
    // Monday directo. Efraín, 2026-08-04: "la línea de proveedor la debe
    // llenar compras en costeo, y no puede pasar si no tiene proveedor" — mismo
    // patrón que Tallas/confirmación de arriba (worker/lib/costeo.ts checkValidacion).
    board_relation_mm1cwqky: { vis: AC, w: WAC },
  },

  instituciones: {
    ...vis(['name', 'account_contact', 'text_mm1bvz12', 'dropdown_mm1bajsm',
      'dropdown_mm1brkww', 'dropdown_mm1b46m9', 'text_mm0canq', 'text_mm0cdqv2',
      'text_mm0c7qw1', 'date_mm0cv76t', 'multiple_person_mm0c3xbk',
      'board_relation_mm0ha84m', 'file_mm0ccv71'], V),
    ...vis(['numeric_mm1bv7zf', 'numeric_mm1bgv1p', 'text_mm1bped1'], AC),
  },

  contactos: {
    ...vis(['name', 'contact_email',
      'contact_phone', 'text_mm0dz8yj', 'long_text4', 'text_mm454qq1',
      'text_mm45xn3', 'text_mm45tqrm', 'text_mm456fbp', 'text_mm562a0m'], V),
    // Writable since the 2025-04 API bump fixed board_relation writes to this
    // CRM "Account" column (silently no-op'd on 2024-10) — verified live 2026-07-14.
    contact_account: { vis: V, w: WV },   // Institución
    // Reasignable desde el picker de Contactos (Efraín, 2026-07-18): mismo set que Institución.
    multiple_person_mm03vqwx: { vis: V, w: WV },   // Vendedor
  },

  // Catálogo interno para el picker de "línea manual" en el Proyecto (OC
  // independiente) — solo lectura, nunca visible al vendedor (Efraín, 2026-07-17).
  proveedores: {
    ...vis(['name', 'text_mm3kwjde', 'phone_mm21sp93', 'email_mm21c4ng',
      'text_mm1d43t4'], AC),
  },
};

/** Las cifras de UTILIDAD y MARGEN de la línea — el resultado del costeo, no
 * sus insumos. Van por CORREO encima del rol (Efraín, 2026-08-27: "todas las
 * utilidades, incluyendo validación de costeo y proyectos; eso solo lo ve Eli y
 * mi papá"). Hasta hoy las veía cualquier `compras`/`admin` (grupo AC), o sea
 * PAM y EMY entre ellos.
 *
 * QUÉ NO ENTRA, a propósito:
 *  - `numeric_mkznnm5s` (Margen Gob %) — no es un resultado: es el dato que
 *    Compras CAPTURA durante el costeo y alimenta las fórmulas. Quitarlo
 *    rompería la captura, que sí es su trabajo.
 *  - Los COSTOS (`formula_mkznrm5a` Costo Total, `numeric_mm0bph99` Costo Distr.
 *    …) — Compras vive de ellos.
 * `formula_mkzn28xk` (Diferencia) sí entra: docs/monday-column-map.md la agrupa
 * con la familia de Utilidad, no con los costos.
 *
 * OJO con lo que esto NO tapa: quien ve Costo Total y Precio de Venta puede
 * sacar la utilidad con una resta. Esto quita las cifras de la pantalla y de la
 * API, no la aritmética. */
const UTILIDAD_COLS: ReadonlySet<string> = new Set([
  'formula_mkzne7gd',   // Utilidad (C/U)
  'formula_mkznry25',   // Utilidad Total
  'formula_mkznpw5p',   // Utilidad (%)
  'formula_mkzn28xk',   // Diferencia
  'formula_mkznpp33',   // Margen Gob (C/U)
  'formula_mkznsb7m',   // Margen Gob Total
]);

/** Whitelist por CORREO, no por rol ni por `monday_user_id` — mismo criterio y
 * mismo porqué que ZONA_PRIVADA_ADMINS_PERMITIDOS (worker/lib/zonas.ts) y que
 * TECHO_VALIDACION_EMAILS aquí abajo: "Actuar en Monday como"
 * (worker/routes/admin.ts) PRESTA un monday_user_id, así que el id no
 * identifica a la persona; el correo sí.
 *
 * Es whitelist y no blocklist por decisión de Efraín (2026-08-27): un admin
 * nuevo empieza SIN ver utilidades hasta que alguien lo agregue aquí a mano.
 * Falla del lado seguro. Elisa Vallado + el CEO (sus dos correos) + Efraín
 * (sus dos cuentas, con las que prueba en producción). */
const UTILIDADES_EMAILS: ReadonlySet<string> = new Set([
  'administracion@mexicanadeproteccion.com',  // Elisa Vallado
  'efrainponce@mexicanadeproteccion.com',     // Efraín Ponce (CEO)
  'efrain.ponce@mexicanadeproteccion.com',    // Efraín Ponce (CEO, 2º correo)
  'salinasefrain@mexicanadeproteccion.com',   // Efraín Ponce Salinas
  'efrain.ponces@gmail.com',                  // Efraín Ponce Salinas (personal)
]);

export const puedeVerUtilidades = (email: string | null | undefined): boolean =>
  !!email && UTILIDADES_EMAILS.has(email.trim().toLowerCase());

/** El `email` es OPCIONAL y su ausencia OCULTA (no muestra): un camino que se
 * me pase de actualizar deja las utilidades fuera, que es el error barato. Si
 * algún día alguien de la whitelist no ve sus cifras, el bug es aquí: falta
 * pasarle el correo a esta función desde ese camino. */
const utilidadTapada = (col: string, email?: string | null) =>
  UTILIDAD_COLS.has(col) && !puedeVerUtilidades(email);

export const canRead = (b: BoardSlug, col: string, r: Role, email?: string | null) =>
  !!VISIBILITY[b][col]?.vis.includes(r) && !utilidadTapada(col, email);
/** ¿El rol puede ver ALGO de este board? Un board sin una sola columna legible
 * es interno para ese rol y sus rutas se niegan enteras (worker/routes/boards.ts),
 * no solo sus columnas: `cols` sale vacío pero `name` viaja SIEMPRE en el
 * ItemDTO, así que sin este gate un vendedor listaba los 98 nombres de
 * `proveedores` con un solo GET (Efraín, 2026-07-30: "ventas no puede ver nada
 * de costeo ni proveedores"). */
export const canReadBoard = (b: BoardSlug, r: Role) =>
  Object.values(VISIBILITY[b]).some(c => c.vis.includes(r));
export const canWrite = (b: BoardSlug, col: string, r: Role) =>
  !!VISIBILITY[b][col]?.w?.includes(r);
export const readableCols = (b: BoardSlug, r: Role, email?: string | null): string[] =>
  Object.entries(VISIBILITY[b])
    .filter(([id, c]) => c.vis.includes(r) && !utilidadTapada(id, email))
    .map(([id]) => id);

/** ¿Este rol puede ver el HISTORIAL de actividad (worker/lib/activityLog.ts)?
 * Solo compras y admin (Efraín, 2026-08-18: "las actividades no quiero que las
 * pueda ver el vendedor"). Es una regla de board completo, no por columna: el
 * historial de un renglón dice quién cambió qué y cuándo, y aunque las filas
 * ya se filtran con canRead (columnas de costo fuera), el resto sigue siendo
 * información interna de operación — quién se equivocó, cuántas veces se
 * corrigió un precio, cuándo entró Compras a la línea. El gate vive en el
 * endpoint entero (worker/routes/boards.ts → 403); la UI solo esconde el tab
 * y los accesos (📋/🕐) para no ofrecer algo que el server va a negar. */
export const canReadActivity = (r: Role) => r === 'compras' || r === 'admin';

/** ¿Esta persona puede editar el TECHO (`numeric_mkznpn83`) desde el board de
 * VALIDACIÓN DE COSTEO? Por CORREO, no por rol — es la segunda whitelist por
 * correo del portal (la otra es la zona privada, worker/lib/zonas.ts) y por la
 * misma razón: "Actuar en Monday como" presta el `monday_user_id`, así que el
 * id no identifica a la persona; el correo sí.
 *
 * Por qué no es `w: [...]` de la columna: el techo lo captura Compras en el
 * board de Costeo desde siempre (`w: WAC` arriba) y eso NO cambia. Lo que se
 * decide aquí es solo si la celda se pinta editable en VALIDACIÓN, donde el
 * resto de la línea ya está congelada y lo único abierto es el Precio de
 * Venta. Un board no viaja en el PATCH (la ruta es `oportunidades_sub` venga
 * de donde venga), así que esto es una regla de la UI, no un candado del
 * server: quien ya podía escribir el techo desde Costeo lo sigue pudiendo.
 *
 * La lista es el CEO y nadie más (Efraín, 2026-08-26: "todos los admins en
 * validación de costeo deben poder cambiar el techo" → corregido minutos
 * después a "sí se puede para mi papá Efraín pero no Eli"). Sus DOS correos,
 * un solo id de Monday. Bajo "ver como" el viewer ya es el suplantado
 * (worker/mw/identity.ts), así que verlo como él enseña la celda —así se
 * prueba sin agregar a nadie a la lista. */
const TECHO_VALIDACION_EMAILS: ReadonlySet<string> = new Set([
  'efrainponce@mexicanadeproteccion.com',
  'efrain.ponce@mexicanadeproteccion.com',
]);
export const puedeEditarTechoEnValidacion = (email: string | null | undefined): boolean =>
  !!email && TECHO_VALIDACION_EMAILS.has(email.trim().toLowerCase());
