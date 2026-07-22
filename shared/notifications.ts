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
