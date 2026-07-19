export type Role = 'vendedor' | 'compras' | 'admin' | 'almacen';

export interface Identity {
  email: string;
  phone?: string;
  monday_user_id: number;
  role: Role;
  active: boolean;
  nombre?: string;
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

// Target structure for embellishments (module 3 writes through this — never free text).
export interface EmbellecimientoSpec {
  zona: 'espalda' | 'frente_derecho' | 'frente_izquierdo' | 'manga_derecha'
      | 'manga_izquierda' | 'etiqueta_fabricante' | 'etiqueta_propiedad' | 'otros';
  aplicacion: 'bordado' | 'serigrafia' | 'parche' | 'sublimado' | 'otro';
  contenido: string;
  colores?: string[];
  dimensiones?: string;
  referenciaImagen?: string;
}
