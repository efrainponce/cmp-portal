// shared/boardAccess.ts — per-equipo (Role) whitelist of sidebar boards (BoardKey en
// src/app/Sidebar.tsx). Igual que shared/visibility.ts para columnas: esto solo
// declutters el nav — la protección real de datos sigue siendo shared/visibility.ts
// (columnas) + worker/lib/dal.ts (scoping de renglones). 'settings' NO vive aquí:
// el admin lo ve siempre, hardcoded en Sidebar — no es configurable ni tiene sentido
// que se pueda quitar por accidente.
import type { Role } from './types';

export const BOARD_KEYS = [
  'oportunidades', 'oportunidades_web', 'costeo', 'validacion',
  'doctallas', 'ordenescompra', 'logistica',
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
export const DEFAULT_BOARD_ACCESS: Record<Role, readonly ConfigurableBoardKey[]> = {
  vendedor: ['oportunidades', 'oportunidades_web', 'doctallas', 'ordenescompra', 'logistica',
    'productos', 'instituciones', 'contactos'],
  compras: ['oportunidades', 'oportunidades_web', 'costeo', 'validacion',
    'doctallas', 'ordenescompra', 'logistica',
    'productos', 'instituciones', 'contactos', 'proveedores', 'inventario'],
  almacen: ['inventario'],
  admin: BOARD_KEYS,
};
