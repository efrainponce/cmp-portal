// Board registry — ids introspected live 2026-07-13, API 2024-10. Never fabricate.
export type BoardSlug =
  | 'oportunidades' | 'oportunidades_sub'
  | 'proyectos' | 'proyectos_sub'
  | 'productos' | 'instituciones' | 'contactos' | 'proveedores';

export interface BoardDef {
  id: number;
  slug: BoardSlug;
  title: string;
  parent?: BoardSlug;          // set on subitem boards
  authzCols?: string[];        // people columns whose user-ids scope role 'vendedor'
}

export const BOARDS: Record<BoardSlug, BoardDef> = {
  oportunidades:     { id: 18395657596, slug: 'oportunidades', title: 'Oportunidades',
                       authzCols: ['deal_owner', 'multiple_person_mm0wt53c'] },
  oportunidades_sub: { id: 18395657607, slug: 'oportunidades_sub', title: 'Líneas de Oportunidad',
                       parent: 'oportunidades' },
  proyectos:         { id: 18395657594, slug: 'proyectos', title: 'Post-venta (Proyectos)',
                       authzCols: ['multiple_person_mm0hrnqq'] },
  proyectos_sub:     { id: 18395657609, slug: 'proyectos_sub', title: 'Subelementos de Proyectos',
                       parent: 'proyectos' },
  productos:         { id: 18395657591, slug: 'productos', title: 'Productos' },
  instituciones:     { id: 18395657597, slug: 'instituciones', title: 'Instituciones' },
  contactos:         { id: 18395657595, slug: 'contactos', title: 'Contactos' },
  // Proveedores (id introspectado vía Monday MCP 2026-07-17) — solo lectura,
  // catálogo para el picker de "línea manual" en el Proyecto (OC independiente).
  proveedores:       { id: 18397474806, slug: 'proveedores', title: 'Proveedores' },
};

export const boardById = (id: number): BoardDef | undefined =>
  Object.values(BOARDS).find(b => b.id === id);
