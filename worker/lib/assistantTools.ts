// worker/lib/assistantTools.ts — tool surface shared by every Claude-agent channel
// (WhatsApp bot, portal chat bubble). Searches/queries hit the D1 mirror (never
// Monday directly); creates go through the same guarded paths the portal uses.
// Column ids from column-meta.gen.ts — never fabricate.
//
// ROLE GATING (2026-07-15): every tool declares which roles may call it
// (TOOL_ROLES). `toolsFor(role)` builds the per-agent tool list, and runTool
// re-checks the role before executing (defense in depth — the model never gets
// to run a tool its role wasn't offered). Row-level scoping rides on the DAL:
// vendedor only ever sees his own oportunidades/proyectos; column-level
// visibility rides on shared/visibility.ts (costs stay compras/admin).
import type Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';
import type { Identity, MirrorItem, Role } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { COLUMN_META } from '../../shared/column-meta.gen';
import { readableCols, canRead, puedeConsultarDireccion } from '../../shared/visibility';
import { buildAnalyticsResponse } from './analytics';
import type { AnalyticsResponse, GrupoMetrics, FunnelStep, GroupBy } from '../../shared/analytics';
import {
  CAMPOS, OPS, FNS, LIMITE_MAX, validarConsulta, ejecutarConsulta, aplicarPeriodoDefault, anioEnCurso, ConsultaError, type Tabla,
} from '../../shared/consultaLibre';
import { filasConsultaLibre } from './consultaLibre';
import { EMBELL_TEMPLATE_KEYS } from '../../shared/embellecimiento';
import { DEAL_STAGE_LABELS, DEAL_STAGE_ORDER, CLOSED_STAGES, stageKeyForLabel } from '../../shared/dealStages';
import { listItems, getItem, childrenOf } from './dal';
import { listStock, listMovements, listWarehouses, createMovement, InventoryError } from './inventory';
import { MOVEMENT_TYPES, type MovementType } from '../../shared/inventory';
import { submitCreate, CreateError } from './createRecord';
import { createOportunidad, OportunidadError, type LineaInput } from './createOportunidad';
import { renderCartera, renderDetalle, renderHistorial, type Categoria, type EventoHistorial } from './cartera';
import { registrarSeguimiento, cerrarOportunidad, CarteraError, type Cierre } from './carteraAcciones';
import { listActivity } from './activityLog';
import { cargarVista } from '../wa/comandos';
import { guardarLista } from '../wa/estado';

// Display columns per board (seller-visible only — cost columns stay out).
const PRODUCTO_COLS = {
  sku: 'product_and_service_sku',
  marca: 'product_and_service_description',
  unidad: 'text_mkzp9428',
  colores: 'dropdown_mkztty4b',
};
const CONTACTO_COLS = {
  email: 'contact_email',
  telefono: 'contact_phone',
  cargo: 'text_mm0dz8yj',
};
const INSTITUCION_COLS = {
  tipo: 'dropdown_mm1bajsm',
  estado: 'dropdown_mm1b46m9',
  municipio: 'text_mm1bvz12',
};

// Oportunidades summary columns (ids from column-meta.gen.ts).
// NOTE: the money mirrors (Total/Subtotal/Costo/Utilidad) mirror FORMULA
// columns, which Monday's API does not materialize — their `text` is always
// empty in the D1 mirror (verified live 2026-07-15). Pipeline amounts are
// therefore computed from the subitem lines: Precio de Venta C/U × Cantidad.
const OPP = {
  folio: 'pulse_id_mm0qcq0m',
  etapa: 'deal_stage',
  vendedor: 'deal_owner',
  institucion: 'lookup_mm1bs976',
  fechaLimite: 'deal_expected_close_date',
};

const SUB = {
  precioVenta: 'numeric_mkzneg3d',   // Precio de Venta C/U (seller-visible)
  cantidad: 'numeric_mkzm6399',      // Cantidad
};

const PROYECTO = {
  folio: 'pulse_id_mm1a12gy',
  estado: 'project_status',
  estadoPago: 'color_mm0mcrjq',
  fechaEntrega: 'date_mm0m1vfv',
  institucion: 'lookup_mm1dwn6',
  vendedor: 'multiple_person_mm0hrnqq',
};

// Líneas del Proyecto (proyectos_sub): una por talla — ids de column-meta.gen.ts.
const PROYECTO_SUB = {
  producto: 'text_mm0hs17x',
  color: 'text_mm0h4a1c',
  talla: 'text_mm1antcb',
  sku: 'text_mm0hyrfs',
  cantidad: 'numeric_mm0hj2q4',
  estado: 'color_mm0hqf79',          // Estado del producto (tab Ejecución)
  guia: 'text_mm0mzet0',             // Número de Guía
};

// ── Tool registry ─────────────────────────────────────────────────────────────

const ALL: Role[] = ['vendedor', 'compras', 'admin'];
const CREATORS: Role[] = ['vendedor', 'admin'];
// Inventario (2026-07-22): almacén (logística) captura y consulta por WhatsApp/portal;
// compras/admin solo consultan; la escritura de movimientos es de almacen + admin
// (decisión de Efraín — compras sigue solo-consulta como en el portal).
const INVENTORY_READ: Role[] = ['compras', 'admin', 'almacen'];
const INVENTORY_WRITE: Role[] = ['almacen', 'admin'];
const PRODUCT_SEARCH: Role[] = ['vendedor', 'compras', 'admin', 'almacen'];

/** Which roles may call each tool. Fail-closed: unknown tool = nobody. */
export const TOOL_ROLES: Record<string, Role[]> = {
  buscar_productos: PRODUCT_SEARCH,
  buscar_contactos: ALL,
  buscar_instituciones: ALL,
  crear_contacto: CREATORS,
  crear_oportunidad: CREATORS,
  consultar_pipeline: ALL,
  listar_oportunidades: ALL,
  detalle_oportunidad: ALL,
  listar_proyectos: ALL,
  detalle_proyecto: ALL,
  consultar_inventario: INVENTORY_READ,
  movimientos_inventario: INVENTORY_READ,
  listar_almacenes: INVENTORY_READ,
  crear_movimiento: INVENTORY_WRITE,
  ranking_vendedores: ['admin'],
  resumen_ventas: ['admin'],
  oportunidades_por_validar: ['admin'],
  consulta_libre: ['admin'],
  // Cartera (plan docs/plan-wa-cartera.md, 2026-09-12). Respuesta directa:
  // el texto lo arma worker/lib/cartera.ts y el loop lo manda tal cual.
  mi_cartera: ALL,
  historial_oportunidad: ALL,
  registrar_seguimiento: ALL,
  cerrar_oportunidad: ALL,
};

/** Tools cuyo resultado YA es la respuesta para la persona (texto listo):
 * agentLoop lo manda sin volver a llamar al modelo (Efraín, 2026-09-12:
 * "barato para Haiku"). Solo tools que devuelven texto humano, nunca JSON. */
export const DIRECT_REPLY_TOOLS: ReadonlySet<string> = new Set([
  'mi_cartera', 'historial_oportunidad', 'registrar_seguimiento', 'cerrar_oportunidad',
]);

/** Encima del rol, estas herramientas piden el CORREO en una whitelist
 * (shared/visibility.ts). Las de dirección (Efraín, 2026-09-11): solo Elisa,
 * el CEO, Efraín y Jorge (webcmp) — PAM es admin y no las recibe. Por correo y
 * no por monday_user_id, que se presta con "Actuar en Monday como". */
const TOOL_EMAIL_GATES: Record<string, (email: string | null | undefined) => boolean> = {
  ranking_vendedores: puedeConsultarDireccion,
  resumen_ventas: puedeConsultarDireccion,
  oportunidades_por_validar: puedeConsultarDireccion,
  consulta_libre: puedeConsultarDireccion,
};

/** "campo (tipo): descripción" por tabla, para la descripción de consulta_libre.
 * Determinista (sale de CAMPOS), así que no rompe el prompt caching. */
const camposDoc = (t: Tabla) =>
  Object.entries(CAMPOS[t]).map(([k, d]) => `${k} (${d.tipo}): ${d.desc}`).join('; ');

