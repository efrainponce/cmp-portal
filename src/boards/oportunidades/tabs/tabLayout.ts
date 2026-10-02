// Marco común de las pestañas del drawer (2026-10-01, Efraín: "usa TODA la
// pantalla en todos lados"). Antes cada pestaña traía su propio tope de ancho
// (640 / 920 / 1100 px) y en un monitor normal la mitad derecha quedaba vacía
// mientras el contenido se apilaba hacia abajo. Ahora todas ocupan el ancho
// completo y lo que son tarjetas se acomoda en columnas (`gridTarjetas`).

/** Padding de una pestaña: lateral fluido (14 px en cel, 32 en escritorio). */
export const TAB_PAD = '20px clamp(14px, 3vw, 32px) 40px';

/** Contenedor raíz de una pestaña. */
export const tabRoot: React.CSSProperties = { padding: TAB_PAD, width: '100%', boxSizing: 'border-box' };

/** Rejilla de tarjetas: tantas columnas como quepan con `min` px cada una. */
export function gridTarjetas(min = 420, gap = 12): React.CSSProperties {
  return { display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))`, gap, alignItems: 'start' };
}
