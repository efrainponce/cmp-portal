// Generic role-scoped DTOs. The serializer (worker/lib/serialize.ts) is the ONLY
// producer; it emits exactly the whitelisted columns for the viewer's role.
import type { Role } from './types';
import type { BoardSlug } from './boards';

export interface ColVal {
  text: string;                 // Monday's display text ('' if empty)
  value?: unknown;              // parsed value when useful (numbers, status index, files)
  type: string;                 // monday column type
}

export interface ItemDTO {
  id: string;
  name: string;
  parentId?: string;
  group?: string;
  syncedAt: string;             // ISO — drives "sincronizado hace X min"
  mondayUpdatedAt: string | null; // ISO, Monday's own item.updated_at — drives "actualizado hace X min"
  pendingWrite?: boolean;       // outbox row not yet confirmed by Monday echo
  cols: Record<string, ColVal>; // keyed by monday column id, whitelist-filtered
}

export interface ItemDetailDTO extends ItemDTO {
  children?: ItemDTO[];         // subitems, same whitelist rules
  /** false = el viewer la ve solo porque lidera la zona de su dueño
   * (worker/lib/zonas.ts): el drawer se abre en solo lectura y el server
   * responde 404 a cualquier escritura. Ausente = true (dueño). */
  ownedByViewer?: boolean;
}

/** Totales de la cotización de UNA oportunidad, sumados de sus líneas vigentes
 * (worker/lib/totales.ts). Cada cifra viaja solo si el rol puede leer esa
 * columna en las líneas (shared/visibility.ts): un vendedor recibe Subtotal y
 * Total, nunca costo/utilidad/margen. `lineas` siempre va — es un conteo, no
 * dinero. */
export interface TotalesDTO {
  lineas: number;
  costo?: number;
  subtotal?: number;
  total?: number;
  utilidad?: number;
  /** Ponderada: utilidad / subtotal. Ausente si no hay subtotal capturado. */
  utilidadPct?: number;
  margenGob?: number;
}

export interface ListResponse {
  board: BoardSlug;
  items: ItemDTO[];
  total: number;
  etag: string;                 // aggregate hash — If-None-Match => 304
  /** itemId -> totales de su cotización. Solo cuando se pide `?totales=1`
   * (la lista de Oportunidades); ausente en el resto de los boards. */
  totales?: Record<string, TotalesDTO>;
}

export interface MeDTO {
  email: string; nombre: string; role: Role; mondayUserId: number;
  // null = todavía no lo captura (worker/routes/boards.ts gatea el portal con esto
  // hasta que lo llena — ver src/app/PhoneGateScreen.tsx). Es el mismo campo que usa
  // el bot de WhatsApp para identificar al remitente (worker/wa/store.ts).
  phone: string | null;
  // Presente cuando un admin está viendo el portal como este usuario — nombre/email
  // del admin real, para el banner "Salir de impersonación".
  impersonatedBy?: { email: string; nombre: string } | null;
  // BoardKeys del sidebar visibles para el rol del viewer (shared/boardAccess.ts) —
  // solo declutter de nav, no es la protección real de datos.
  boardAccess: string[];
  // ¿Este viewer ve el tab "Zona Efrain" en el sidebar? Por-USUARIO, no por rol
  // (a diferencia de boardAccess) — los tres son role='admin' pero solo dos
  // están en la whitelist (worker/lib/zonas.ts isZonaPrivadaAdminPermitido).
  // Igual que boardAccess, solo declutter: la protección real de los datos ya
  // la hace dal.ts hidden_owner_ids sin importar este flag.
  zonaEfrainAccess: boolean;
}

export interface WriteRequest { cols: Record<string, string> }  // colId -> new raw value
export interface WriteResponse { ok: boolean; pending: boolean; error?: string }

// native: "salir de Monday" (Zona Efrain) — solo lo honra el server para
// slug 'oportunidades' y viewers de la whitelist de zona privada; cualquier
// otro caso lo ignora y crea normal (worker/routes/boards.ts).
export interface CreateRequest { name: string; cols: Record<string, string>; native?: boolean }
export interface CreateResponse { ok: boolean; id?: string; error?: string }

