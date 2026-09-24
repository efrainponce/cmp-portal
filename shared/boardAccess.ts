// shared/boardAccess.ts — per-equipo (Role) whitelist of sidebar boards (BoardKey en
// src/app/Sidebar.tsx). Igual que shared/visibility.ts para columnas: esto solo
// declutters el nav — la protección real de datos sigue siendo shared/visibility.ts
// (columnas) + worker/lib/dal.ts (scoping de renglones). 'settings' NO vive aquí:
// el admin lo ve siempre, hardcoded en Sidebar — no es configurable ni tiene sentido
// que se pueda quitar por accidente.
import type { Role } from './types';

export const BOARD_KEYS = [
  'oportunidades', 'oportunidades_web', 'costeo', 'validacion', 'muestras', 'cot_lista',
  'doctallas', 'ordenescompra', 'oc_lista', 'ejecucion', 'logistica',
  'productos', 'instituciones', 'contactos', 'proveedores',
  'inventario',
] as const;

export type ConfigurableBoardKey = typeof BOARD_KEYS[number];

export function isConfigurableBoardKey(v: string): v is ConfigurableBoardKey {
  return (BOARD_KEYS as readonly string[]).includes(v);
}

// admin no vive en role_board_access (D1) — bypass hardcoded en getBoardAccess,
// así nunca se puede dejar sin acceso por accidente desde la UI.
export const TEAM_ROLES: Role[] = ['vendedor', 'compras', 'almacen'];

// Seed inicial (2026-07-18, pedido de Efraín): Ventas pierde Costeo/Validación/
// Inventario; el resto de equipos conserva el acceso que ya tenía implícitamente
// (todo abierto salvo Proveedores, ya restringido a compras/admin en Sidebar).
// Editable después desde el admin — esto es solo el punto de partida.
// 2026-08-11: cada equipo su propio board dentro de Proyectos, mismo patrón que
// Oportunidades/Costeo — vendedor solo "Documentación y Tallas" (es el único
// tramo que le toca: subir OC/cotización firmada y confirmar tallas); compras
// pierde ese acceso y ve el funnel completo en "Órdenes de Compra" (statuses
// ampliados en src/lib/projectStages.ts).
// 2026-09-18 (Efraín): de los boards de FLUJO, Compras se queda con DOS y nada
// mas — "Costeo" en Ventas y "Reporte de Proyectos" en Proyectos. Los dos ya
// listan TODO sin filtro de etapa (src/lib/dealStages.ts STAGE_BOARDS.costeo sin
// `stages`, src/lib/projectStages.ts PROJECT_BOARDS.ejecucion sin `statuses`), y
// el scoping por renglon ya los acota a lo suyo (worker/lib/dal.ts
// comprasScopeFor, comprasCol en Oportunidades y Proyectos). Los CATALOGOS
// (Productos, Instituciones, Contactos, Proveedores) se quedan — Efraín el mismo
// dia: "esto si se queda". Ojo: quitarle 'inventario' no es solo declutter —
// /api/inventario/* y el PDF de movimiento tambien lo checan
// (worker/routes/inventario.ts, worker/lib/documents.ts) y ahora responden 403.
// 2026-09-18 (Elisa): 'oc_lista' = todas las OC en una lista. Efraín, mismo dia:
// "este board solo lo ven admins y compras" — es el tercer board de flujo de
// Compras. Igual que 'inventario', aqui el acceso no es solo declutter: las
// rutas /api/oc-lista/* lo checan y responden 403 (worker/routes/ocLista.ts).
// Los renglones van acotados por el scoping de Proyectos: cada quien de compras
// ve las OC de SUS proyectos (comprasScopeFor), no todas.
// 2026-09-21 (Efraín): 'muestras' = "Solicitudes de muestra", todas las
// solicitudes en una lista (como Lista de OC). Ventas las pide y Compras las
// consigue. Solo declutter: /api/muestras recorta por renglón con el scoping
// del item ligado (worker/lib/muestras.ts).
// 2026-09-24 (Efraín): 'cot_lista' = "Lista de cotizaciones", todas las
// cotizaciones al cliente en una lista (como Lista de OC), en Ventas. Como
// 'oc_lista', la ruta /api/cot-lista lo checa (403 sin él) y los renglones van
// acotados por el scoping de Oportunidades — cada vendedor ve las suyas y las
// de su zona. Compras también (Efraín, mismo día): ve las de las oportunidades
// que ya lee.
export const DEFAULT_BOARD_ACCESS: Record<Role, readonly ConfigurableBoardKey[]> = {
  vendedor: ['oportunidades', 'oportunidades_web', 'muestras', 'cot_lista', 'doctallas',
    'productos', 'instituciones', 'contactos'],
  compras: ['costeo', 'muestras', 'cot_lista', 'ejecucion', 'oc_lista',
    'productos', 'instituciones', 'contactos', 'proveedores'],
  almacen: ['inventario'],
  admin: BOARD_KEYS,
};
