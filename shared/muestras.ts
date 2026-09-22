// shared/muestras.ts — Solicitudes de MUESTRAS (Efraín, 2026-09-21: "un nuevo
// tab que se llama Muestras en Cotización y Proyectos… tiene que estar ligado
// a algo, así como las órdenes de compra"). Reemplaza el Excel "SOLICITUD DE
// MUESTRAS" que el vendedor llenaba a mano: encabezado (quién pide, para qué
// oportunidad/proyecto, cuándo se entregan y en cuántos días regresan) +
// renglones de producto, cantidad, color, TALLA y comentarios.
//
// 100 % nativo en D1 (worker/lib/muestras.ts): Monday no tiene board de
// muestras y no se le crea uno. Aquí vive el contrato front↔worker y la
// aritmética pura (fechas de retorno, validación de renglones).

export type MuestraPadre = 'oportunidades' | 'proyectos';

// Flujo (Efraín, 2026-09-22: "simple: enviada, validada, muestra entregada").
// Nace en BORRADOR en el tab donde se crea; el vendedor la ENVÍA con un botón
// (actualización en el item + aviso importante a Compras, con WhatsApp) y de
// ahí Compras la gestiona desde el board "Solicitudes de muestra".
export const MUESTRA_ESTADOS = ['borrador', 'enviada', 'validada', 'entregada'] as const;
export type MuestraEstado = typeof MUESTRA_ESTADOS[number];

/** Los que se mueven desde el board, ya enviada la solicitud. */
export const MUESTRA_ESTADOS_GESTION = ['enviada', 'validada', 'entregada'] as const satisfies readonly MuestraEstado[];

export const MUESTRA_ESTADO_LABEL: Record<MuestraEstado, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  validada: 'Validada',
  entregada: 'Muestra entregada',
};

export function esMuestraEstado(v: unknown): v is MuestraEstado {
  return typeof v === 'string' && (MUESTRA_ESTADOS as readonly string[]).includes(v);
}

export function esEstadoGestion(v: unknown): v is typeof MUESTRA_ESTADOS_GESTION[number] {
  return typeof v === 'string' && (MUESTRA_ESTADOS_GESTION as readonly string[]).includes(v);
}

/** Quién mueve el estado desde el board: Compras (y admin). El vendedor solo
 * crea, edita mientras es borrador y envía. */
export function puedeGestionarMuestras(role: string): boolean {
  return role === 'compras' || role === 'admin';
}

export interface MuestraLineaInput {
  producto: string;
  /** Item id del producto en el catálogo (board Productos); null = texto libre. */
  productoId?: string | null;
  sku?: string | null;
  marca?: string | null;
  color?: string | null;
  talla?: string | null;
  cantidad: number;
  comentarios?: string | null;
}

/** Como la guarda D1: los textos vacíos llegan como '' (nunca null). */
export interface MuestraLineaDTO {
  id: string;
  producto: string;
  productoId: string | null;
  sku: string;
  marca: string;
  color: string;
  talla: string;
  cantidad: number;
  comentarios: string;
}

export interface MuestraSolicitudInput {
  /** 'AAAA-MM-DD' — cuándo tienen que estar las muestras con el cliente. */
  fechaEntrega?: string | null;
  /** Días que el cliente se queda las muestras antes de regresarlas. */
  diasRetorno?: number | null;
  notas?: string | null;
  lineas: MuestraLineaInput[];
}

export interface CrearMuestraRequest extends MuestraSolicitudInput {
  padre: MuestraPadre;
  itemId: string;
}

export interface MuestraSolicitudDTO {
  id: string;
  /** "MUE-12" — folio del GRUPO (todas sus versiones lo comparten). */
  folio: string;
  /** Versiones como en la cotización (Efraín, 2026-09-22): "+ Nueva versión"
   * duplica una ya enviada como V{n+1} en borrador; la anterior queda
   * archivada. `grupoId` = id de la V1. */
  grupoId: string;
  version: number;
  /** Es la versión más nueva de su grupo. */
  ultima: boolean;
  /** Cuántas versiones tiene el grupo en total. */
  versiones: number;
  padre: MuestraPadre;
  itemId: string;
  /** Nombre, folio, institución y vendedor del item ligado (del espejo). */
  itemNombre: string;
  itemFolio: string | null;
  institucion: string | null;
  vendedor: string | null;
  estado: MuestraEstado;
  fechaEntrega: string | null;
  diasRetorno: number | null;
  /** fechaEntrega + diasRetorno, ya calculada. */
  fechaRetorno: string | null;
  notas: string | null;
  solicitante: string;
  solicitanteEmail: string;
  createdAt: string;
  updatedAt: string;
  /** Cuándo y quién la mandó a Compras (null = sigue en borrador). */
  enviadaAt: string | null;
  enviadaPor: string | null;
  lineas: MuestraLineaDTO[];
  /** Puede editar/borrar/enviar: sigue en borrador (escribe todo el que ve el
   * item, Compras incluido — Efraín, 2026-09-22). */
  editable: boolean;
  /** Puede mover el estado desde el board (Compras/admin; solo la versión
   * enviada más nueva del grupo). */
  gestionable: boolean;
  /** Puede sacar "+ Nueva versión": ya se envió y es la última. */
  puedeNuevaVersion: boolean;
}

