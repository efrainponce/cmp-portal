// Etapa canon (labels/order) lives in shared/dealStages.ts so the worker's
// assistant tools use the same source of truth; re-exported here for the UI.
export { DEAL_STAGE_LABELS, DEAL_STAGE_ORDER, stageAtOrAfter } from '../../shared/dealStages';

export type StageBoardKey = 'oportunidades' | 'oportunidades_web' | 'costeo' | 'validacion' | 'doctallas' | 'ordenescompra' | 'logistica' | 'zona_efrain';

export interface StageBoardConfig {
  key: StageBoardKey;
  title: string;
  subtitleSuffix: string;       // appended after "{n} activas"
  /** deal_stage values this view filters to; undefined = full pipeline (Oportunidades). */
  stages?: string[];
  /** deal_stage values this view hides, applied on top of `stages` (or on the
   * full pipeline when `stages` is undefined). */
  excludeStages?: string[];
  /** Solo items cuyo nombre empieza con este prefijo (case-insensitive) — mismo
   * board/data que 'oportunidades', filtrado por origen (Efraín, 2026-07-18). */
  namePrefix?: string;
  /** Solo items cuyo Vendedor (o Vendedor secundario) sea uno de estos nombres
   * (case-insensitive) — usado por 'zona_efrain' para acotar el pipeline
   * completo a los miembros de la zona privada (worker/lib/zonas.ts). Filtro
   * de conveniencia en el cliente: la protección real ya la hace el server
   * (dal.ts hidden_owner_ids) — a quien no le toca ver estos items, el fetch
   * de 'oportunidades' mismo ya se los quita antes de llegar aquí. */
  vendedorNames?: string[];
  defaultTab: string;
}

// Sidebar order follows DEAL_STAGE_ORDER above: Nueva oportunidad (full
// pipeline) -> En costeo -> Costeo en validación -> Costeo Confirmado
// -> Esperando OC -> Ganada (doc/tallas + logística).
export const STAGE_BOARDS: Record<StageBoardKey, StageBoardConfig> = {
  oportunidades: { key: 'oportunidades', title: 'Oportunidades', subtitleSuffix: '', defaultTab: 'cotizacion' },
  // Mismo board/pipeline que 'oportunidades' — sin filtro de etapa, solo items
  // cuyo nombre viene prefijado "WEB -" (leads del sitio web, ya así en Monday).
  oportunidades_web: { key: 'oportunidades_web', title: 'Oportunidades Web', subtitleSuffix: ' · web', namePrefix: 'WEB -', defaultTab: 'cotizacion' },
  // Sin `stages` (pipeline completo) pero oculta las etapas que ya no
  // corresponden a costeo: Seguimiento, Negociación, Ganada, Perdida
  // (Efraín, 2026-07-20).
  costeo: { key: 'costeo', title: 'Costeo', subtitleSuffix: '', excludeStages: ['0', '3', '1', '2'], defaultTab: 'cotizacion' },
  validacion: { key: 'validacion', title: 'Validación Costeo', subtitleSuffix: ' · validación de precio de venta', stages: ['7', '9'], defaultTab: 'cotizacion' },
  // El Proyecto (docs/tallas) solo existe una vez GANADA la oportunidad
  // (ProyectoSection.tsx) — filtrar aquí a Ganada en vez de Costeo Confirmado
  // (Efraín, 2026-07-17).
  doctallas: { key: 'doctallas', title: 'Documentación y Tallas', subtitleSuffix: '', stages: ['1'], defaultTab: 'documentacion' },
  ordenescompra: { key: 'ordenescompra', title: 'Órdenes de Compra', subtitleSuffix: '', stages: ['8'], defaultTab: 'ordenes' },
  logistica: { key: 'logistica', title: 'Logística', subtitleSuffix: '', stages: ['1'], defaultTab: 'logistica' },
  // Zona privada "Efrain" (Efraín, 2026-08-12): pipeline COMPLETO (sin filtro de
  // etapa, a diferencia de Costeo/Validación) acotado a los dos miembros de esa
  // zona — mismos nombres que sus filas de identity en D1 (worker/lib/zonas.ts
  // ZONA_PRIVADA_ADMINS_PERMITIDOS/zona_miembros). Sidebar solo la muestra a la
  // whitelist (me.zonaEfrainAccess) — ver src/app/Sidebar.tsx.
  zona_efrain: { key: 'zona_efrain', title: 'Zona Efrain', subtitleSuffix: '', vendedorNames: ['Efrain Ponce', 'Elisa Vallado'], defaultTab: 'cotizacion' },
};
