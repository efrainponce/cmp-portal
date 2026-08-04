// shared/notifications.ts — Ruteo de notificaciones del portal (worker/lib/notify.ts las
// emite). Decisión de whitelist de Efraín: NO se cambian los destinatarios sin su OK.
import type { Role } from './types';

// Un "selector" resuelve a un conjunto de emails destinatarios en runtime:
//  - 'owner'      → vendedor(es) asignado(s) al item (vendedor_ids del mirror)
//  - 'actor'      → quien disparó la acción (menciones/costeo)
//  - 'mentioned'  → los usuarios etiquetados (menciones)
//  - `role:<rol>` → todas las identidades activas de ese rol
export type RecipientSelector = 'owner' | 'actor' | 'mentioned' | `role:${Role}`;

// Cuando una Oportunidad llega a una etapa (deal_stage), ¿a quién se le notifica?
// Llaves = labels canon EXACTOS de shared/dealStages.ts DEAL_STAGE_LABELS.
// Etapa sin entrada aquí = sin notificación de cambio de etapa.
export const STAGE_NOTIFY: Record<string, RecipientSelector[]> = {
  'En costeo': ['role:compras'],                    // el vendedor la mandó a costeo → Compras
  'Costeo en validación': ['role:compras', 'role:admin'],
  'Costeo Confirmado': ['owner'],                   // Compras confirmó → el vendedor puede seguir
  'Esperando OC': ['owner'],
  'Ganada': ['owner', 'role:compras'],
};

// Labels de `project_status` (board Proyectos, post-venta) — copiados de
// shared/column-meta.gen.ts (introspectado), no fabricados. El worker no
// puede importar shared/column-meta.gen.ts como fuente de labels de negocio
// (mismo patrón que DEAL_STAGE_LABELS en shared/dealStages.ts).
export const PROJECT_STATUS_LABELS: Record<string, string> = {
  '0': 'En confirmacion de tallas',
  '1': 'Proyecto Terminado',
  '2': 'Ordenes de compra listas',
  '3': 'Ejecución',
  '4': 'Tallas Confirmadas',
  '5': 'Desglose de tallas',
};

// Cuando un Proyecto (post-venta) llega a un `project_status`, ¿a quién se le
// notifica? Reemplaza las notificaciones nativas de Monday por-elemento, que
// Compras reportó que no les llegan (WhatsApp 2026-08-04) — primer corte,
// pendiente de que Efraín tune destinatarios.
export const PROJECT_STATUS_NOTIFY: Record<string, RecipientSelector[]> = {
  'Tallas Confirmadas': ['role:compras'],           // vendedor validó → Compras arma las OC
  'Ordenes de compra listas': ['owner'],            // el vendedor puede avisar a su cliente
  'Ejecución': ['owner'],
  'Proyecto Terminado': ['owner', 'role:compras'],
};

// project_status → acceso del sidebar que lo lista (para el deep-link de la
// notificación) — mismo agrupamiento que PROJECT_BOARDS en src/lib/projectStages.ts,
// duplicado aquí porque el worker no puede importar de src/ (solo shared/).
export const PROJECT_STATUS_BOARD_KEY: Record<string, string> = {
  '5': 'doctallas', '0': 'doctallas', '4': 'doctallas',
  '2': 'ordenescompra',
  '3': 'logistica', '1': 'logistica',
};
