// Config de los 3 accesos del sidebar que listan el board Proyectos (post-venta)
// directamente por su propio id — nunca vía el board_relation hacia la
// Oportunidad (frágil, ver worker/lib/dal.ts linkedItemId). Agrupa/filtra por
// `project_status`, no por `deal_stage` de Oportunidades (Efraín, 2026-07-17).
export type ProjectBoardKey = 'doctallas' | 'ordenescompra' | 'logistica';

export interface ProjectBoardConfig {
  key: ProjectBoardKey;
  title: string;
  /** project_status values (índices, ver shared/column-meta.gen.ts) que caen en este acceso. */
  statuses: string[];
  defaultTab: string;
}

// Orden real del flujo post-venta (no el orden en que Monday declaró los
// labels): Desglose de tallas -> En confirmación -> Tallas Confirmadas ->
// Órdenes de compra listas -> Ejecución -> Proyecto Terminado.
export const PROJECT_STATUS_ORDER = ['5', '0', '4', '2', '3', '1'];

export const PROJECT_BOARDS: Record<ProjectBoardKey, ProjectBoardConfig> = {
  doctallas: { key: 'doctallas', title: 'Documentación y Tallas', statuses: ['5', '0', '4'], defaultTab: 'documentacion' },
  ordenescompra: { key: 'ordenescompra', title: 'Órdenes de Compra', statuses: ['2'], defaultTab: 'ordenes' },
  logistica: { key: 'logistica', title: 'Logística', statuses: ['3', '1'], defaultTab: 'logistica' },
};
