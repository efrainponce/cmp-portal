// Shared with worker (per-zone image upload validation) and frontend (zone
// list rendering) — mirrors validar_costeo.py's `_parse_embellecimiento`
// template in cmp-tallas.
export const EMBELL_TEMPLATE_KEYS = [
  'Espalda',
  'Frente derecho',
  'Frente izquierdo',
  'Manga derecha/costado derecho',
  'Manga izquierda/costado izquierdo',
  'Etiqueta del fabricante',
  'Etiqueta de propiedad',
  'Otros',
] as const;

export type EmbellZoneKey = typeof EMBELL_TEMPLATE_KEYS[number];