// POST /api/oportunidades/:id/duplicar — clona cabecera + líneas vigentes +
// embellecimiento a una oportunidad nueva; no arrastra versiones de
// cotización, PDFs ni otros documentos. `etapa` (Efraín, 2026-08-14: "duplicar
// pregunta a que estado se manda") es la clave de shared/dealStages.ts
// DEAL_STAGE_LABELS a la que nace el duplicado — default '4' (Nueva
// oportunidad) si se omite. Fuera de '4' es solo la ETIQUETA de la etapa: no
// replica el proceso que esa etapa implica (Proyecto de "Ganada", PDFs de
// costeo/validación, etc.) — mismo criterio que el backfill manual de
// OPP-0899.
export interface DuplicarOportunidadRequest { etapa?: string }
export interface DuplicarOportunidadResponse { ok: boolean; id?: string; error?: string }

// Institución elegida DESDE la oportunidad: se guarda en el Contacto ligado
// (`contact_account`) porque la columna de la oportunidad es un espejo suyo
// — ver POST /api/oportunidades/:id/institucion. `institucion` regresa el
// nombre ya resuelto para pintarlo sin esperar al espejo de Monday.
export interface SetInstitucionRequest { institucionId: string }
export interface SetInstitucionResponse { ok: boolean; institucion?: string; error?: string }

// `email` distingue dos entradas que comparten `id` (mismo monday_user_id) pero
// son personas distintas — "Actuar en Monday como" (worker/lib/dal.ts
// createNativeIdentity) deja a alguien sin asiento propio escribiendo bajo la
// cuenta de otra persona; los pickers de Vendedor lo usan como key/value único
// para no perder cuál de las dos se seleccionó (Efraín, 2026-08-12).
export interface VendedorDTO { id: number; nombre: string; email: string }

// GET /api/oportunidades/:id/costeo-check (solo lectura, deshabilita el botón) y
// POST /api/oportunidades/:id/enviar-costeo (dispara validar_costeo de cmp-tallas) —
// 422 con errores legibles cuando algo falta. `folio` = PDF de costeo generado.
export interface EnviarCosteoResponse { ok: boolean; errors?: string[]; folio?: string }

// GET /api/oportunidades/:id/proyecto — el Proyecto ligado (tallas/OC viven ahí);
// null cuando la oportunidad aún no tiene Proyecto.
export interface ProyectoResponse { proyecto: ItemDetailDTO | null }

// Versiones de cotización (worker/lib/quoteVersions.ts). La vigente se arma en
// caliente desde el mirror; las anteriores vienen archivadas en D1. `products` es
// de solo lectura (snapshot); la edición vive en QuoteVersionRequest.
export interface QuoteLineSnapshot {
  subitemId?: number;
  /** Item del catálogo Productos ligado al momento del snapshot — lo usa
   * restoreVersion para re-linkear sin adivinar por nombre. Instantáneas
   * archivadas antes de 2026-07-17 no lo traen (fallback: match por nombre). */
  productoItemId?: number;
  producto: string;
  sku?: string;
  color: string;
  cantidad: number;
  embellecimiento: boolean;
  descripcionEmbellecimiento?: string;
  precioUnitario?: number;
  pendienteCosteo?: boolean;
  /** Etapa Costeo (color_mm084gvf) al momento del snapshot — "No iniciado" o
   * vacío si Compras todavía no la toca; usado por submitVersion para saber
   * si debe resetearla al editar la línea. */
  etapaCosteo?: string;
  /** Marca visual de "Ajustar línea" (lineaAjustes.ts / proyectoCotizacionVirtual.ts,
   * Efraín 2026-08-11): solo la arma el server al reproducir ajustes de la
   * cotización virtual del Proyecto — 'Dividida' tiene prioridad sobre 'Editada'. */
  ajusteLabel?: 'Dividida' | 'Editada';
}

// "Ajustar línea" (worker/lib/lineaAjustes.ts, Efraín 2026-07-31): retoques a
// una línea (producto/color/embellecimiento/cantidad) que no cambian el precio
// y no pasan por costeo — no son una versión real, solo trazabilidad rotulada
// V{version}.{subversion} sobre la vigente en VersionChips.
export interface AjusteDTO {
  subversion: number;
  resumen: string;
  viewerEmail: string;
  createdAt: string;
  /** Línea afectada (la editada, o la nueva línea hermana en 'dividir'). Usado
   * por el front para pintar el label "Dividida"/"Editada" al final de la fila. */
  lineaId: number;
  /** Solo en 'dividir': línea de la que se partió — esa línea origen también
   * se pinta como "Dividida" aunque no tenga su propio registro de ajuste. */
  lineaOrigenId?: number;
}

