// shared/native.ts — Contrato del modelo NATIVO (plan 3, "salir de Monday").
//
// Único productor de la forma nativa: mapea cada columna de Monday a un campo
// semántico propio (nombre en español, tipo nativo) para que el día del corte la
// data no dependa de ids de columna opacos de Monday. Es DORMIDO: nada de esto se
// usa en producción hasta que NATIVE_SHADOW=1 (ver docs/plan-3-native-independence.md).
//
// Los ids de columna vienen de docs/monday-column-map.md — NUNCA se inventan.
import type { BoardSlug } from './boards';

// ── Entidades nativas ──────────────────────────────────────────────────────
export type NativeEntity =
  | 'opportunity' | 'opportunity_line'
  | 'project' | 'project_line'
  | 'product' | 'institution' | 'contact' | 'supplier';

export const NATIVE_ENTITIES: NativeEntity[] = [
  'opportunity', 'opportunity_line', 'project', 'project_line',
  'product', 'institution', 'contact', 'supplier',
];

/** BoardSlug (mirror de Monday) ↔ entidad nativa. Relación 1:1. */
export const ENTITY_FOR_SLUG: Record<BoardSlug, NativeEntity> = {
  oportunidades: 'opportunity',
  oportunidades_sub: 'opportunity_line',
  proyectos: 'project',
  proyectos_sub: 'project_line',
  productos: 'product',
  instituciones: 'institution',
  contactos: 'contact',
  proveedores: 'supplier',
};

export const SLUG_FOR_ENTITY: Record<NativeEntity, BoardSlug> = {
  opportunity: 'oportunidades',
  opportunity_line: 'oportunidades_sub',
  project: 'proyectos',
  project_line: 'proyectos_sub',
  product: 'productos',
  institution: 'instituciones',
  contact: 'contactos',
  supplier: 'proveedores',
};

export function isNativeEntity(s: string): s is NativeEntity {
  return (NATIVE_ENTITIES as string[]).includes(s);
}

// ── Tipos de campo nativos ─────────────────────────────────────────────────
export type NativeFieldType =
  | 'text' | 'long_text' | 'number' | 'money' | 'date'
  | 'status' | 'dropdown' | 'people' | 'relation' | 'file' | 'computed';

/** Tipos cuyo valor de display es numérico (para extraer `n` al proyectar). */
export function isNumericType(t: NativeFieldType): boolean {
  return t === 'number' || t === 'money';
}

export interface FieldDef {
  /** nombre semántico nativo (clave en records.fields) */
  name: string;
  type: NativeFieldType;
  /** true = campo interno de costeo (no visible para vendedor) — informativo,
   *  la autorización real la sigue dando shared/visibility.ts en la API paralela. */
  internal?: boolean;
}

/** Columnas "calientes" que se promueven a columnas propias de `records` (indexables). */
export interface HotSpec {
  /** columna status cuyo label es la etapa del pipeline (records.stage) */
  stageCol?: string;
  /** columna item_id que sirve de folio de negocio (records.folio) */
  folioCol?: string;
  /** columna cuyo número es el monto principal (records.amount) */
  amountCol?: string;
}

/** Relación saliente declarada en una columna board_relation de Monday. */
export interface RelationDef {
  /** nombre de la relación (rel en record_relations) */
  rel: string;
  /** entidad destino */
  to: NativeEntity;
}

