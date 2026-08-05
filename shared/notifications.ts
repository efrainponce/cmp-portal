// shared/notifications.ts — Ruteo de notificaciones del portal (worker/lib/notify.ts las
// emite). Decisión de whitelist de Efraín: NO se cambian los destinatarios sin su OK.
import type { Role } from './types';

// Un "selector" resuelve a un conjunto de emails destinatarios en runtime:
//  - 'owner'      → vendedor(es) asignado(s) al item (vendedor_ids del mirror)
//  - 'actor'      → quien disparó la acción (menciones/costeo)
//  - 'mentioned'  → los usuarios etiquetados (menciones)
//  - `role:<rol>` → todas las identidades activas de ese rol
export type RecipientSelector = 'owner' | 'actor' | 'mentioned' | `role:${Role}`;

// Severidad de un cambio de etapa: 'actualizacion' (default, solo Centro de
// Notificaciones del portal) o 'importante' (además dispara WhatsApp, ver
// worker/wa/notify.ts — requiere que el destinatario tenga phone en `identity`).
export interface StageNotifyEntry {
  selectors: RecipientSelector[];
  severity?: 'importante' | 'actualizacion';
}

// Cuando una Oportunidad llega a una etapa (deal_stage), ¿a quién se le notifica?
// Llaves = labels canon EXACTOS de shared/dealStages.ts DEAL_STAGE_LABELS.
// Etapa sin entrada aquí = sin notificación de cambio de etapa.
export const STAGE_NOTIFY: Record<string, StageNotifyEntry> = {
  // Compras necesita enterarse de inmediato, no solo al revisar el portal
  // (Efraín, 2026-08-05).
  'En costeo': { selectors: ['role:compras'], severity: 'importante' },
  'Costeo en validación': { selectors: ['role:compras', 'role:admin'] },
  'Costeo Confirmado': { selectors: ['owner'] },    // Compras confirmó → el vendedor puede seguir
  'Esperando OC': { selectors: ['owner'] },
  'Ganada': { selectors: ['owner', 'role:compras'] },
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
export const PROJECT_STATUS_NOTIFY: Record<string, StageNotifyEntry> = {
  'Tallas Confirmadas': { selectors: ['role:compras'] },  // vendedor validó → Compras arma las OC
  'Ordenes de compra listas': { selectors: ['owner'] },   // el vendedor puede avisar a su cliente
  'Ejecución': { selectors: ['owner'] },
  'Proyecto Terminado': { selectors: ['owner', 'role:compras'] },
};

// project_status → acceso del sidebar que lo lista (para el deep-link de la
// notificación) — mismo agrupamiento que PROJECT_BOARDS en src/lib/projectStages.ts,
// duplicado aquí porque el worker no puede importar de src/ (solo shared/).
export const PROJECT_STATUS_BOARD_KEY: Record<string, string> = {
  '5': 'doctallas', '0': 'doctallas', '4': 'doctallas',
  '2': 'ordenescompra',
  '3': 'logistica', '1': 'logistica',
};

// Labels de `color_mm0hqf79` "Estado del producto" (board proyectos_sub, líneas
// producto+color+talla del Proyecto) — copiados de shared/column-meta.gen.ts
// (introspectado), no fabricados. Mismo motivo que PROJECT_STATUS_LABELS: el worker
// no puede importar column-meta.gen.ts como fuente de labels de negocio.
export const PRODUCT_STATUS_LABELS: Record<string, string> = {
  '0': 'Con vendedor para entrega cliente',
  '1': 'En CMP para embellecer',
  '2': 'En embellecimiento',
  '3': 'En CMP para entrega cliente',
  '4': 'En produccion',
  '5': 'OC Proveedor lista',
  '6': 'Entregado',
  '7': 'Incidencia/Retraso',
  '8': 'OC Proveedor enviada',
  '9': 'Pendiente OC al Prov',
  '10': 'En tránsito',
};

// Cuando una línea producto+talla del Proyecto (proyectos_sub) llega a un
// `color_mm0hqf79`, ¿a quién se le notifica? Solo Incidencia/Retraso dispara aviso —
// el resto de transiciones solo alimenta el historial (worker/lib/estadoProducto.ts),
// no el centro de notificaciones (serían demasiadas por línea+talla).
export const PRODUCT_STATUS_NOTIFY: Record<string, StageNotifyEntry> = {
  'Incidencia/Retraso': { selectors: ['owner', 'role:compras'], severity: 'importante' },
};