/** ¿Este viewer puede usar esta herramienta? Rol Y (si aplica) correo. */
export function puedeUsarTool(name: string, viewer: Pick<Identity, 'role' | 'email'>): boolean {
  if (!TOOL_ROLES[name]?.includes(viewer.role)) return false;
  const gate = TOOL_EMAIL_GATES[name];
  return gate ? gate(viewer.email) : true;
}

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'buscar_productos',
    description: 'Busca productos en el catálogo CMP por nombre o SKU. Úsala SIEMPRE antes de agregar una línea de producto a una oportunidad, para vincular el producto correcto del catálogo.',
    input_schema: {
      type: 'object',
      properties: { q: { type: 'string', description: 'Texto a buscar (nombre parcial o SKU)' } },
      required: ['q'],
    },
  },
  {
    name: 'buscar_contactos',
    description: 'Busca contactos (personas) existentes en el CRM por nombre.',
    input_schema: {
      type: 'object',
      properties: { q: { type: 'string', description: 'Nombre parcial del contacto' } },
      required: ['q'],
    },
  },
  {
    name: 'buscar_instituciones',
    description: 'Busca instituciones (clientes/organizaciones) existentes en el CRM por nombre.',
    input_schema: {
      type: 'object',
      properties: { q: { type: 'string', description: 'Nombre parcial de la institución' } },
      required: ['q'],
    },
  },
  {
    name: 'crear_contacto',
    description: 'Crea un contacto nuevo en el CRM. Solo llamar después de que el usuario confirmó explícitamente el resumen de los datos.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre completo del contacto' },
        email: { type: 'string', description: 'Correo electrónico' },
        telefono: { type: 'string', description: 'Teléfono (10 dígitos MX)' },
        cargo: { type: 'string', description: 'Cargo o puesto' },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'crear_oportunidad',
    description: 'Crea una oportunidad de venta con sus líneas de producto. Solo llamar después de que el usuario confirmó explícitamente el resumen. Cada línea debe traer producto_item_id si el producto se encontró en el catálogo con buscar_productos.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre de la oportunidad (ej. "Uniformes Hospital General León")' },
        contacto_item_id: { type: 'number', description: 'item_id del contacto en el CRM (de buscar_contactos), si aplica' },
        fecha_limite: { type: 'string', description: 'Fecha límite YYYY-MM-DD, si el usuario la dio' },
        zona: { type: 'string', description: 'Zona de venta, solo si el usuario la indicó' },
        lineas: {
          type: 'array',
          description: 'Líneas de producto (mínimo 1)',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string', description: 'Nombre del producto tal como lo pidió el cliente' },
              producto_item_id: { type: 'number', description: 'item_id del producto en catálogo (de buscar_productos). Omitir SOLO si el producto no existe en catálogo y el usuario confirmó que va fuera de catálogo.' },
              cantidad: { type: 'number', description: 'Cantidad de piezas' },
              color: { type: 'string', description: 'Color solicitado' },
              comentarios: { type: 'string', description: 'Detalles: tallas, notas del cliente (embellecimiento va en embellecimiento_zonas, no aquí)' },
              embellecimiento_zonas: {
                type: 'array',
                description: 'Zonas de embellecimiento (logo/bordado/estampado) que el vendedor confirmó para esta línea. Omitir/vacío si la línea no lleva embellecimiento.',
                items: {
                  type: 'object',
                  properties: {
                    zona: { type: 'string', enum: [...EMBELL_TEMPLATE_KEYS], description: 'Zona exacta de la lista de 8 zonas' },
                    descripcion: { type: 'string', description: 'Descripción libre de lo que lleva esa zona (técnica/tamaño si el vendedor los dio)' },
                  },
                  required: ['zona', 'descripcion'],
                },
              },
            },
            required: ['nombre', 'cantidad'],
          },
        },
      },
      required: ['nombre', 'lineas'],
    },
  },
  {
    name: 'consultar_pipeline',
    description: 'Resumen del pipeline de ventas: número de oportunidades y monto total por etapa, más totales de abiertas/ganadas/perdidas. Llámala cuando pregunten "¿cómo va mi pipeline?", "¿cuántas oportunidades abiertas hay?", montos por etapa, etc.',
    input_schema: {
      type: 'object',
      properties: {
        incluir_cerradas: { type: 'boolean', description: 'Incluir también Ganada/Perdida/Cancelada en el desglose por etapa (default: solo el resumen las menciona)' },
        vendedor: { type: 'string', description: 'Filtrar por nombre del vendedor (solo roles compras/admin; los vendedores siempre ven solo lo suyo)' },
      },
    },
  },
  {
    name: 'listar_oportunidades',
    description: 'Lista oportunidades con folio, etapa, institución, monto y fecha límite. Filtra por etapa, texto (nombre/institución/folio) o vendedor. Úsala para preguntas tipo "¿qué oportunidades tengo en costeo?", "¿qué hay de Hospital X?".',
    input_schema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Texto a buscar en nombre, institución, folio o vendedor' },
        etapa: { type: 'string', description: 'Nombre de la etapa exacta, ej. "Nueva oportunidad", "En costeo", "Ganada"' },
        solo_abiertas: { type: 'boolean', description: 'true = excluir Ganada/Perdida/Cancelada' },
        vendedor: { type: 'string', description: 'Filtrar por nombre del vendedor (solo compras/admin)' },
        limite: { type: 'number', description: 'Máximo de filas (default 15, máx 40)' },
      },
    },
  },
  {
    name: 'detalle_oportunidad',
    description: 'Detalle completo de UNA oportunidad (todos los campos visibles para tu rol) incluyendo sus líneas de producto. Identifícala por item_id (de listar_oportunidades) o por folio.',
    input_schema: {
      type: 'object',
      properties: {
        item_id: { type: 'number', description: 'item_id de la oportunidad' },
        folio: { type: 'string', description: 'Folio de la oportunidad (si no tienes el item_id)' },
      },
    },
  },
  {
    name: 'listar_proyectos',
    description: 'Lista proyectos post-venta (oportunidades ganadas en ejecución) con estado, estado de pago y fecha de entrega. Filtra por texto. Para el detalle de UN proyecto usa detalle_proyecto.',
    input_schema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Texto a buscar (nombre, institución, folio)' },
        limite: { type: 'number', description: 'Máximo de filas (default 15, máx 40)' },
      },
    },
  },
  {
    name: 'detalle_proyecto',
    description: 'Detalle de UN proyecto post-venta: todos sus campos visibles para tu rol (estado, pagos, facturación, fechas, responsables, oportunidad de origen…), qué documentos ya están subidos y cuáles faltan (OC firmada, OC a proveedores, acta de entrega… — solo nombres, no el contenido), y sus productos resumidos por producto+color (piezas, desglose de tallas, estado de cada producto, números de guía). Úsala para "¿cómo va el proyecto X?", "¿ya subieron la OC firmada de…?", "¿qué falta entregar en…?". Identifícalo por item_id, folio (PRO-…) o texto (nombre/institución).',
    input_schema: {
      type: 'object',
      properties: {
        item_id: { type: 'number', description: 'item_id del proyecto (de listar_proyectos)' },
        folio: { type: 'string', description: 'Folio del proyecto, p. ej. PRO-0020' },
        q: { type: 'string', description: 'Nombre o institución si no tienes folio; si hay varios, te regresa candidatos para preguntar cuál' },
      },
    },
  },
  {
    name: 'consultar_inventario',
    description: 'Existencias actuales de inventario por producto y almacén (bodegas y vendedores). Opcionalmente filtra por producto o almacén.',
    input_schema: {
      type: 'object',
      properties: {
        producto: { type: 'string', description: 'Nombre parcial del producto' },
        almacen: { type: 'string', description: 'Nombre parcial del almacén o vendedor' },
      },
    },
  },
  {
    name: 'movimientos_inventario',
    description: 'Últimos movimientos de inventario (Entrada/Salida/Transferencia/Consolidación), opcionalmente filtrados por producto.',
    input_schema: {
      type: 'object',
      properties: {
        producto: { type: 'string', description: 'Nombre parcial del producto' },
        limite: { type: 'number', description: 'Máximo de movimientos (default 10, máx 30)' },
      },
    },
  },
  {
    name: 'listar_almacenes',
    description: 'Lista los almacenes activos (bodegas y vendedores) con su id. Úsala SIEMPRE antes de registrar un movimiento que lleve almacén de origen o destino, para obtener el id correcto — nunca inventes ids de almacén.',
    input_schema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Texto parcial para filtrar por nombre de almacén o vendedor (opcional)' },
      },
    },
  },
  {
    name: 'crear_movimiento',
    description: 'Registra un movimiento de inventario (agregar o dar de baja stock). Es la MISMA captura que el formulario del portal: mismas reglas de qué almacenes lleva cada tipo. Solo llamar después de que el usuario confirmó explícitamente el resumen. Antes, usa buscar_productos para el nombre exacto del producto y listar_almacenes para los ids de almacén.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          enum: [...MOVEMENT_TYPES],
          description: 'Entrada = agrega stock (solo almacén de destino). Salida = da de baja stock (solo almacén de origen). Transferencia = mueve entre dos almacenes (origen y destino distintos). Consolidación = ajuste de conteo físico: exactamente un almacén (destino si sobran piezas/ajuste al alza, origen si faltan/ajuste a la baja).',
        },
        producto: { type: 'string', description: 'Nombre del producto tal como aparece en el catálogo (de buscar_productos). Si el producto no está en catálogo, el nombre que el usuario confirmó.' },
        cantidad: { type: 'number', description: 'Cantidad de piezas (siempre positiva, mayor a 0). Para Salida/ajuste a la baja también es positiva: el tipo ya indica que sale stock.' },
        almacen_origen_id: { type: 'number', description: 'id del almacén de origen (de listar_almacenes). Requerido para Salida y Transferencia, y para Consolidación a la baja. Omitir en Entrada.' },
        almacen_destino_id: { type: 'number', description: 'id del almacén de destino (de listar_almacenes). Requerido para Entrada y Transferencia, y para Consolidación al alza. Omitir en Salida.' },
        notas: { type: 'string', description: 'Nota opcional del movimiento' },
      },
      required: ['tipo', 'producto', 'cantidad'],
    },
  },
  {
    name: 'ranking_vendedores',
    description: 'Ranking de vendedores: por cada uno, oportunidades creadas, cotizadas (número y monto), ganadas (número y monto), tasa de cierre y pipeline abierto. Úsala para "¿quién es el mejor vendedor?", "¿quién vende más?", "¿cómo va cada vendedor?". Mismos números que el tablero de Análisis del portal.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD, inclusive. Filtra por fecha de CREACIÓN de la oportunidad. Omitir desde y hasta = AÑO EN CURSO (desde el 1 de enero).' },
        hasta: { type: 'string', description: 'YYYY-MM-DD, inclusive. Omitir = hasta hoy.' },
        toda_la_historia: { type: 'boolean', description: 'true SOLO si piden el histórico completo ("desde siempre", "histórico"); ignora el default del año en curso.' },
        criterio: { type: 'string', enum: ['monto_ganado', 'monto_cotizado', 'tasa_cierre', 'ganadas'], description: 'Cómo ordenar (default monto_ganado).' },
      },
    },
  },
  {
    name: 'resumen_ventas',
    description: 'Resumen del negocio: embudo (creadas → mandadas a costeo → costeo validado → cotizadas → ganadas) con número y monto en cada paso, conversión (ganadas/perdidas/abiertas, tasa de cierre, montos ganado/perdido/abierto), tiempo de costeo y datos por resolver. Úsala para "¿cuánto hemos cotizado?", "¿cuánto hemos ganado?", "¿cómo vamos este mes?". Opcionalmente desglosa por zona o vendedor.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD, inclusive. Filtra por fecha de CREACIÓN de la oportunidad. Omitir desde y hasta = AÑO EN CURSO (desde el 1 de enero).' },
        hasta: { type: 'string', description: 'YYYY-MM-DD, inclusive. Omitir = hasta hoy.' },
        toda_la_historia: { type: 'boolean', description: 'true SOLO si piden el histórico completo ("desde siempre", "histórico"); ignora el default del año en curso.' },
        por: { type: 'string', enum: ['zona', 'vendedor'], description: 'Desglose opcional por zona o vendedor.' },
      },
    },
  },
  {
    name: 'oportunidades_por_validar',
    description: 'Oportunidades en "Costeo en validación": Compras ya las costeó y falta que dirección confirme el Precio de Venta y valide el costeo. Dice cuáles ya están listas (todas las líneas con precio) y a cuáles les falta precio, con monto y días desde que se mandaron a costeo. Úsala para "¿qué oportunidades hay que verificar/validar/revisar?".',
    input_schema: {
      type: 'object',
      properties: {
        vendedor: { type: 'string', description: 'Filtrar por nombre del vendedor (opcional)' },
      },
    },
  },
  {
    name: 'consulta_libre',
    description: [
      'Consulta abierta sobre oportunidades o líneas de producto: filtra, agrupa y calcula (contar, suma, promedio, mediana, min, max, contar_distintos). Úsala para cualquier pregunta de negocio que las otras herramientas no contesten directo: "¿qué zona va mejor?", "¿qué producto se vende más?", "¿qué institución nos compra más?", "¿cómo vamos por mes?", "¿qué marca vendemos más?". Puedes llamarla varias veces (p. ej. para comparar dos periodos). NUNCA sumes ni promedies tú: pide la métrica aquí.',
      'Ejemplos: mejor zona por ventas ganadas = {tabla:"oportunidades", filtros:[{campo:"estado",op:"=",valor:"ganada"}], agrupar_por:["zona"], metricas:[{fn:"suma",campo:"monto"}]}. Producto más vendido = {tabla:"lineas", filtros:[{campo:"estado",op:"=",valor:"ganada"}], agrupar_por:["producto"], metricas:[{fn:"suma",campo:"cantidad"},{fn:"suma",campo:"subtotal"}]}. Creadas por mes = {tabla:"oportunidades", agrupar_por:["mes_creada"], ordenar_por:"mes_creada", ascendente:true}.',
      'Fechas YYYY-MM-DD; un filtro con "2026-08" abarca todo agosto. Texto sin importar acentos/mayúsculas. No existe fecha de ganada: los periodos son por fecha de creación (o de costeo/cotización). Montos en MXN sin IVA.',
      `Campos de "oportunidades" (una fila por oportunidad): ${camposDoc('oportunidades')}.`,
      `Campos de "lineas" (una fila por línea de producto, con los datos de su oportunidad): ${camposDoc('lineas')}.`,
      'Sin ningún filtro de fecha, la consulta se limita al AÑO EN CURSO (creada desde el 1 de enero) y el resultado trae `periodo`; toda_la_historia:true lo quita (solo si piden el histórico).',
      'Si un campo no está disponible para tu usuario, la herramienta lo dice.',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        tabla: { type: 'string', enum: ['oportunidades', 'lineas'] },
        filtros: {
          type: 'array',
          description: 'Condiciones (todas deben cumplirse). Máx. 10.',
          items: {
            type: 'object',
            properties: {
              campo: { type: 'string' },
              op: { type: 'string', enum: [...OPS] },
              valor: { description: 'Texto, número, true/false, fecha YYYY-MM-DD o YYYY-MM; lista para "en"; omitir en vacio/no_vacio.' },
            },
            required: ['campo', 'op'],
          },
        },
        agrupar_por: { type: 'array', items: { type: 'string' }, description: 'Hasta 2 campos. Omitir para totales o listado.' },
        metricas: {
          type: 'array',
          description: 'Hasta 6. El resultado nombra cada una como fn_campo (p. ej. suma_monto); "contar" siempre va.',
          items: {
            type: 'object',
            properties: {
              fn: { type: 'string', enum: [...FNS] },
              campo: { type: 'string', description: 'Requerido salvo en contar' },
            },
            required: ['fn'],
          },
        },
        columnas: { type: 'array', items: { type: 'string' }, description: 'Solo para listado (sin agrupar ni métricas): qué campos mostrar.' },
        ordenar_por: { type: 'string', description: 'Agrupado: nombre de la métrica (p. ej. suma_monto) o del campo agrupado. Listado: un campo. Default: la primera métrica, de mayor a menor.' },
        ascendente: { type: 'boolean', description: 'true = de menor a mayor (default false)' },
        limite: { type: 'number', description: `Máximo de filas/grupos (default 20, máx ${LIMITE_MAX})` },
        toda_la_historia: { type: 'boolean', description: 'true SOLO si piden el histórico completo; sin filtro de fecha el default es el año en curso.' },
      },
      required: ['tabla'],
    },
  },
];