export interface QuoteVersionDTO {
  id: number;
  label: string;
  createdAt: string;
  status: 'vigente' | 'anterior';
  folio?: string;
  total: number;
  products: QuoteLineSnapshot[];
  /** Solo en la vigente: ajustes registrados sobre la versión mayor actual. */
  ajustes?: AjusteDTO[];
}

export interface QuoteVersionsResponse { versions: QuoteVersionDTO[] }

// POST /api/oportunidades/lineas/:id/ajustar — ver worker/lib/lineaAjustes.ts.
// `productoNombre` es solo para el resumen legible del historial (el mirror
// real lo puebla Monday de forma asíncrona). `cantidad` en modo 'dividir' es
// cuánto se mueve a la línea nueva, no el total de la línea origen.
//
// 'eliminar' es distinto de editar/dividir: SÍ reinicia el ciclo de costeo
// (crea una versión nueva primero, como "+ Nueva versión") y por eso lo
// maneja worker/routes/oportunidades.ts junto con quoteVersions.ts, no
// lineaAjustes.ts — bloqueado en Ganada/Perdida igual que "+ Nueva versión".
export interface AjustarLineaRequest {
  modo: 'editar' | 'dividir' | 'eliminar';
  cantidad?: number;
  productoId?: number;
  productoNombre?: string;
  color?: string;
  embellecimiento?: { estado?: 'con' | 'sin'; descripcion?: string };
}

// Costo Distribuidor del catálogo (Productos) divergió entre el SKU anterior y
// el nuevo al ajustar una línea (worker/lib/costoDivergencia.ts, Efraín
// 2026-08-10) — no bloquea el ajuste, solo avisa (mención a Compras en Monday +
// notificación del portal). Se adjunta a la respuesta de "Ajustar línea", tanto
// en Oportunidades (real) como en la cotización virtual del Proyecto.
export interface CostoDivergenciaDTO {
  productoAnterior: string;
  productoNuevo: string;
  costoAnterior: number;
  costoNuevo: number;
  pctDiff: number;
}

export interface AjustarLineaResponse {
  ok: boolean;
  error?: string;
  lineaId?: number;
  nuevaLineaId?: number;
  costoDivergente?: CostoDivergenciaDTO;
  /** Solo modo 'eliminar': versiones actualizadas (la vigente quedó archivada
   * como una nueva versión) — mismo shape que DuplicarVersionResponse. */
  versions?: QuoteVersionDTO[];
}

// GET /api/proyectos/:id/cotizacion-virtual (worker/lib/proyectoCotizacionVirtual.ts,
// Efraín 2026-08-10; escritura real desde 2026-08-13) — mismas líneas vigentes
// de la Oportunidad ligada; "Editar/Dividir" desde aquí SÍ escribe a Monday
// (reusa el motor de "Ajustar línea" de Oportunidades), pero autoriza contra
// el dueño del Proyecto, no de la Oportunidad. `ajustes` viene del mismo log
// que alimenta los pills V{n}.{m} en VersionChips (Oportunidades) — no hay
// versión mayor propia aquí; "+ Nueva versión" no existe desde el Proyecto.
export interface CotizacionVirtualDTO {
  lines: QuoteLineSnapshot[];
  ajustes: AjusteDTO[];
}

// POST /api/oportunidades/:id/version/duplicar — "+ Nueva versión" es un duplicado
// literal de la vigente (Efraín, 2026-07-17): la archiva en D1 y deja el mirror
// (idéntico) como borrador editable inline. NO manda nada a costeo — eso lo hace
// el vendedor después, explícito, con el botón "Mandar a costeo" del drawer.
export interface DuplicarVersionResponse {
  ok: boolean; error?: string; versions?: QuoteVersionDTO[];
}

// POST /api/proyectos/:id/(tallas-regenerar|tallas-confirmar|tallas-importar|generar-oc)
// — contrato cmp-tallas: siempre {ok, skipped?, reason?, ...extras}.
export interface ProyectoActionResponse {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  [key: string]: unknown;
}

