// ── CONDICIONES DE LA COTIZACIÓN ──────────────────────────────────────────────
// Campos a NIVEL COTIZACIÓN (la oportunidad entera), NO por línea de producto:
// condiciones comerciales, tiempo de entrega y vigencia (Efraín, 2026-07-30).
// Viven en columnas ya existentes del board Oportunidades — ver
// docs/monday-column-map.md; no se inventa ninguna.
//
// **PARA CAMBIAR LOS TEXTOS POR DEFECTO: EDITA `fallback` AQUÍ ABAJO.** Es el
// único lugar. Ese texto NO se escribe solo a Monday: se muestra en gris como
// placeholder mientras el campo está vacío, y el botón "Usar texto por defecto"
// del portal lo inserta tal cual para que el vendedor/compras lo ajuste.
import type { BoardSlug } from './boards';

export interface QuoteTermField {
  /** Columna de Monday en `oportunidades` (docs/monday-column-map.md). */
  id: string;
  label: string;
  /** Renderiza <textarea> en vez de <input>. */
  multiline?: boolean;
  /** Texto por defecto — placeholder + "Usar texto por defecto". */
  fallback: string;
}

export const QUOTE_TERMS_BOARD: BoardSlug = 'oportunidades';

export const QUOTE_TERMS: QuoteTermField[] = [
  {
    id: 'long_text_mm1m416j',   // Comentarios cotización
    label: 'Condiciones comerciales',
    multiline: true,
    fallback: [
      // Los asteriscos van a propósito: así está capturado hoy en Monday
      // (verificado en OPP-0601) y así lo imprime la cotización de Eledo.
      '**CONDICIONES COMERCIALES**',
      'INCLUYE EMBELLECIMIENTOS',
      'INCLUYE ENVIO',
      '50 ANTICIPO/50 CONTRA AVISO DE ENTREGA',
      '',
      'EL TIEMPO DE ENTREGA COMIENZA A PARTIR DE LA ENTREGA DE:',
      '*LA ORDEN DE COMPRA',
      '*LA FIRMA DE LA PRESENTE COTIZACIÓN',
      '*EL PAGO DEL ANTICIPO',
      '*ENTREGA TOTAL DE TALLAS (si llega aplicar).',
      'VALIDAR LOS TIEMPOS DE ENTREGA, PUEDEN SURGIR CAMBIOS SIN PREVIO AVISO.',
    ].join('\n'),
  },
  {
    id: 'text_mm0gjrrd',        // Tiempo de entrega
    label: 'Tiempo de entrega',
    fallback: '45 Días hábiles',
  },
  {
    id: 'text_mm0gje0',         // Vigencia de la cotización
    label: 'Vigencia de la cotización',
    fallback: '20 Días naturales',
  },
];
