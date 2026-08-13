// shared/notifications.ts — Ruteo de notificaciones del portal (worker/lib/notify.ts las
// emite). Decisión de whitelist de Efraín: NO se cambian los destinatarios sin su OK.
import type { Role } from './types';

// Un "selector" resuelve a un conjunto de emails destinatarios en runtime:
//  - 'owner'        → vendedor(es) asignado(s) al item (vendedor_ids del mirror)
//  - 'comprador'    → persona(s) de Compras asignada(s) AL ITEM (columna "Compras"
//    de Oportunidades / "Compras" `project_owner` de Proyectos — NO todo el equipo,
//    ver worker/lib/notify.ts personIdsFromColumns). Requiere que esa columna esté
//    llena; por eso es `required: true` en CREATE_FIELDS.oportunidades desde
//    2026-08-10 (Efraín: antes 'role:compras' le llegaba a TODO el equipo de
//    Compras aunque el item no fuera suyo — se reemplazó por este selector en
//    todas las entradas de abajo que antes decían 'role:compras').
//  - 'actor'        → quien disparó la acción (menciones/costeo)
//  - 'mentioned'    → los usuarios etiquetados (menciones)
//  - `role:<rol>`   → todas las identidades activas de ese rol (usar solo para
//    roles sin dueño por item, ej. 'role:admin' — ya NO para Compras)
//  - `email:<addr>` → un destinatario fijo por email (no depende de su rol —
//    ej. Elisa/administración es role='vendedor' pero recibe ciertas alertas
//    igual, Efraín 2026-08-06)
export type RecipientSelector = 'owner' | 'comprador' | 'actor' | 'mentioned' | `role:${Role}` | `email:${string}`;

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
  // El comprador asignado necesita enterarse de inmediato, no solo al revisar
  // el portal (Efraín, 2026-08-05). Antes 'role:compras' (todo el equipo);
  // acotado a 'comprador' (solo el/los asignado(s) a ESTA oportunidad) el
  // 2026-08-10 — Compras se quejó de recibir WhatsApp de oportunidades ajenas.
  'En costeo': { selectors: ['comprador'], severity: 'importante' },
  'Costeo en validación': { selectors: ['comprador', 'role:admin'] },
  // Compras confirmó → avisar también al resto de compradores asignados (no
  // solo el que confirmó) + al vendedor, que ya puede seguir. WhatsApp de
  // inmediato — pedido explícito de Efraín 2026-08-10.
  'Costeo Confirmado': { selectors: ['owner', 'comprador'], severity: 'importante' },
  // Cotización generada (botón "Generar Cotización") → el vendedor ya la puede
  // mandar al cliente, avisarle por WhatsApp de inmediato (Efraín, 2026-08-06).
  'Cotización': { selectors: ['owner'], severity: 'importante' },
  'Esperando OC': { selectors: ['owner'] },
  // Solo vendedor + Elisa/administración (no todo Compras) — decisión de
  // Efraín 2026-08-06, reemplaza el 'role:compras' anterior en esta etapa.
  'Ganada': { selectors: ['owner', 'email:administracion@mexicanadeproteccion.com'], severity: 'importante' },
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
  // 'role:compras' → 'comprador' (solo el comprador asignado al Proyecto,
  // columna "Compras" `project_owner`, copiada de la Oportunidad al ganar) —
  // mismo cambio de acotamiento 2026-08-10 que STAGE_NOTIFY, ver ahí.
  'Tallas Confirmadas': { selectors: ['comprador'] },  // vendedor validó → Compras arma las OC
  'Ordenes de compra listas': { selectors: ['owner'] },   // el vendedor puede avisar a su cliente
  'Ejecución': { selectors: ['owner'] },
  'Proyecto Terminado': { selectors: ['owner', 'comprador'] },
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
  '5': 'Enviado con el',
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
  // 'role:compras' → 'comprador' (2026-08-10, ver STAGE_NOTIFY arriba) — el
  // comprador asignado al Proyecto padre de esta línea, no todo el equipo.
  'Incidencia/Retraso': { selectors: ['owner', 'comprador'], severity: 'importante' },
};