export const muestraFolio = (grupoId: number | string) => `MUE-${grupoId}`;

/** "MUE-3" o "MUE-3 V2" — la V1 de un grupo sin más versiones va sin sufijo. */
export function muestraEtiqueta(s: Pick<MuestraSolicitudDTO, 'folio' | 'version' | 'versiones'>): string {
  return s.versiones > 1 || s.version > 1 ? `${s.folio} V${s.version}` : s.folio;
}

/** De cada grupo, la versión que le toca ver en el BOARD a quien consulta: la
 * más nueva, salvo un borrador ajeno — ese solo lo ve en el board quien lo
 * armó; los demás siguen viendo la enviada anterior (en el tab del item sí se
 * ven todas). Pura. */
export function versionVisiblePorGrupo<T extends { grupoId: string; version: number; estado: MuestraEstado; solicitanteEmail: string }>(filas: T[], viewerEmail: string): T[] {
  const porGrupo = new Map<string, T>();
  const yo = viewerEmail.trim().toLowerCase();
  for (const f of filas) {
    if (f.estado === 'borrador' && f.solicitanteEmail.trim().toLowerCase() !== yo) continue;
    const actual = porGrupo.get(f.grupoId);
    if (!actual || f.version > actual.version) porGrupo.set(f.grupoId, f);
  }
  return [...porGrupo.values()];
}

/** Topes: una solicitud es un puñado de piezas, no una cotización. */
export const MUESTRA_MAX_LINEAS = 60;
export const MUESTRA_TEXTO_MAX = 500;

/** 'AAAA-MM-DD' + n días, a mano (sin Date local: en México una fecha sin hora
 * pasada por Date se recorre un día). */
export function sumarDias(iso: string, dias: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || !Number.isFinite(dias)) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + Math.round(dias) * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function fechaRetorno(fechaEntrega: string | null, diasRetorno: number | null): string | null {
  if (!fechaEntrega || diasRetorno == null) return null;
  return sumarDias(fechaEntrega, diasRetorno);
}

/** Ya entregadas y con la fecha de retorno vencida — lo que hay que ir a
 * recoger. `hoy` en 'AAAA-MM-DD'. */
export function retornoVencido(s: Pick<MuestraSolicitudDTO, 'estado' | 'fechaRetorno'>, hoy: string): boolean {
  return s.estado === 'entregada' && !!s.fechaRetorno && s.fechaRetorno < hoy;
}

const limpio = (v: unknown, max = MUESTRA_TEXTO_MAX): string | null => {
  if (v == null) return null;
  const s = String(v).trim().slice(0, max);
  return s === '' ? null : s;
};

export type Validado<T> = { ok: true; valor: T } | { ok: false; error: string };

/** Normaliza y valida lo que manda el front. Pura (la usan worker y tests). */
export function validarSolicitud(input: unknown): Validado<Required<Omit<MuestraSolicitudInput, 'lineas'>> & { lineas: MuestraLineaDTO[] }> {
  const b = (input ?? {}) as Record<string, unknown>;
  const fechaEntrega = limpio(b.fechaEntrega, 10);
  if (fechaEntrega && !/^\d{4}-\d{2}-\d{2}$/.test(fechaEntrega)) return { ok: false, error: 'fecha de entrega inválida (AAAA-MM-DD)' };
  let diasRetorno: number | null = null;
  if (b.diasRetorno != null && b.diasRetorno !== '') {
    const n = Number(b.diasRetorno);
    if (!Number.isInteger(n) || n < 0 || n > 365) return { ok: false, error: 'tiempo de retorno inválido (días, 0 a 365)' };
    diasRetorno = n;
  }
  if (!Array.isArray(b.lineas) || b.lineas.length === 0) return { ok: false, error: 'agrega al menos un producto' };
  if (b.lineas.length > MUESTRA_MAX_LINEAS) return { ok: false, error: `máximo ${MUESTRA_MAX_LINEAS} renglones por solicitud` };
  const lineas: MuestraLineaDTO[] = [];
  for (const [i, raw] of b.lineas.entries()) {
    const l = (raw ?? {}) as Record<string, unknown>;
    const producto = limpio(l.producto, 200);
    if (!producto) return { ok: false, error: `renglón ${i + 1}: falta el producto` };
    const cantidad = Number(l.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 10_000) return { ok: false, error: `renglón ${i + 1}: cantidad inválida` };
    const productoId = limpio(l.productoId, 20);
    if (productoId && !/^\d+$/.test(productoId)) return { ok: false, error: `renglón ${i + 1}: producto de catálogo inválido` };
    lineas.push({
      id: '', producto, productoId, cantidad,
      sku: limpio(l.sku, 80) ?? '', marca: limpio(l.marca, 80) ?? '',
      color: limpio(l.color, 80) ?? '', talla: limpio(l.talla, 40) ?? '',
      comentarios: limpio(l.comentarios) ?? '',
    });
  }
  return { ok: true, valor: { fechaEntrega, diasRetorno, notas: limpio(b.notas, 2000), lineas } };
}