// POST /api/proyectos/:id/tallas-capturar — captura de tallas por boxes
// (vendedor), worker/lib/proyectoTallas.ts. Crea subitems del Proyecto directo
// (mismo camino que /lineas), sin pasar por cmp-tallas; el Sheet + "Importar
// tallas" siguen intactos como flujo paralelo.
export interface TallaBoxInput {
  subitemId: number;
  producto: string;
  sku?: string;
  color?: string;
  talla: string;
  cantidad: number;
}

export interface CapturarTallasResponse {
  ok: true;
  created: number;
  /** Fase 3 (plan "salir de Monday", 2026-08-12): reconciliación real por
   * identidad (producto+sku+color+talla) — una fila que ya existía pero con
   * cantidad/costeo distinto se actualiza en vez de omitirse. */
  updated: number;
  omitted: number;
}

// GET /api/proyectos/:id/estado-historial — timeline de "Estado del producto" por
// línea (tab Ejecución), worker/lib/estadoProducto.ts. changedBy null = cambio hecho
// directo en Monday (webhook/reconcile), sin autor conocido del lado del portal.
export interface EstadoHistorialEntryDTO {
  subItemId: string;
  estadoPrevio: string | null;
  estadoNuevo: string;
  changedAt: string;
  changedBy: string | null;
  comentario: string | null;
}
export interface EstadoHistorialResponse {
  historial: EstadoHistorialEntryDTO[];
}

// GET/PATCH /api/proyectos/:id/resumen-producto — resumen libre por producto+color
// (tab Ejecución), worker/lib/productoResumen.ts. Nativo en D1: el grupo producto+color
// no es una entidad de Monday, es una agrupación del cliente sobre subitems de talla.
export interface ProductoResumenDTO {
  producto: string;
  color: string;
  resumen: string;
  updatedAt: string;
  updatedBy: string | null;
}
export interface ProductoResumenResponse {
  resumen: ProductoResumenDTO[];
}

// GET/PATCH /api/productos/genero — checkbox "Género M/F" por producto de
// catálogo, worker/lib/productoGenero.ts. Nativo en D1 (Efraín, 2026-08-13:
// "dejemoslo solo en D1, no vale la pena" una columna de Monday): solo decide
// si Tallas se expande con prefijo M-/F- al escribirse en Airtable
// (worker/lib/airtable.ts syncTallasPortal) — nunca se ve en Monday.
export interface ProductoGeneroResponse {
  /** producto_id (string) → true solo para los marcados; los no marcados no aparecen. */
  generos: Record<string, boolean>;
}

// Monday item updates (comments) — read/posted live, never mirrored to D1.
// attachments carry no url: it's a presigned S3 link that expires in ~1h, so
// the frontend resolves a fresh one on demand via the attachment proxy route
// (GET .../updates/attachments/:assetId), keyed by id.
export interface UpdateAttachmentDTO { id: string; name: string; ext: string }
export interface UpdateDTO { id: string; body: string; author: string; createdAt: string; attachments: UpdateAttachmentDTO[]; seenBy: string[] }
export interface CreateUpdateRequest { body: string; mentions?: { id: number; nombre: string }[] }

// GET /api/boards/:slug/items/:id/activity — log de cambios de columna (mirror
// D1 de activity_logs de Monday, worker/lib/activityLog.ts). Solo columnas en
// la whitelist propia de ese módulo (no shared/visibility.ts: son propósitos
// distintos — permisos vs. ruido). Para `oportunidades` incluye también las
// líneas (oportunidades_sub) de esa oportunidad.
export interface ActivityEntryDTO {
  itemId: string;
  event: string;              // 'create_pulse' | 'update_name' | 'update_column_value'
  columnTitle: string | null;
  previousText: string | null;
  text: string | null;
  actorName: string | null;
  at: string;                 // ISO
}
export interface ActivityResponse { entries: ActivityEntryDTO[] }

// GET /api/users — full Monday account roster (any authenticated viewer), used
// to power @-tagging in Actualizaciones. Distinct from /api/vendedores, which
// is the smaller D1 identity roster scoped to portal roles.
export interface MentionUserDTO { id: number; nombre: string }