/** The tool list offered to this viewer's agent (rol + whitelist por correo). */
const TOOLS_CARTERA: Anthropic.Tool[] = [
  {
    name: 'mi_cartera',
    description: 'La cartera de la persona ya priorizada y clasificada: por oportunidad abierta, etapa, días en etapa, días sin movimiento, monto, fecha límite, siguiente paso y categoría (se_mueve = lista para avanzar, atorada = lleva días en Nueva/En costeo, apagada = ≥14 días sin movimiento). Compras ve las que están en costeo o validación. Úsala para "¿qué priorizo hoy?", "¿cuáles llevan más de un mes paradas?", "¿qué tengo atorado?", "¿cómo va mi cartera?". Devuelve el texto final para la persona: NO lo reescribas, ya está redactado.',
    input_schema: {
      type: 'object',
      properties: {
        solo: { type: 'string', enum: ['se_mueve', 'atorada', 'apagada', 'normal'], description: 'Filtrar por categoría (opcional)' },
      },
    },
  },
  {
    name: 'historial_oportunidad',
    description: 'Cómo ha ido UNA oportunidad: cambios de etapa con fecha y quién, seguimientos registrados, siguiente paso. Úsala para "¿cómo va la de Hospital X?", "¿desde cuándo está en costeo?", "¿qué se le ha hecho a PRO-812?". Identifícala por item_id (de la lista en contexto o de listar_oportunidades) o por folio. Devuelve el texto final para la persona.',
    input_schema: {
      type: 'object',
      properties: {
        item_id: { type: 'number', description: 'item_id de la oportunidad' },
        folio: { type: 'string', description: 'Folio (PRO-…) si no tienes el item_id' },
      },
    },
  },
  {
    name: 'registrar_seguimiento',
    description: 'Guarda una nota de seguimiento en la oportunidad: queda como Actualización (update) real en Monday y en el historial del portal. Úsala cuando la persona cuente algo que pasó con una oportunidad ("llamé, piden muestra", "el cliente pide descuento", "la 2 sigue viva"). NO pidas confirmación: guárdalo y reporta. Si dice "la 2", toma el item_id de la lista numerada del contexto. Devuelve el texto final para la persona.',
    input_schema: {
      type: 'object',
      properties: {
        item_id: { type: 'number', description: 'item_id de la oportunidad' },
        texto: { type: 'string', description: 'La nota tal cual la dijo la persona, en sus palabras (no la resumas)' },
      },
      required: ['item_id', 'texto'],
    },
  },
  {
    name: 'cerrar_oportunidad',
    description: 'Mueve una oportunidad a Cancelada ("archivar": ya no va a pasar, sin competidor) o Perdida (la ganó otro proveedor) en Monday, con motivo opcional. Es una acción que cambia el CRM: SIEMPRE muestra antes un resumen (folio, nombre, etapa destino) y espera confirmación explícita ("sí", "confirmo"); sin ella no la llames. Devuelve el texto final para la persona.',
    input_schema: {
      type: 'object',
      properties: {
        item_id: { type: 'number', description: 'item_id de la oportunidad' },
        cierre: { type: 'string', enum: ['cancelada', 'perdida'], description: 'cancelada = archivar; perdida = la ganó un competidor' },
        motivo: { type: 'string', description: 'Motivo en palabras de la persona (opcional)' },
      },
      required: ['item_id', 'cierre'],
    },
  },
];
TOOLS.push(...TOOLS_CARTERA);

