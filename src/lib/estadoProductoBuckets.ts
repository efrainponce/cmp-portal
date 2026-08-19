// src/lib/estadoProductoBuckets.ts — agrupa los 14 labels de `color_mm0hqf79`
// (Estado del producto, proyectos_sub) en buckets de avance para la "batería" del
// tab Ejecución (ProgressBattery.tsx). Lógica pura, sin red — testeable con vitest.
// El orden aquí es el orden REAL del flujo (no el `index` que Monday trae hoy en el
// board, que está desordenado) — mismo criterio que PROJECT_STATUS_ORDER ya usa un
// orden canónico propio en vez de confiar en el índice de Monday.
export type EstadoBucketKey =
  | 'por_surtir' | 'produccion' | 'embellecimiento' | 'en_camino' | 'con_vendedor' | 'entregado' | 'incidencia';

export interface EstadoBucket {
  key: EstadoBucketKey;
  label: string;
  color: string;
}

export const ESTADO_BUCKETS: EstadoBucket[] = [
  { key: 'por_surtir', label: 'Por surtir', color: '#9aa5b1' },
  { key: 'produccion', label: 'Producción', color: '#a1e3f6' },
  { key: 'embellecimiento', label: 'Embellecimiento', color: '#5559df' },
  { key: 'en_camino', label: 'En camino', color: '#fdab3d' },
  { key: 'con_vendedor', label: 'Con vendedor', color: '#9d50dd' },
  { key: 'entregado', label: 'Entregado', color: '#037f4c' },
  { key: 'incidencia', label: 'Incidencia/Retraso', color: '#df2f4a' },
];

// Labels de color_mm0hqf79 (shared/notifications.ts PRODUCT_STATUS_LABELS) → bucket.
// Realineado con Monday el 2026-08-19: "Enviado con el" ya no existe en el
// board y las cuatro etiquetas de abajo no estaban aquí, así que las líneas en
// esos estados no sumaban a ningún segmento de la batería (se ignoran en
// silencio, ver sumBuckets). El bucket de cada una es criterio del portal, no
// de Monday: recolección pendiente = todavía sin surtir; almacén CMP = ya
// llegó y va en camino al cliente, igual que "En CMP para entrega cliente".
export const LABEL_TO_BUCKET: Record<string, EstadoBucketKey> = {
  'Pendiente OC al Prov': 'por_surtir',
  'OC Proveedor enviada': 'por_surtir',
  'Pendiente de Recolectar': 'por_surtir',
  'Pendiente de Recoleccion': 'por_surtir',
  'En produccion': 'produccion',
  'En CMP para embellecer': 'embellecimiento',
  'En embellecimiento': 'embellecimiento',
  'En tránsito': 'en_camino',
  'ALMACEN CDMX': 'en_camino',
  'ALMACEN MERIDA': 'en_camino',
  'En CMP para entrega cliente': 'en_camino',
  'Con vendedor para entrega cliente': 'con_vendedor',
  'Entregado': 'entregado',
  'Incidencia/Retraso': 'incidencia',
};

// Orden real del flujo (no el `index` que Monday trae hoy, desordenado) — para el
// selector de "cambiar estado" del tab Ejecución (ProyectoSection.tsx EstadoChip).
export const ESTADO_PRODUCTO_ORDER: string[] = [
  'Pendiente OC al Prov', 'OC Proveedor enviada', 'Pendiente de Recolectar',
  'Pendiente de Recoleccion', 'En produccion', 'En tránsito',
  'ALMACEN CDMX', 'ALMACEN MERIDA', 'En CMP para embellecer', 'En embellecimiento',
  'En CMP para entrega cliente', 'Con vendedor para entrega cliente',
  'Entregado', 'Incidencia/Retraso',
];

export interface LabelWeight { label: string; weight: number }

export interface BatteryData {
  segments: { bucket: EstadoBucket; weight: number; pct: number }[];
  total: number;
  incidencias: number;
}

const EMPTY: BatteryData = { segments: ESTADO_BUCKETS.map(b => ({ bucket: b, weight: 0, pct: 0 })), total: 0, incidencias: 0 };

/** Suma pesos (piezas o líneas, según quien llame) por bucket. Labels desconocidas
 * o pesos <= 0 se ignoran en vez de tronar — datos de Monday, nunca confiar ciegos. */
export function batteryFromLabelWeights(weights: LabelWeight[]): BatteryData {
  const counts: Record<EstadoBucketKey, number> = {
    por_surtir: 0, produccion: 0, embellecimiento: 0, en_camino: 0, con_vendedor: 0, entregado: 0, incidencia: 0,
  };
  for (const { label, weight } of weights) {
    if (weight <= 0) continue;
    const bucket = LABEL_TO_BUCKET[label];
    if (!bucket) continue;
    counts[bucket] += weight;
  }
  const total = ESTADO_BUCKETS.reduce((s, b) => s + counts[b.key], 0);
  if (total === 0) return EMPTY;
  return {
    segments: ESTADO_BUCKETS.map(b => ({ bucket: b, weight: counts[b.key], pct: (counts[b.key] / total) * 100 })),
    total,
    incidencias: counts.incidencia,
  };
}

/** Batería a partir de subitems ya cargados (ItemDetailDTO.children) — pondera por
 * Cantidad (piezas), no por número de líneas. Uso: tab Ejecución del drawer. */
export function batteryFromSubitems(rows: { estado?: string; cantidad?: number }[]): BatteryData {
  return batteryFromLabelWeights(
    rows.filter(r => r.estado).map(r => ({ label: r.estado as string, weight: r.cantidad ?? 0 })),
  );
}

/** Batería a partir del texto crudo del mirror "Estado de productos"
 * (lookup_mm20g4n6, un label por subitem, comma-joined, sin dedupe) — pondera por
 * NÚMERO DE LÍNEAS, no por piezas (el mirror no trae Cantidad). Uso: fila compacta
 * de la lista "Ejecución" (ProyectoBoardList.tsx), donde no se cargan subitems. */
export function batteryFromMirrorText(text: string | undefined): BatteryData {
  if (!text?.trim()) return EMPTY;
  const labels = text.split(',').map(s => s.trim()).filter(Boolean);
  return batteryFromLabelWeights(labels.map(label => ({ label, weight: 1 })));
}
