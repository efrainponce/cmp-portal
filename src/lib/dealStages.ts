// Etapa (deal_stage) label map — from docs/monday-column-map.md, introspected
// 2026-07-13. Never fabricate; re-introspect on drift.
export const DEAL_STAGE_LABELS: Record<string, string> = {
  '0': 'En Seguimiento',
  '1': 'Ganada',
  '2': 'Perdida',
  '3': 'En Negociación',
  '4': 'Nueva oportunidad',
  '5': 'Cancelada',
  '6': 'Cotización',
  '7': 'Costeo en validación',
  '8': 'Esperando OC',
  '9': 'Costeo Confirmado',
  '15': 'En costeo',
};

// Real pipeline order per Monday's deal_stage status column settings
// (labels_positions_v2), live-introspected 2026-07-14 — CONFIRMED, not a guess.
// Nueva oportunidad -> En costeo -> Costeo en validación -> Costeo Confirmado
// -> Cotización -> En Seguimiento -> En Negociación -> Esperando OC -> Ganada
// -> Perdida -> Cancelada.
export const DEAL_STAGE_ORDER = ['4', '15', '7', '9', '6', '0', '3', '8', '1', '2', '5'];

/**
 * True when `stage` sits at or past `threshold` in DEAL_STAGE_ORDER.
 * Unknown/absent stages fail open (return true): the UI only declutters,
 * the server already protects the data.
 */
export function stageAtOrAfter(stage: string | undefined, threshold: string): boolean {
  if (!stage) return true;
  const pos = DEAL_STAGE_ORDER.indexOf(stage);
  if (pos === -1) return true;
  return pos >= DEAL_STAGE_ORDER.indexOf(threshold);
}

export type StageBoardKey = 'oportunidades' | 'costeo' | 'validacion' | 'doctallas' | 'ordenescompra' | 'logistica';

export interface StageBoardConfig {
  key: StageBoardKey;
  title: string;
  subtitleSuffix: string;       // appended after "{n} activas"
  /** deal_stage values this view filters to; undefined = full pipeline (Oportunidades). */
  stages?: string[];
  defaultTab: string;
}

// Sidebar order follows DEAL_STAGE_ORDER above: Nueva oportunidad (full
// pipeline) -> En costeo -> Costeo en validación -> Costeo Confirmado
// (doc/tallas) -> Esperando OC -> Ganada (logística).
export const STAGE_BOARDS: Record<StageBoardKey, StageBoardConfig> = {
  oportunidades: { key: 'oportunidades', title: 'Oportunidades', subtitleSuffix: '', defaultTab: 'cotizacion' },
  costeo: { key: 'costeo', title: 'Costeo', subtitleSuffix: ' · captura de costo por elemento', stages: ['15'], defaultTab: 'cotizacion' },
  validacion: { key: 'validacion', title: 'Validación Costeo', subtitleSuffix: ' · validación de precio de venta', stages: ['7'], defaultTab: 'cotizacion' },
  doctallas: { key: 'doctallas', title: 'Documentación y Tallas', subtitleSuffix: '', stages: ['9'], defaultTab: 'documentacion' },
  ordenescompra: { key: 'ordenescompra', title: 'Órdenes de Compra', subtitleSuffix: '', stages: ['8'], defaultTab: 'ordenes' },
  logistica: { key: 'logistica', title: 'Logística', subtitleSuffix: '', stages: ['1'], defaultTab: 'logistica' },
};
