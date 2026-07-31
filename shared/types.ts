export type Role = 'vendedor' | 'compras' | 'admin' | 'almacen';

export interface Identity {
  email: string;
  phone?: string;
  monday_user_id: number;
  role: Role;
  active: boolean;
  nombre?: string;
  /** monday_user_ids que este viewer puede LEER: el suyo + los de su zona si la
   * lidera (worker/lib/zonas.ts). Lo resuelve worker/mw/identity.ts una vez por
   * request; ausente = solo el propio, que es el scope de siempre. La escritura
   * NUNCA lo usa — ver dal.getItem({ scope: 'own' }). */
  scope_user_ids?: number[];
}

// One row of the D1 mirror (table `items`).
export interface MirrorItem {
  board_id: number;
  item_id: number;
  parent_item_id: number | null;
  name: string;
  group_id: string | null;
  vendedor_ids: string;        // JSON int array — THE authz column
  monday_updated_at: string | null;
  synced_at: string;
  content_hash: string;        // canonical hash (echo suppression + reconcile skip)
  columns: string;             // raw column_values JSON [{id,type,text,value}]
}