// ── Mapa de campos por entidad ─────────────────────────────────────────────
// Formato: { <mondayColId>: { name, type, internal? } }. Las columnas no listadas
// aquí igual se conservan al proyectar, bajo la clave `x_<colId>` (fidelidad total
// para el corte) — este mapa solo define los NOMBRES semánticos nativos.
export const FIELD_MAP: Record<NativeEntity, Record<string, FieldDef>> = {
  opportunity: {
    deal_stage: { name: 'etapa', type: 'status' },
    pulse_id_mm0qcq0m: { name: 'folio', type: 'text' },
    deal_owner: { name: 'vendedor', type: 'people' },
    multiple_person_mm0wt53c: { name: 'vendedores_secundarios', type: 'people' },
    deal_expected_close_date: { name: 'fecha_limite', type: 'date' },
    deal_contact: { name: 'contacto', type: 'relation' },
    lookup_mm1bs976: { name: 'institucion', type: 'computed' },
    lookup_mm0xf2r5: { name: 'cargo', type: 'computed' },
    dropdown_mm03g067: { name: 'zona', type: 'dropdown' },
    lookup_mm0pt4mj: { name: 'cantidad_total', type: 'number' },
    lookup_mkznd66k: { name: 'subtotal', type: 'money' },
    lookup_mm00p07m: { name: 'total', type: 'money' },
    date_mm09mv5b: { name: 'fecha_cotizacion', type: 'date' },
    text_mm0gje0: { name: 'vigencia_cotizacion', type: 'text' },
    text_mm0gjrrd: { name: 'tiempo_entrega', type: 'text' },
    long_text_mm1m416j: { name: 'comentarios_cotizacion', type: 'long_text' },
    file_mm0fgrzq: { name: 'cotizaciones_generadas', type: 'file' },
    file_mm0zjras: { name: 'cotizaciones_firmadas', type: 'file' },
    file_mm0z6rze: { name: 'cotizaciones_sin_precio', type: 'file' },
    color_mm47f0ca: { name: 'tipo_cotizacion', type: 'status' },
    dropdown_mm0mg00: { name: 'razon_perdida', type: 'dropdown' },
    text_mm47xmh: { name: 'razon_perdida_comentario', type: 'text' },
    lookup_mm087at6: { name: 'etapa_costeo', type: 'computed' },
    date_mm094kzf: { name: 'fecha_solicitud_costeo', type: 'date' },
    date_mm09b6nz: { name: 'fecha_validacion_costeo', type: 'date' },
    date_mm0mc3dj: { name: 'fecha_costeo', type: 'date' },
    multiple_person_mm03qyw9: { name: 'compras', type: 'people', internal: true },
    multiple_person_mm1m73qp: { name: 'responsable_compras', type: 'people', internal: true },
    lookup_mm4g2hqf: { name: 'utilidad_total', type: 'money', internal: true },
    lookup_mm35sk4e: { name: 'costo_total', type: 'money', internal: true },
    lookup_mm0cvyfc: { name: 'utilidad_pct', type: 'number', internal: true },
    lookup_mm1w47fq: { name: 'margen_gob_total', type: 'money', internal: true },
  },
  opportunity_line: {
    text_mm0bkm1j: { name: 'producto_ref', type: 'text' },
    lookup_mm0x4kda: { name: 'producto_nombre', type: 'computed' },
    text_mm0bxy39: { name: 'sku', type: 'text' },
    lookup_mkzn7x9a: { name: 'sku_auto', type: 'computed' },
    lookup_mm0xn98d: { name: 'marca', type: 'computed' },
    text_mm07s2mg: { name: 'color', type: 'text' },
    lookup_mm19c0b6: { name: 'tallas', type: 'computed' },
    numeric_mkzm6399: { name: 'cantidad', type: 'number' },
    lookup_mm0w4f4v: { name: 'unidad', type: 'computed' },
    lookup_mm0xw8p7: { name: 'descripcion_cotizacion', type: 'computed' },
    color_mm1b34bg: { name: 'embellecimiento_status', type: 'status' },
    long_text_mm1bj4pt: { name: 'descripcion_embellecimientos', type: 'long_text' },
    long_text_mm1hyszv: { name: 'comentarios_ventas', type: 'long_text' },
    numeric_mkzneg3d: { name: 'precio_venta_cu', type: 'money' },
    formula_mkznmjh6: { name: 'subtotal', type: 'money' },
    formula_mm0rtdqp: { name: 'iva', type: 'money' },
    formula_mm00xy0n: { name: 'total_con_iva', type: 'money' },
    color_mm084gvf: { name: 'etapa_costeo_linea', type: 'status' },
    numeric_mm0bph99: { name: 'costo_distr_cu', type: 'money', internal: true },
    formula_mkzngnjm: { name: 'costo_real_cu', type: 'money', internal: true },
    numeric_mm2qzzbe: { name: 'precio_sugerido', type: 'money', internal: true },
    lookup_mm11t8gj: { name: 'moneda', type: 'computed', internal: true },
  },
  project: {
    pulse_id_mm1a12gy: { name: 'folio', type: 'text' },
    project_status: { name: 'estado', type: 'status' },
    lookup_mm20g4n6: { name: 'estado_productos', type: 'computed' },
    date_mm0m1vfv: { name: 'fecha_entrega', type: 'date' },
    link_mm1amwz8: { name: 'link_tallas', type: 'text' },
    file_mm0hwapr: { name: 'cotizaciones', type: 'file' },
    lookup_mm1dwn6: { name: 'institucion', type: 'computed' },
    multiple_person_mm0hrnqq: { name: 'vendedor', type: 'people' },
    color_mm0md4z8: { name: 'estado_facturacion', type: 'status', internal: true },
    color_mm0mcrjq: { name: 'estado_pago', type: 'status' },
    board_relation_mm0hf0y3: { name: 'oportunidad', type: 'relation' },
  },
  project_line: {
    color_mm0hqf79: { name: 'estado_producto', type: 'status' },
    long_text_mm1cqh8e: { name: 'emb_espalda', type: 'long_text' },
    long_text_mm1cyqts: { name: 'emb_frente_derecho', type: 'long_text' },
    long_text_mm1c59cg: { name: 'emb_frente_izquierdo', type: 'long_text' },
    long_text_mm1c2eyf: { name: 'emb_manga_derecha', type: 'long_text' },
    long_text_mm1cyq91: { name: 'emb_manga_izquierda', type: 'long_text' },
    long_text_mm1c6ya0: { name: 'emb_etiqueta_fabricante', type: 'long_text' },
    long_text_mm1cnbbr: { name: 'emb_etiqueta_propiedad', type: 'long_text' },
    long_text_mm2077h1: { name: 'emb_otros', type: 'long_text' },
    numeric_mm1dj4fp: { name: 'costo_distr_cu', type: 'money', internal: true },
  },
  // Catálogos: mapa esencial; el resto de columnas se conservan como x_<colId>.
  product: {},
  institution: {},
  contact: {
    text_mm0dz8yj: { name: 'cargo', type: 'text' },
    contact_account: { name: 'institucion', type: 'relation' },
  },
  supplier: {},
};

