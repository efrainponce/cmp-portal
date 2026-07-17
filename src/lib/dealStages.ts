// Etapa canon (labels/order) lives in shared/dealStages.ts so the worker's
// assistant tools use the same source of truth; re-exported here for the UI.
export { DEAL_STAGE_LABELS, DEAL_STAGE_ORDER, stageAtOrAfter } from '../../shared/dealStages';

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
  costeo: { key: 'costeo', title: 'Costeo', subtitleSuffix: '', defaultTab: 'cotizacion' },
  validacion: { key: 'validacion', title: 'Validación Costeo', subtitleSuffix: ' · validación de precio de venta', stages: ['7', '9'], defaultTab: 'cotizacion' },
  doctallas: { key: 'doctallas', title: 'Documentación y Tallas', subtitleSuffix: '', stages: ['9'], defaultTab: 'documentacion' },
  ordenescompra: { key: 'ordenescompra', title: 'Órdenes de Compra', subtitleSuffix: '', stages: ['8'], defaultTab: 'ordenes' },
  logistica: { key: 'logistica', title: 'Logística', subtitleSuffix: '', stages: ['1'], defaultTab: 'logistica' },
};
