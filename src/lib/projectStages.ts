// Config de los 3 accesos del sidebar que listan el board Proyectos (post-venta)
// directamente por su propio id — nunca vía el board_relation hacia la
// Oportunidad (frágil, ver worker/lib/dal.ts linkedItemId). Agrupa/filtra por
// `project_status`, no por `deal_stage` de Oportunidades (Efraín, 2026-07-17).
export type ProjectBoardKey = 'doctallas' | 'ordenescompra' | 'ejecucion' | 'logistica';

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
  // Todas las etapas antes de (e incluyendo) "Órdenes de compra listas": Compras
  // perdió el acceso a "Documentación y Tallas" (Efraín, 2026-08-11 — cada equipo
  // su propio board, mismo patrón que Oportunidades/Costeo), así que este board
  // es ahora su única ventana al Proyecto y necesita ver el funnel completo, no
  // solo el tramo final.
  ordenescompra: { key: 'ordenescompra', title: 'Órdenes de Compra', statuses: ['5', '0', '4', '2'], defaultTab: 'ordenes' },
  // Acceso propio (2026-08-05, Efraín): antes vivía junto con "Proyecto Terminado"
  // dentro de "logistica" — separado para que el seguimiento operativo (batería +
  // estado por producto/talla, tab "ejecucion") no se mezcle con proyectos ya
  // cerrados. Agrupado por Zona en vez de por status (ProyectoBoardList.tsx).
  // Renombrado a "Reporte de Proyectos" y sin filtro de status (Efraín, 2026-08-13):
  // muestra TODOS los proyectos sin importar su etapa.
  ejecucion: { key: 'ejecucion', title: 'Reporte de Proyectos', statuses: PROJECT_STATUS_ORDER, defaultTab: 'ejecucion' },
  logistica: { key: 'logistica', title: 'Logística', statuses: ['1'], defaultTab: 'logistica' },
};