export function toolsFor(viewer: Pick<Identity, 'role' | 'email'>): Anthropic.Tool[] {
  return TOOLS.filter(t => puedeUsarTool(t.name, viewer));
}

// ── Column helpers over mirror rows ───────────────────────────────────────────

interface MirrorRow { item_id: number; name: string; columns: string }
interface ColEntry { id: string; type?: string; text: string | null; value: string | null }

function colEntries(columnsJson: string): Map<string, ColEntry> {
  try {
    const cols = JSON.parse(columnsJson) as ColEntry[];
    return new Map(cols.map(c => [c.id, c]));
  } catch {
    return new Map();
  }
}

function colText(columnsJson: string, ids: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const byId = colEntries(columnsJson);
  for (const [key, id] of Object.entries(ids)) {
    const t = byId.get(id)?.text;
    if (t) out[key] = t;
  }
  return out;
}

/** Mirror columns fan in one value per subitem, joined with ", ". Collapse to
 * the distinct values for display ("Listo, Listo" -> "Listo"). */
function dedupeMirror(text: string): string {
  const parts = Array.from(new Set(text.split(/,\s+/).map(s => s.trim()).filter(Boolean)));
  return parts.length <= 3 ? parts.join(', ') : `${parts[0]} +${parts.length - 1}`;
}

/** Venta total por oportunidad, computada de sus líneas en el mirror:
 * Σ (Precio de Venta C/U × Cantidad). One aggregate query over the subitem
 * board; keys are parent item_ids. Unscoped on purpose — results are only ever
 * joined to opps the viewer already passed the DAL scope for. */
async function ventaPorOportunidad(env: Env): Promise<Map<number, number>> {
  const numCol = (id: string) =>
    `COALESCE((SELECT CAST(json_extract(je.value,'$.text') AS REAL)
       FROM json_each(items.columns) je
       WHERE json_extract(je.value,'$.id') = '${id}'), 0)`;
  const sql = `
    SELECT parent_item_id AS opp, SUM(${numCol(SUB.precioVenta)} * ${numCol(SUB.cantidad)}) AS venta
    FROM items WHERE board_id = ? AND parent_item_id IS NOT NULL
    GROUP BY parent_item_id`;
  const res = await env.DB.prepare(sql).bind(BOARDS.oportunidades_sub.id).all<{ opp: number; venta: number }>();
  return new Map((res.results ?? []).map(r => [r.opp, Math.round((r.venta ?? 0) * 100) / 100]));
}

/** deal_stage key ("4", "15", ...) of an oportunidad row; null if unknown. */
function stageKeyOf(cols: Map<string, ColEntry>): string | null {
  const c = cols.get(OPP.etapa);
  if (!c) return null;
  try {
    const v = JSON.parse(c.value ?? 'null') as { index?: number } | null;
    if (v && typeof v.index === 'number') return String(v.index);
  } catch { /* fall through to label lookup */ }
  return c.text ? (stageKeyForLabel(c.text) ?? null) : null;
}

const like = (haystack: string | undefined | null, needle: string) =>
  (haystack ?? '').toLowerCase().includes(needle.trim().toLowerCase());

/** One oportunidad row -> compact summary object for lists/aggregates. */
function oppSummary(row: MirrorItem, venta: Map<number, number>) {
  const cols = colEntries(row.columns);
  const t = (id: string) => cols.get(id)?.text ?? null;
  const key = stageKeyOf(cols);
  const out: Record<string, unknown> = {
    item_id: row.item_id,
    folio: t(OPP.folio),
    nombre: row.name,
    etapa: key ? DEAL_STAGE_LABELS[key] ?? key : t(OPP.etapa),
    institucion: t(OPP.institucion) ? dedupeMirror(t(OPP.institucion)!) : null,
    vendedor: t(OPP.vendedor),
    monto_venta: venta.get(row.item_id) ?? 0,
    fecha_limite: t(OPP.fechaLimite),
  };
  return { out, key };
}

// Column types that never make sense in a chat answer.
const SKIP_TYPES = new Set([
  'button', 'file', 'subtasks', 'unsupported', 'creation_log', 'last_updated', 'direct_doc',
]);

/** All non-empty, role-readable columns of a row as {Título: texto}. */
function readableRecord(
  slug: keyof typeof COLUMN_META, row: MirrorItem, role: Role, email?: string | null,
): Record<string, string> {
  const cols = colEntries(row.columns);
  const out: Record<string, string> = { nombre: row.name };
  // El agente (WhatsApp y chat del portal) lee por las MISMAS reglas que el
  // portal: sin el correo, "¿cuánto dejó esta oportunidad?" contestaría con la
  // utilidad a quien la pantalla ya no se la enseña.
  for (const id of readableCols(slug, role, email)) {
    const meta = COLUMN_META[slug][id];
    if (!meta || SKIP_TYPES.has(meta.type)) continue;
    const text = cols.get(id)?.text?.trim();
    if (!text) continue;
    out[meta.title] = meta.type === 'mirror' ? dedupeMirror(text) : text;
  }
  return out;
}

// ── Mirror search (catalog/contacts/institutions quick lookups) ───────────────

/** Mirror search: item name LIKE, plus optional extra text columns (e.g. SKU). */
async function searchMirror(
  env: Env,
  boardId: number,
  q: string,
  extraColIds: string[] = [],
): Promise<MirrorRow[]> {
  const likeQ = `%${q.trim()}%`;
  let sql = `SELECT item_id, name, columns FROM items WHERE board_id = ? AND (name LIKE ? COLLATE NOCASE`;
  const binds: unknown[] = [boardId, likeQ];
  if (extraColIds.length > 0) {
    const ph = extraColIds.map(() => '?').join(',');
    sql += ` OR EXISTS (SELECT 1 FROM json_each(items.columns) je
             WHERE json_extract(je.value,'$.id') IN (${ph})
             AND json_extract(je.value,'$.text') LIKE ? COLLATE NOCASE)`;
    binds.push(...extraColIds, likeQ);
  }
  sql += `) ORDER BY name LIMIT 8`;
  const res = await env.DB.prepare(sql).bind(...binds).all<MirrorRow>();
  return res.results ?? [];
}

function fmtResults(rows: MirrorRow[], cols: Record<string, string>): string {
  if (rows.length === 0) return 'Sin resultados.';
  const list = rows.map(r => ({ item_id: r.item_id, nombre: r.name, ...colText(r.columns, cols) }));
  const suffix = rows.length === 8 ? '\n(Puede haber más resultados; afina la búsqueda.)' : '';
  return JSON.stringify(list) + suffix;
}

// ── Query tool implementations ────────────────────────────────────────────────

async function scopedOportunidades(env: Env, viewer: Identity, q?: string): Promise<MirrorItem[]> {
  // listItems applies the row-level vendedor scope (worker/lib/dal.ts) and the
  // shared searchable-columns LIKE — same predicate the portal boards use.
  return listItems(env, 'oportunidades', viewer, q);
}