// ── Columnas calientes por entidad ─────────────────────────────────────────
export const HOT: Record<NativeEntity, HotSpec> = {
  opportunity: { stageCol: 'deal_stage', folioCol: 'pulse_id_mm0qcq0m', amountCol: 'lookup_mm00p07m' },
  opportunity_line: { amountCol: 'formula_mm00xy0n' },
  project: { stageCol: 'project_status', folioCol: 'pulse_id_mm1a12gy' },
  project_line: {},
  product: {},
  institution: {},
  contact: {},
  supplier: {},
};

// ── Relaciones salientes (columnas board_relation) ─────────────────────────
export const RELATION_MAP: Record<NativeEntity, Record<string, RelationDef>> = {
  opportunity: { deal_contact: { rel: 'contacto', to: 'contact' } },
  opportunity_line: { board_relation_mkzmafgp: { rel: 'producto', to: 'product' } },
  project: { board_relation_mm0hf0y3: { rel: 'oportunidad', to: 'opportunity' } },
  contact: { contact_account: { rel: 'institucion', to: 'institution' } },
  project_line: {},
  product: {},
  institution: {},
  supplier: {},
};

// ── DTOs de la API paralela ────────────────────────────────────────────────
/** Valor nativo de un campo: `t` display, `n` numérico (si aplica), `v` crudo. */
export interface NativeValue {
  t: string | null;
  n?: number | null;
  v?: unknown;
}

export interface NativeRecordDTO {
  entity: NativeEntity;
  id: number;
  parentId: number | null;
  title: string;
  stage: string | null;
  folio: string | null;
  amount: number | null;
  ownerIds: number[];
  source: 'monday' | 'native';
  fields: Record<string, NativeValue>;
  createdAt: string;
  updatedAt: string;
  /** solo en detalle */
  children?: NativeRecordDTO[];
  relations?: { rel: string; toEntity: NativeEntity; toId: number }[];
}

export interface NativeActivityDTO {
  id: number;
  kind: string;
  author: string | null;
  body: string | null;
  createdAt: string;
}

/** El nombre de campo nativo para una columna de Monday (o `x_<colId>` si no mapeada). */
export function nativeFieldName(entity: NativeEntity, colId: string): string {
  return FIELD_MAP[entity][colId]?.name ?? `x_${colId}`;
}

/** La columna de Monday para un nombre de campo nativo (inverso de nativeFieldName).
 *  Sirve al camino de ESCRITURA dormido: traduce edición nativa → colId de Monday. */
export function mondayColForField(entity: NativeEntity, field: string): string | null {
  if (field.startsWith('x_')) return field.slice(2);
  const entry = Object.entries(FIELD_MAP[entity]).find(([, def]) => def.name === field);
  return entry ? entry[0] : null;
}