// Admin settings: identity rows the admin manages (who can log in, phone, role).
export interface IdentityDTO {
  email: string;
  phone: string | null;
  nombre: string | null;
  mondayUserId: number;
  role: Role;
  active: boolean;
}
// Monday directory entry offered for import in Settings.
export interface MondayUserDTO { id: number; nombre: string; email: string; phone: string | null; teams: string[] }

// Accesos por equipo a boards del sidebar (shared/boardAccess.ts) — matriz que edita
// el admin en Settings. Las llaves son Role; 'admin' siempre trae todos los boardKeys
// y no es editable (ver worker/lib/boardAccess.ts).
export type BoardAccessDTO = Record<Role, string[]>;

// Zonas de ventas (worker/lib/zonas.ts): el líder ve, además de lo suyo, las
// oportunidades de sus miembros — solo lectura. Se administra en Configuración.
export interface ZonaDTO {
  id: number;
  nombre: string;
  liderEmail: string | null;
  miembros: string[];           // emails de identity
}

// Column metadata the UI needs to render board-like tables (titles, types,
// status label colors from Monday settings). Generated — see shared/column-meta.ts.
export interface ColMeta {
  id: string; title: string; type: string;
  w?: boolean;                  // viewer's role may write this column
  labels?: Record<string, { label: string; color?: string }>;  // status/dropdown
}

// Portal chat bubble — same Claude agent + tools as the WhatsApp bot (worker/wa/),
// a second channel keyed by the viewer's email instead of a phone number.
export interface AssistantMessage { role: 'user' | 'assistant'; text: string }
export interface AssistantHistoryResponse { messages: AssistantMessage[] }
export interface AssistantChatRequest { text: string }
export interface AssistantChatResponse { reply: string }

// Centro de notificaciones (worker/routes/notifications.ts). Cada fila es personal —
// scoped a viewer.email. Dos bandejas por `severity`. `boardKey`/`itemId` arman el deep
// link /{boardKey}/{itemId} (src/lib/routing.ts) que abre el drawer de la oportunidad.
export interface NotificationDTO {
  id: number;
  severity: 'importante' | 'actualizacion';
  kind: string;                 // 'mention' | 'costeo_incompleto' | 'stage_change'
  title: string;
  body: string | null;
  boardKey: string | null;
  itemId: string | null;
  actor: string | null;
  read: boolean;
  createdAt: string;            // ISO
}
export interface NotificationsResponse {
  notifications: NotificationDTO[];
  unread: { importante: number; actualizacion: number };
}

// Home ("Inicio") — GET /api/home, worker/lib/home.ts. Pendientes por rol,
// pensado para tarjetas (no una tabla): boardKey es a dónde navega el click.
export interface HomePendienteDTO {
  itemId: string;
  boardKey: string;
  title: string;
  subtitle: string;
  daysStale: number;
}
export interface HomeSectionDTO {
  key: string;
  label: string;
  items: HomePendienteDTO[];
}
export interface HomeResponse {
  greetingName: string;
  sections: HomeSectionDTO[];
}

// Anuncios del portal (worker/lib/anuncios.ts) — comunicados que publican los admins
// y lee el equipo en /anuncios. Nativo en D1, sin board de Monday detrás. `roles` y
// `zonaIds` son la audiencia: lista VACÍA = "para todos" en esa dimensión, y las dos
// se cumplen a la vez (rol Y zona). `visto` es del viewer que pidió la lista.
export type AnuncioSeveridad = 'normal' | 'importante';
export interface AnuncioDTO {
  id: string;
  titulo: string;
  cuerpo: string;
  severidad: AnuncioSeveridad;
  roles: Role[];
  zonaIds: number[];
  autorEmail: string;
  autorNombre: string;
  archivado: boolean;
  waEnviados: number;           // cuántos WhatsApp salieron al publicarlo (0 = ninguno)
  visto: boolean;
  createdAt: string;            // ISO
  updatedAt: string;            // ISO
}
export interface AnunciosResponse {
  anuncios: AnuncioDTO[];
  noLeidos: number;             // badge del sidebar: vigentes, dirigidos al viewer, sin abrir
}
export interface CrearAnuncioRequest {
  titulo: string;
  cuerpo: string;
  severidad?: AnuncioSeveridad;
  roles?: Role[];
  zonaIds?: number[];
  notificarWa?: boolean;        // casilla explícita del admin — nunca implícito por severidad
}
export interface CrearAnuncioResponse { anuncio: AnuncioDTO }