async function toolConsultarPipeline(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<string> {
  const [rows, venta] = await Promise.all([scopedOportunidades(env, viewer), ventaPorOportunidad(env)]);
  const vendedorFilter = viewer.role !== 'vendedor' && typeof input.vendedor === 'string' && input.vendedor.trim()
    ? input.vendedor : null;
  const incluirCerradas = input.incluir_cerradas === true;

  const perStage = new Map<string, { n: number; monto: number }>();
  const resumen = { abiertas: { n: 0, monto: 0 }, ganadas: { n: 0, monto: 0 }, perdidas_canceladas: { n: 0, monto: 0 } };

  for (const row of rows) {
    const { out, key } = oppSummary(row, venta);
    if (vendedorFilter && !like(out.vendedor as string | null, vendedorFilter)) continue;
    const k = key ?? '?';
    const monto = typeof out.monto_venta === 'number' ? out.monto_venta : 0;
    const slot = perStage.get(k) ?? { n: 0, monto: 0 };
    slot.n += 1; slot.monto += monto;
    perStage.set(k, slot);
    if (key && CLOSED_STAGES.has(key)) {
      const bucket = key === '1' ? resumen.ganadas : resumen.perdidas_canceladas;
      bucket.n += 1; bucket.monto += monto;
    } else {
      resumen.abiertas.n += 1; resumen.abiertas.monto += monto;
    }
  }

  const orden = incluirCerradas ? DEAL_STAGE_ORDER : DEAL_STAGE_ORDER.filter(k => !CLOSED_STAGES.has(k));
  const etapas = orden
    .filter(k => perStage.has(k))
    .map(k => ({ etapa: DEAL_STAGE_LABELS[k] ?? k, oportunidades: perStage.get(k)!.n, monto_total: Math.round(perStage.get(k)!.monto * 100) / 100 }));
  if (perStage.has('?')) etapas.push({ etapa: 'Sin etapa', oportunidades: perStage.get('?')!.n, monto_total: perStage.get('?')!.monto });

  return JSON.stringify({
    alcance: viewer.role === 'vendedor' ? 'solo tus oportunidades' : (vendedorFilter ? `vendedor ~ "${vendedorFilter}"` : 'todas las oportunidades'),
    nota: 'monto_total (MXN) = suma por oportunidad de Precio de Venta C/U × Cantidad de sus líneas; 0 = sin precios capturados aún',
    resumen,
    por_etapa: etapas,
  });
}

async function toolListarOportunidades(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<string> {
  const q = typeof input.q === 'string' && input.q.trim() ? input.q.trim() : undefined;
  const [rows, venta] = await Promise.all([scopedOportunidades(env, viewer, q), ventaPorOportunidad(env)]);

  let etapaKey: string | undefined;
  if (typeof input.etapa === 'string' && input.etapa.trim()) {
    etapaKey = stageKeyForLabel(input.etapa);
    if (!etapaKey) {
      return JSON.stringify({ error: `Etapa desconocida: "${input.etapa}". Etapas válidas: ${Object.values(DEAL_STAGE_LABELS).join(', ')}` });
    }
  }
  const soloAbiertas = input.solo_abiertas === true;
  const vendedorFilter = viewer.role !== 'vendedor' && typeof input.vendedor === 'string' && input.vendedor.trim()
    ? input.vendedor : null;
  const limite = Math.min(Math.max(Number(input.limite) || 15, 1), 40);

  const matches: Record<string, unknown>[] = [];
  for (const row of rows) {
    const { out, key } = oppSummary(row, venta);
    if (etapaKey && key !== etapaKey) continue;
    if (soloAbiertas && key && CLOSED_STAGES.has(key)) continue;
    if (vendedorFilter && !like(out.vendedor as string | null, vendedorFilter)) continue;
    matches.push(out);
  }

  const page = matches.slice(0, limite);
  return JSON.stringify({
    total_encontradas: matches.length,
    mostrando: page.length,
    oportunidades: page,
    ...(matches.length > page.length ? { nota: 'Hay más resultados; afina el filtro o sube el límite.' } : {}),
  });
}

async function toolDetalleOportunidad(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<{ content: string; isError: boolean }> {
  let item: MirrorItem | null = null;

  if (typeof input.item_id === 'number') {
    item = await getItem(env, 'oportunidades', input.item_id, viewer);
  } else if (typeof input.folio === 'string' && input.folio.trim()) {
    const folio = input.folio.trim();
    const rows = await scopedOportunidades(env, viewer, folio);
    item = rows.find(r => (colEntries(r.columns).get(OPP.folio)?.text ?? '').trim() === folio)
      ?? rows.find(r => like(colEntries(r.columns).get(OPP.folio)?.text, folio))
      ?? null;
  } else {
    return { content: 'Indica item_id o folio.', isError: true };
  }

  if (!item) return { content: 'No encontré esa oportunidad (o no está dentro de tu alcance).', isError: true };

  const [lineas, venta] = await Promise.all([
    childrenOf(env, 'oportunidades', item.item_id, viewer),
    ventaPorOportunidad(env),
  ]);
  return {
    content: JSON.stringify({
      oportunidad: { item_id: item.item_id, ...readableRecord('oportunidades', item, viewer.role, viewer.email) },
      monto_venta: venta.get(item.item_id) ?? 0,
      nota_monto: 'monto_venta (MXN) = Σ Precio de Venta C/U × Cantidad de las líneas; 0 = sin precios capturados',
      lineas: lineas.slice(0, 30).map(l => readableRecord('oportunidades_sub', l, viewer.role, viewer.email)),
      ...(lineas.length > 30 ? { nota: `Mostrando 30 de ${lineas.length} líneas.` } : {}),
    }),
    isError: false,
  };
}

async function toolListarProyectos(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<string> {
  const q = typeof input.q === 'string' && input.q.trim() ? input.q.trim() : undefined;
  const limite = Math.min(Math.max(Number(input.limite) || 15, 1), 40);
  const rows = await listItems(env, 'proyectos', viewer, q);

  const list = rows.slice(0, limite).map(row => {
    const t = (id: string) => colEntries(row.columns).get(id)?.text ?? null;
    return {
      item_id: row.item_id,
      folio: t(PROYECTO.folio),
      nombre: row.name,
      estado: t(PROYECTO.estado),
      estado_pago: t(PROYECTO.estadoPago),
      fecha_entrega: t(PROYECTO.fechaEntrega),
      institucion: t(PROYECTO.institucion) ? dedupeMirror(t(PROYECTO.institucion)!) : null,
      vendedor: t(PROYECTO.vendedor),
    };
  });
  return JSON.stringify({
    total_encontrados: rows.length,
    mostrando: list.length,
    proyectos: list,
    ...(rows.length > list.length ? { nota: 'Hay más resultados; afina el filtro o sube el límite.' } : {}),
  });
}

/** Nombres de los archivos de una columna `file` del mirror: el `value` trae
 * `files[]` con el nombre; si no, se cuentan las URLs del `text`. Solo nombres —
 * el bot nunca abre ni reparte el contenido. */
function archivosDe(c: ColEntry | undefined): string[] {
  if (!c) return [];
  try {
    const v = JSON.parse(c.value ?? 'null') as { files?: Array<{ name?: string }> } | null;
    if (Array.isArray(v?.files)) return v.files.map(f => String(f.name ?? 'archivo'));
  } catch { /* cae al texto */ }
  const t = c.text?.trim();
  return t ? t.split(/,\s+(?=https?:\/\/)/).map(() => 'archivo') : [];
}

/** Documentos del Proyecto: una entrada por columna `file` que el rol puede
 * ver (shared/visibility.ts — al vendedor no le aparecen las OC internas ni a
 * proveedores), subido o no, con los nombres. */
export function documentosProyecto(row: Pick<MirrorItem, 'columns'>, role: Role, email?: string | null) {
  const cols = colEntries(row.columns);
  return readableCols('proyectos', role, email)
    .filter(id => COLUMN_META.proyectos[id]?.type === 'file')
    .map(id => {
      const archivos = archivosDe(cols.get(id));
      return {
        documento: COLUMN_META.proyectos[id].title.replace(/\(oculto\)/i, '').replace(/\s+/g, ' ').trim(),
        subido: archivos.length > 0,
        ...(archivos.length ? { archivos: archivos.slice(0, 5) } : {}),
        ...(archivos.length > 5 ? { mas: archivos.length - 5 } : {}),
      };
    });
}

/** Líneas del Proyecto (una por talla, hasta 150) resumidas por producto+color:
 * piezas, desglose de tallas, estados y guías. Mandarlas crudas reventaba el
 * mensaje de WhatsApp (cada línea trae 8 textos de embellecimiento). Cada dato
 * se gatea por su columna — mismo criterio que readableRecord. */
export function resumenLineasProyecto(lineas: Array<Pick<MirrorItem, 'name' | 'columns'>>, role: Role, email?: string | null) {
  const puede = (id: string) => canRead('proyectos_sub', id, role, email);
  const grupos = new Map<string, {
    producto: string; sku: string | null; color: string | null; piezas: number;
    tallas: Map<string, number>; estados: Map<string, number>; guias: Set<string>;
  }>();
  const estadosTotal = new Map<string, number>();
  let piezasTotal = 0;
  const suma = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);

  for (const l of lineas) {
    const cols = colEntries(l.columns);
    // "nan" = celda vacía que dejó la importación de tallas desde Sheets (visto
    // en prod: Color "nan" en placas balísticas) — se trata como vacío.
    const t = (id: string) => {
      const v = puede(id) ? cols.get(id)?.text?.trim() || null : null;
      return v && v.toLowerCase() !== 'nan' ? v : null;
    };
    const producto = t(PROYECTO_SUB.producto) ?? l.name;
    const color = t(PROYECTO_SUB.color);
    const cantidad = puede(PROYECTO_SUB.cantidad) ? Number((cols.get(PROYECTO_SUB.cantidad)?.text ?? '').replace(/,/g, '')) || 0 : 0;
    const key = `${producto.toLowerCase()}|${(color ?? '').toLowerCase()}`;
    const g = grupos.get(key) ?? {
      producto, sku: t(PROYECTO_SUB.sku), color, piezas: 0,
      tallas: new Map(), estados: new Map(), guias: new Set(),
    };
    g.piezas += cantidad;
    piezasTotal += cantidad;
    const talla = t(PROYECTO_SUB.talla);
    if (talla) suma(g.tallas, talla, cantidad);
    const estado = t(PROYECTO_SUB.estado);
    if (estado) { suma(g.estados, estado, 1); suma(estadosTotal, estado, 1); }
    const guia = t(PROYECTO_SUB.guia);
    if (guia) g.guias.add(guia);
    grupos.set(key, g);
  }

  const lista = [...grupos.values()].sort((a, b) => b.piezas - a.piezas);
  return {
    total_lineas: lineas.length,
    total_piezas: piezasTotal,
    ...(estadosTotal.size ? { lineas_por_estado: Object.fromEntries(estadosTotal) } : {}),
    productos: lista.slice(0, 30).map(g => ({
      producto: g.producto,
      ...(g.sku ? { sku: g.sku } : {}),
      ...(g.color ? { color: g.color } : {}),
      piezas: g.piezas,
      ...(g.tallas.size ? { tallas: [...g.tallas].map(([k, n]) => `${k}: ${n}`).join(', ') } : {}),
      ...(g.estados.size ? { estado: Object.fromEntries(g.estados) } : {}),
      ...(g.guias.size ? { guias: [...g.guias].slice(0, 5) } : {}),
    })),
    ...(lista.length > 30 ? { nota: `Mostrando 30 de ${lista.length} productos.` } : {}),
  };
}

async function toolDetalleProyecto(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<{ content: string; isError: boolean }> {
  let item: MirrorItem | null = null;
  const folioDe = (r: MirrorItem) => (colEntries(r.columns).get(PROYECTO.folio)?.text ?? '').trim();

  if (typeof input.item_id === 'number') {
    item = await getItem(env, 'proyectos', input.item_id, viewer);
  } else {
    const q = [input.folio, input.q].find((v): v is string => typeof v === 'string' && !!v.trim())?.trim();
    if (!q) return { content: 'Indica item_id, folio o q.', isError: true };
    // listItems aplica el scope del viewer (vendedor = solo sus proyectos).
    const rows = await listItems(env, 'proyectos', viewer, q);
    item = rows.find(r => folioDe(r).toLowerCase() === q.toLowerCase()) ?? (rows.length === 1 ? rows[0] : null);
    if (!item && rows.length > 1) {
      return {
        content: JSON.stringify({
          varios: rows.length,
          candidatos: rows.slice(0, 8).map(r => {
            const t = (id: string) => colEntries(r.columns).get(id)?.text ?? null;
            return { item_id: r.item_id, folio: folioDe(r) || null, nombre: r.name, institucion: t(PROYECTO.institucion) ? dedupeMirror(t(PROYECTO.institucion)!) : null };
          }),
          nota: 'Hay varios proyectos que coinciden: pregunta cuál y vuelve a llamar con su item_id.',
        }),
        isError: false,
      };
    }
  }
  if (!item) return { content: 'No encontré ese proyecto (o no está dentro de tu alcance).', isError: true };

  const lineas = await childrenOf(env, 'proyectos', item.item_id, viewer);
  return {
    content: JSON.stringify({
      proyecto: { item_id: item.item_id, ...readableRecord('proyectos', item, viewer.role, viewer.email) },
      documentos: documentosProyecto(item, viewer.role, viewer.email),
      lineas: resumenLineasProyecto(lineas, viewer.role, viewer.email),
    }),
    isError: false,
  };
}

async function toolConsultarInventario(env: Env, input: Record<string, unknown>): Promise<string> {
  const producto = typeof input.producto === 'string' ? input.producto.trim() : '';
  const almacen = typeof input.almacen === 'string' ? input.almacen.trim() : '';
  const stock = await listStock(env);
  const rows = stock.filter(r =>
    (!producto || like(r.productName, producto)) &&
    (!almacen || like(r.warehouseName, almacen)));
  const page = rows.slice(0, 60).map(r => ({
    producto: r.productName,
    almacen: r.warehouseName,
    tipo: r.warehouseType === 'person' ? 'vendedor' : 'bodega',
    existencia: r.stock,
  }));
  return JSON.stringify({
    filas: page.length,
    stock: page,
    ...(rows.length > page.length ? { nota: `Mostrando 60 de ${rows.length} filas; filtra por producto o almacén.` } : {}),
    ...(rows.length === 0 ? { nota: 'Sin existencias que coincidan.' } : {}),
  });
}

async function toolMovimientosInventario(env: Env, input: Record<string, unknown>): Promise<string> {
  const producto = typeof input.producto === 'string' ? input.producto.trim() : '';
  const limite = Math.min(Math.max(Number(input.limite) || 10, 1), 30);
  const [movs, warehouses] = await Promise.all([listMovements(env), listWarehouses(env)]);
  const wName = new Map(warehouses.map(w => [w.id, w.name]));
  const rows = movs.filter(m => !producto || like(m.productName, producto)).slice(0, limite).map(m => ({
    fecha: m.createdAt,
    tipo: m.type,
    producto: m.productName,
    cantidad: m.quantity,
    origen: m.originId ? wName.get(m.originId) ?? String(m.originId) : null,
    destino: m.destinationId ? wName.get(m.destinationId) ?? String(m.destinationId) : null,
    capturado_por: m.capturedBy,
    folio: m.folio,
  }));
  return JSON.stringify({ movimientos: rows });
}

async function toolListarAlmacenes(env: Env, input: Record<string, unknown>): Promise<string> {
  const q = typeof input.q === 'string' ? input.q.trim() : '';
  const warehouses = await listWarehouses(env);
  const rows = warehouses
    .filter(w => !q || like(w.name, q))
    .map(w => ({ id: w.id, nombre: w.name, tipo: w.type === 'person' ? 'vendedor' : 'bodega', ubicacion: w.location }));
  return JSON.stringify({
    almacenes: rows,
    ...(rows.length === 0 ? { nota: q ? 'Ningún almacén coincide.' : 'No hay almacenes activos.' } : {}),
  });
}

async function toolCrearMovimiento(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<string> {
  const tipo = input.tipo as MovementType;
  if (!MOVEMENT_TYPES.includes(tipo)) {
    return JSON.stringify({ ok: false, error: `Tipo inválido. Usa uno de: ${MOVEMENT_TYPES.join(', ')}.` });
  }
  const capturedBy = viewer.nombre ?? viewer.email;
  // createMovement (worker/lib/inventory.ts) aplica exactamente las mismas reglas
  // que el formulario del portal: validateMovementEndpoints por tipo, cantidad > 0,
  // existencia de almacenes y folio autoincremental.
  const movement = await createMovement(env, {
    type: tipo,
    productName: String(input.producto ?? ''),
    quantity: Number(input.cantidad),
    originId: typeof input.almacen_origen_id === 'number' ? input.almacen_origen_id : null,
    destinationId: typeof input.almacen_destino_id === 'number' ? input.almacen_destino_id : null,
    capturedBy,
    notes: typeof input.notas === 'string' ? input.notas : undefined,
  });
  return JSON.stringify({
    ok: true,
    id: movement.id,
    folio: movement.folio,
    tipo: movement.type,
    producto: movement.productName,
    cantidad: movement.quantity,
    capturado_por: movement.capturedBy,
  });
}

// ── Consultas de dirección (whitelist por correo) ─────────────────────────────
// Ranking y resumen salen de buildAnalyticsResponse (worker/lib/analytics.ts):
// los MISMOS números que el tablero de Análisis, con su scope (zona privada
// incluida) y su candado de utilidades — el bot no recalcula nada por su lado.

const redondea = (n: number) => Math.round(n * 100) / 100;
const pct = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10);

/** YYYY-MM-DD → ISO del inicio/fin del día; null si no vino; error si vino mal. */
function fechaFiltro(raw: unknown, finDelDia: boolean): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const d = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) {
    throw new ToolInputError(`Fecha inválida "${d}": usa YYYY-MM-DD.`);
  }
  return finDelDia ? `${d}T23:59:59.999Z` : `${d}T00:00:00.000Z`;
}

class ToolInputError extends Error {}

async function analisis(env: Env, viewer: Identity, input: Record<string, unknown>, por: GroupBy): Promise<AnalyticsResponse> {
  const desde = fechaFiltro(input.desde, false);
  const hasta = fechaFiltro(input.hasta, true);
  // Sin periodo = año en curso (Efraín, 2026-09-11), salvo que pidan el histórico.
  const anioDefault = !desde && !hasta && input.toda_la_historia !== true;
  return buildAnalyticsResponse(env, viewer, {
    por,
    desde: anioDefault ? `${anioEnCurso()}-01-01T00:00:00.000Z` : desde,
    hasta,
  });
}

function paso(embudo: GrupoMetrics['embudo'], step: FunnelStep) {
  return embudo.find(b => b.step === step) ?? { n: 0, monto: 0 };
}

function periodoTexto(r: AnalyticsResponse): string {
  if (!r.desde && !r.hasta) return 'toda la historia';
  const anio = anioEnCurso();
  if (r.desde === `${anio}-01-01T00:00:00.000Z` && !r.hasta) return `año en curso (${anio}): oportunidades creadas desde ${anio}-01-01`;
  return `oportunidades creadas ${r.desde ? `desde ${r.desde.slice(0, 10)}` : ''}${r.desde && r.hasta ? ' ' : ''}${r.hasta ? `hasta ${r.hasta.slice(0, 10)}` : ''}`;
}

const NOTA_MONTOS = 'Montos en MXN sin IVA = Subtotal de las líneas vigentes de cada oportunidad. El periodo filtra por fecha de CREACIÓN de la oportunidad (igual que el tablero de Análisis).';
const NOTA_SIN_UTILIDAD = 'La utilidad no está disponible para tu usuario.';

function grupoCompacto(g: GrupoMetrics) {
  const cot = paso(g.embudo, 'cotizada');
  return {
    nombre: g.clave,
    creadas: g.creadas,
    cotizadas: cot.n,
    monto_cotizado: redondea(cot.monto),
    ganadas: g.conversion.ganadas,
    monto_ganado: redondea(g.conversion.montoGanado),
    perdidas_o_canceladas: g.conversion.perdidas + g.conversion.canceladas,
    abiertas: g.conversion.abiertas,
    tasa_cierre_pct: pct(g.conversion.tasaCierre),
    pipeline_abierto: redondea(g.conversion.montoAbierto),
    ...(g.utilidadGanada !== undefined ? { utilidad_ganada: redondea(g.utilidadGanada) } : {}),
  };
}

async function toolRankingVendedores(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<string> {
  const r = await analisis(env, viewer, input, 'vendedor');
  const criterio = typeof input.criterio === 'string' ? input.criterio : 'monto_ganado';
  const filas = r.grupos.map(grupoCompacto);
  const valor = (f: ReturnType<typeof grupoCompacto>): number => {
    switch (criterio) {
      case 'monto_cotizado': return f.monto_cotizado;
      case 'tasa_cierre': return f.tasa_cierre_pct ?? -1;
      case 'ganadas': return f.ganadas;
      default: return f.monto_ganado;
    }
  };
  filas.sort((a, b) => valor(b) - valor(a) || b.monto_ganado - a.monto_ganado);
  return JSON.stringify({
    periodo: periodoTexto(r),
    ordenado_por: criterio,
    vendedores: filas.slice(0, 25).map((f, i) => ({ lugar: i + 1, ...f })),
    notas: [
      NOTA_MONTOS,
      'tasa_cierre_pct = ganadas / (ganadas + perdidas + canceladas); null = todavía no cierra ninguna.',
      'El vendedor es el "Vendedor" de la oportunidad en Monday; "(sin asignar)" = sin vendedor.',
      ...(r.utilidadGanada === undefined ? [NOTA_SIN_UTILIDAD] : []),
    ],
    datos_al: r.syncedAt,
  });
}

async function toolResumenVentas(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<string> {
  const por: GroupBy | null = input.por === 'zona' || input.por === 'vendedor' ? input.por : null;
  const r = await analisis(env, viewer, input, por ?? 'vendedor');
  const c = r.conversion;
  return JSON.stringify({
    periodo: periodoTexto(r),
    total_oportunidades: r.totalOportunidades,
    embudo: r.embudo.map(b => ({ paso: b.label, oportunidades: b.n, monto: redondea(b.monto), pct_de_creadas: pct(b.pctDeCreadas) })),
    conversion: {
      ganadas: c.ganadas, perdidas: c.perdidas, canceladas: c.canceladas, abiertas: c.abiertas,
      tasa_cierre_pct: pct(c.tasaCierre),
      monto_ganado: redondea(c.montoGanado),
      monto_perdido_o_cancelado: redondea(c.montoPerdido),
      monto_abierto: redondea(c.montoAbierto),
    },
    ...(r.utilidadGanada !== undefined ? { utilidad_ganada: redondea(r.utilidadGanada) } : {}),
    tiempo_costeo_horas: {
      mediana: r.tiempoCosteo.medianaHoras === null ? null : Math.round(r.tiempoCosteo.medianaHoras),
      p90: r.tiempoCosteo.p90Horas === null ? null : Math.round(r.tiempoCosteo.p90Horas),
      medidas: r.tiempoCosteo.n,
    },
    ...(por ? { [`por_${por}`]: r.grupos.slice(0, 25).map(grupoCompacto) } : {}),
    datos_por_resolver: r.huecos.map(h => ({ problema: h.label, oportunidades: h.n })),
    notas: [
      NOTA_MONTOS,
      '"Cotizadas" = llegaron a cotización (tienen Fecha Cotización o su etapa ya pasó por ahí), sigan abiertas o ya cerradas.',
      ...(r.utilidadGanada === undefined ? [NOTA_SIN_UTILIDAD] : []),
    ],
    datos_al: r.syncedAt,
  });
}

const STAGE_EN_VALIDACION = '7';
const FECHA_SOLICITUD_COSTEO = 'date_mm094kzf';   // "Fecha solicitud costeo"
const DIA_MS = 86_400_000;

async function toolOportunidadesPorValidar(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<string> {
  const vendedorFilter = typeof input.vendedor === 'string' && input.vendedor.trim() ? input.vendedor : null;
  const rows = (await scopedOportunidades(env, viewer)).filter(row => {
    const cols = colEntries(row.columns);
    if (stageKeyOf(cols) !== STAGE_EN_VALIDACION) return false;
    return !vendedorFilter || like(cols.get(OPP.vendedor)?.text, vendedorFilter);
  });

  // Líneas de esas oportunidades en una sola pasada por tandas (tope de ~100
  // binds por consulta de D1). Los padres ya pasaron el scope del viewer.
  const porPadre = new Map<number, { lineas: number; sinPrecio: number; monto: number }>();
  const ids = rows.map(r => r.item_id);
  for (let i = 0; i < ids.length; i += 90) {
    const tanda = ids.slice(i, i + 90);
    const res = await env.DB.prepare(
      `SELECT parent_item_id, columns FROM items WHERE board_id = ? AND parent_item_id IN (${tanda.map(() => '?').join(',')})`,
    ).bind(BOARDS.oportunidades_sub.id, ...tanda).all<{ parent_item_id: number; columns: string }>();
    for (const l of res.results ?? []) {
      const cols = colEntries(l.columns);
      const num = (id: string) => Number((cols.get(id)?.text ?? '').replace(/,/g, '')) || 0;
      const precio = num(SUB.precioVenta);
      const slot = porPadre.get(l.parent_item_id) ?? { lineas: 0, sinPrecio: 0, monto: 0 };
      slot.lineas += 1;
      if (precio <= 0) slot.sinPrecio += 1;
      slot.monto += precio * num(SUB.cantidad);
      porPadre.set(l.parent_item_id, slot);
    }
  }

  const ahora = Date.now();
  const lista = rows.map(row => {
    const cols = colEntries(row.columns);
    const t = (id: string) => cols.get(id)?.text ?? null;
    const l = porPadre.get(row.item_id) ?? { lineas: 0, sinPrecio: 0, monto: 0 };
    // El texto de las columnas date a veces llega vacío en el mirror aunque el
    // `value` traiga la fecha — se lee de ahí como respaldo.
    let solicitud = t(FECHA_SOLICITUD_COSTEO) || null;
    if (!solicitud) {
      try {
        const v = JSON.parse(cols.get(FECHA_SOLICITUD_COSTEO)?.value ?? 'null') as { date?: string } | null;
        solicitud = v?.date ?? null;
      } catch { /* sin fecha */ }
    }
    const ts = solicitud ? Date.parse(solicitud) : NaN;
    return {
      item_id: row.item_id,
      folio: t(OPP.folio),
      nombre: row.name,
      vendedor: t(OPP.vendedor),
      institucion: t(OPP.institucion) ? dedupeMirror(t(OPP.institucion)!) : null,
      monto_venta: redondea(l.monto),
      lineas: l.lineas,
      estado: l.lineas === 0 ? 'sin líneas de producto'
        : l.sinPrecio === 0 ? 'lista para validar'
        : `falta Precio de Venta en ${l.sinPrecio} de ${l.lineas} líneas`,
      mandada_a_costeo: solicitud,
      dias_desde_costeo: Number.isFinite(ts) ? Math.floor((ahora - ts) / DIA_MS) : null,
    };
  }).sort((a, b) => (b.dias_desde_costeo ?? -1) - (a.dias_desde_costeo ?? -1));

  return JSON.stringify({
    total: lista.length,
    listas_para_validar: lista.filter(o => o.estado === 'lista para validar').length,
    oportunidades: lista.slice(0, 40),
    notas: [
      'Se validan en el portal: board Validación → abrir la oportunidad → "Validar costeo" (exige Precio de Venta en todas las líneas).',
      'monto_venta (MXN, sin IVA) = Σ Precio de Venta C/U × Cantidad; 0 = sin precios capturados.',
      ...(lista.length > 40 ? [`Mostrando 40 de ${lista.length}.`] : []),
    ],
  });
}

async function toolConsultaLibre(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<string> {
  const tabla = input.tabla === 'lineas' ? 'lineas' : 'oportunidades';
  const { filas, disponibles } = await filasConsultaLibre(env, viewer, tabla);
  // validarConsulta lanza ConsultaError (campo desconocido/tapado, operador o
  // métrica inválidos) — el dispatcher se lo regresa al modelo para corregirse.
  const { consulta, periodo } = aplicarPeriodoDefault(
    validarConsulta(input, disponibles), anioEnCurso(), input.toda_la_historia === true);
  return JSON.stringify({
    tabla,
    periodo,
    ...ejecutarConsulta(filas, consulta),
    notas: [
      'Montos en MXN sin IVA, de las líneas vigentes (sin versiones anteriores de la cotización).',
      ...(disponibles.has(tabla === 'lineas' ? 'utilidad_total' : 'utilidad') ? [] : ['La utilidad no está disponible para tu usuario.']),
    ],
  });
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/** Execute one tool call; always returns a string for the tool_result. */
// ── Cartera (respuesta directa) ───────────────────────────────────────────────

async function toolMiCartera(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<string> {
  const filtro = typeof input.solo === 'string' && ['se_mueve', 'atorada', 'apagada', 'normal'].includes(input.solo)
    ? input.solo as Categoria : undefined;
  const vista = await cargarVista(env, viewer);
  const { texto, itemIds } = renderCartera(vista, { filtro, nombre: viewer.nombre });
  if (itemIds.length) await guardarLista(env, viewer.email, itemIds, filtro ? `filtro:${filtro}` : 'cartera');
  return texto;
}

async function oportunidadDeCartera(env: Env, viewer: Identity, input: Record<string, unknown>) {
  const vista = await cargarVista(env, viewer);
  if (typeof input.item_id === 'number') return vista.oportunidades.find(o => o.item_id === input.item_id) ?? null;
  if (typeof input.folio === 'string' && input.folio.trim()) {
    const f = input.folio.trim().toLowerCase();
    return vista.oportunidades.find(o => (o.folio ?? '').toLowerCase() === f)
      ?? vista.oportunidades.find(o => (o.folio ?? '').toLowerCase().includes(f)) ?? null;
  }
  return null;
}

async function toolHistorialOportunidad(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<{ content: string; isError: boolean }> {
  const o = await oportunidadDeCartera(env, viewer, input);
  if (!o) return { content: 'No encontré esa oportunidad entre las abiertas de tu cartera. Indica item_id o folio (PRO-…), o usa listar_oportunidades si ya está cerrada.', isError: true };
  const actividad = await listActivity(env, [{ boardId: BOARDS.oportunidades.id, itemId: o.item_id }]);
  const eventos: EventoHistorial[] = actividad
    .filter(a => a.column_id === 'deal_stage' && a.new_text)
    .map(a => ({ at: a.created_at, texto: `pasó a ${a.new_text}${a.actor_email ? ` (${a.actor_email.split('@')[0]})` : ''}` }));
  try {
    const { results } = await env.DB.prepare('SELECT mensaje, created_at, autor_email FROM seguimientos WHERE item_id = ? ORDER BY created_at DESC LIMIT 10')
      .bind(o.item_id).all<{ mensaje: string; created_at: string; autor_email: string }>();
    for (const r of results ?? []) eventos.push({ at: r.created_at, texto: `seguimiento (${r.autor_email.split('@')[0]}): ${r.mensaje.slice(0, 140)}` });
  } catch { /* sin seguimientos todavía */ }
  return { content: renderHistorial(o, eventos), isError: false };
}

async function toolRegistrarSeguimiento(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<{ content: string; isError: boolean }> {
  const itemId = Number(input.item_id);
  const texto = typeof input.texto === 'string' ? input.texto.trim() : '';
  if (!Number.isFinite(itemId) || !texto) return { content: 'Necesito item_id y texto.', isError: true };
  const r = await registrarSeguimiento(env, viewer, itemId, texto);
  return { content: `Guardado en las Actualizaciones de *${r.etiqueta}* ✅\n"${texto}"`, isError: false };
}

async function toolCerrarOportunidad(env: Env, viewer: Identity, input: Record<string, unknown>): Promise<{ content: string; isError: boolean }> {
  const itemId = Number(input.item_id);
  const cierre = input.cierre === 'perdida' ? 'perdida' : input.cierre === 'cancelada' ? 'cancelada' : null;
  if (!Number.isFinite(itemId) || !cierre) return { content: 'Necesito item_id y cierre (cancelada | perdida).', isError: true };
  const r = await cerrarOportunidad(env, viewer, itemId, cierre as Cierre, typeof input.motivo === 'string' ? input.motivo : '');
  return { content: `Listo: *${r.etiqueta}* quedó como *${r.etapa}* en Monday ✅`, isError: false };
}

export async function runTool(
  env: Env,
  viewer: Identity,
  name: string,
  input: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  // Defense in depth: even if the model hallucinates a tool it wasn't offered,
  // the role gate here refuses to run it.
  if (!puedeUsarTool(name, viewer)) {
    return { content: `La herramienta "${name}" no está disponible para tu usuario.`, isError: true };
  }
  try {
    switch (name) {
      case 'buscar_productos': {
        const rows = await searchMirror(env, BOARDS.productos.id, String(input.q ?? ''), [PRODUCTO_COLS.sku]);
        return { content: fmtResults(rows, PRODUCTO_COLS), isError: false };
      }
      case 'buscar_contactos': {
        // Vía dal.listItems (no searchMirror) para respetar el scoping por Vendedor
        // del board Contactos — el vendedor solo busca entre SUS contactos.
        const rows = await listItems(env, 'contactos', viewer, String(input.q ?? ''));
        return { content: fmtResults(rows.slice(0, 8), CONTACTO_COLS), isError: false };
      }
      case 'buscar_instituciones': {
        const rows = await searchMirror(env, BOARDS.instituciones.id, String(input.q ?? ''));
        return { content: fmtResults(rows, INSTITUCION_COLS), isError: false };
      }
      case 'crear_contacto': {
        const cols: Record<string, string> = {};
        if (typeof input.email === 'string' && input.email.trim()) cols[CONTACTO_COLS.email] = input.email.trim();
        if (typeof input.telefono === 'string' && input.telefono.trim()) cols[CONTACTO_COLS.telefono] = input.telefono.trim();
        if (typeof input.cargo === 'string' && input.cargo.trim()) cols[CONTACTO_COLS.cargo] = input.cargo.trim();
        const result = await submitCreate(env, 'contactos', String(input.nombre ?? ''), cols, viewer);
        return { content: JSON.stringify({ ok: true, item_id: result.id, nota: 'Contacto creado. La institución se liga manualmente en Monday (limitación conocida).' }), isError: false };
      }
      case 'crear_oportunidad': {
        const rawLineas = Array.isArray(input.lineas) ? input.lineas as Array<Record<string, unknown>> : [];
        const zonaSet: Set<string> = new Set(EMBELL_TEMPLATE_KEYS);
        const lineas: LineaInput[] = rawLineas.map(l => {
          const rawZonas = Array.isArray(l.embellecimiento_zonas) ? l.embellecimiento_zonas as Array<Record<string, unknown>> : [];
          const embellecimientoZonas: Record<string, string> = {};
          for (const z of rawZonas) {
            const zona = typeof z.zona === 'string' ? z.zona : '';
            const descripcion = typeof z.descripcion === 'string' ? z.descripcion.trim() : '';
            if (zonaSet.has(zona) && descripcion) embellecimientoZonas[zona] = descripcion;
          }
          return {
            nombre: String(l.nombre ?? ''),
            productoItemId: typeof l.producto_item_id === 'number' ? l.producto_item_id : undefined,
            cantidad: Number(l.cantidad),
            color: typeof l.color === 'string' ? l.color : undefined,
            comentarios: typeof l.comentarios === 'string' ? l.comentarios : undefined,
            embellecimientoZonas: Object.keys(embellecimientoZonas).length ? embellecimientoZonas : undefined,
          };
        });
        const result = await createOportunidad(env, {
          nombre: String(input.nombre ?? ''),
          contactoItemId: typeof input.contacto_item_id === 'number' ? input.contacto_item_id : undefined,
          fechaLimite: typeof input.fecha_limite === 'string' ? input.fecha_limite : undefined,
          zona: typeof input.zona === 'string' ? input.zona : undefined,
          lineas,
        }, viewer);
        return { content: JSON.stringify(result), isError: false };
      }
      case 'consultar_pipeline':
        return { content: await toolConsultarPipeline(env, viewer, input), isError: false };
      case 'listar_oportunidades':
        return { content: await toolListarOportunidades(env, viewer, input), isError: false };
      case 'detalle_oportunidad':
        return toolDetalleOportunidad(env, viewer, input);
      case 'listar_proyectos':
        return { content: await toolListarProyectos(env, viewer, input), isError: false };
      case 'detalle_proyecto':
        return toolDetalleProyecto(env, viewer, input);
      case 'consultar_inventario':
        return { content: await toolConsultarInventario(env, input), isError: false };
      case 'movimientos_inventario':
        return { content: await toolMovimientosInventario(env, input), isError: false };
      case 'listar_almacenes':
        return { content: await toolListarAlmacenes(env, input), isError: false };
      case 'crear_movimiento':
        return { content: await toolCrearMovimiento(env, viewer, input), isError: false };
      case 'ranking_vendedores':
        return { content: await toolRankingVendedores(env, viewer, input), isError: false };
      case 'resumen_ventas':
        return { content: await toolResumenVentas(env, viewer, input), isError: false };
      case 'oportunidades_por_validar':
        return { content: await toolOportunidadesPorValidar(env, viewer, input), isError: false };
      case 'consulta_libre':
        return { content: await toolConsultaLibre(env, viewer, input), isError: false };
      case 'mi_cartera':
        return { content: await toolMiCartera(env, viewer, input), isError: false };
      case 'historial_oportunidad':
        return toolHistorialOportunidad(env, viewer, input);
      case 'registrar_seguimiento':
        return toolRegistrarSeguimiento(env, viewer, input);
      case 'cerrar_oportunidad':
        return toolCerrarOportunidad(env, viewer, input);
      default:
        return { content: `Herramienta desconocida: ${name}`, isError: true };
    }
  } catch (err) {
    if (err instanceof CreateError || err instanceof OportunidadError || err instanceof InventoryError || err instanceof CarteraError) {
      return { content: `Error (${err.status}): ${err.message}`, isError: true };
    }
    if (err instanceof ToolInputError || err instanceof ConsultaError) return { content: err.message, isError: true };
    const detail = err instanceof Error ? err.message : String(err);
    return { content: `Error interno: ${detail}`, isError: true };
  }
}
