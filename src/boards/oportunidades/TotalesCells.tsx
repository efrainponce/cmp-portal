// Métricas de la cotización en el renglón de la lista — las mismas seis cifras
// que Monday muestra en su vista de tablero (Costo Total, Subtotal, Total,
// Utilidad %, Margen Gob, Utilidad Total), que en el portal nunca se pudieron
// leer porque en Monday son columnas ESPEJO y esas llegan vacías por la API.
// Aquí vienen sumadas de las líneas por el worker (worker/lib/totales.ts).
//
// Efraín (2026-08-20): dinero abreviado ($500K, $1.3M) "para facilitar la
// lectura" y el porcentaje con el semáforo de siempre. En celular caben cuatro
// —Subtotal, Utilidad %, Utilidad Total y Margen Gob—, que son las que pidió.
import type { TotalesDTO } from '../../../shared/dto';
import { fmtMoneyShort, marginColor } from '../../lib/format';

export type MetricaKey = 'costo' | 'subtotal' | 'total' | 'utilidadPct' | 'margenGob' | 'utilidad';

interface Metrica {
  key: MetricaKey;
  label: string;
  /** Título largo para el tooltip — la etiqueta de la columna va apretada. */
  titulo: string;
  width: number;
}

// Orden de Monday, para que quien venga del tablero encuentre lo mismo.
export const METRICAS: Metrica[] = [
  { key: 'costo', label: 'Costo', titulo: 'Costo Total', width: 68 },
  { key: 'subtotal', label: 'Subtotal', titulo: 'Subtotal (sin IVA)', width: 68 },
  { key: 'total', label: 'Total', titulo: 'Total con IVA', width: 68 },
  { key: 'utilidadPct', label: 'Util. %', titulo: 'Utilidad promedio (%) — ponderada sobre el subtotal', width: 56 },
  { key: 'margenGob', label: 'M. Gob', titulo: 'Margen Gob Total', width: 62 },
  { key: 'utilidad', label: 'Utilidad', titulo: 'Utilidad Total (ya descontados costo y margen gob)', width: 72 },
];

// En celular caben cuatro y van en ESTE orden, no en el de Monday (Efraín,
// 2026-08-20): lo primero que se busca en el teléfono es cuánto deja el trato.
const MOVIL: MetricaKey[] = ['subtotal', 'utilidadPct', 'utilidad', 'margenGob'];

/** Separación entre celdas de métricas, y separación del bloque contra lo que
 * sigue (la columna "hace X"). Las dos tienen que ser IDÉNTICAS en el
 * encabezado y en el renglón o las columnas dejan de cuadrar — el renglón usa
 * gap 16 entre sus piezas (StageBoardList), así que ese es el de afuera. */
const GAP_METRICAS = 10;
const GAP_RENGLON = 16;

/** Geometría del renglón, que el encabezado tiene que copiar para caer justo
 * encima: el margen y el borde de la GroupCard que lo envuelve
 * (src/components/layout/GroupCard.tsx) más el padding lateral del renglón
 * (StageBoardList). Si alguno de los tres cambia allá, cámbialo aquí. */
const GROUPCARD_MARGEN = 24;
const GROUPCARD_BORDE = 1;
const PADDING_RENGLON = 18;

/** Qué métricas llegaron de verdad: el worker recorta las que el rol no puede
 * leer (un vendedor no recibe costo/utilidad/margen), así que la lista se
 * arma con lo que hay en vez de pintar seis columnas de guiones. Se calcula
 * sobre TODO el mapa, no sobre el primer renglón: una oportunidad sin líneas
 * no aparece en `totales` y otra sin precios trae `utilidadPct` ausente. */
export function metricasVisibles(totales: Record<string, TotalesDTO> | undefined, isMobile: boolean): Metrica[] {
  if (!totales) return [];
  const presentes = new Set<string>();
  for (const t of Object.values(totales)) {
    for (const k of Object.keys(t)) presentes.add(k);
  }
  // utilidadPct viaja con utilidad; sin líneas con precio no viene ninguna vez
  // y entonces sí sobra la columna.
  if (presentes.has('utilidad')) presentes.add('utilidadPct');
  const base = isMobile
    ? MOVIL.map(k => METRICAS.find(m => m.key === k)!)
    : METRICAS;
  return base.filter(m => presentes.has(m.key));
}

function textoDe(m: Metrica, t: TotalesDTO | undefined): { texto: string; color?: string } {
  const v = t?.[m.key];
  if (v === undefined) return { texto: '—' };
  if (m.key === 'utilidadPct') return { texto: `${v.toFixed(1)}%`, color: marginColor(v) };
  // La Utilidad Total se colorea con su propio porcentaje, igual que la fila de
  // totales del tab Cotización: el número solo no dice si el trato es bueno.
  const color = m.key === 'utilidad' && t?.utilidadPct !== undefined ? marginColor(t.utilidadPct) : undefined;
  return { texto: fmtMoneyShort(v), color };
}

/** Encabezado alineado con las celdas del renglón — sin él, seis números
 * pegados no se sabe qué son. Va sticky arriba del scroll de la lista. */
export function TotalesHeader({ metricas, isMobile }: { metricas: Metrica[]; isMobile: boolean }) {
  if (isMobile || metricas.length === 0) return null;
  return (
    <div
      style={{
        // El contenedor de la lista NO lleva padding arriba cuando este
        // encabezado existe: se lo come él (16px), porque un sticky se pega al
        // borde del padding box y esos 16 px quedaban por ENCIMA del
        // encabezado — por ahí se asomaba media fila deslizándose, que es el
        // bug visual que reportó Efraín el 2026-08-20. El fondo es el del
        // lienzo (--bg), no un gris propio, para que la franja no se note.
        position: 'sticky', top: 0, zIndex: 3,
        display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
        gap: GAP_RENGLON,
        // Los renglones NO empiezan en el borde del contenedor: viven dentro de
        // una GroupCard con 24 px de margen y 1 px de borde. Sin descontar esos
        // 25 px, cada título quedaba 25 px a la derecha de su columna aunque el
        // padding de 18 px coincidiera (Efraín, 2026-08-20). Se mide con
        // scripts/verificar-alineacion.mjs, no a ojo.
        margin: `0 ${GROUPCARD_MARGEN}px`,
        padding: `16px ${GROUPCARD_BORDE + PADDING_RENGLON}px 5px`,
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <div style={{ display: 'flex', gap: GAP_METRICAS }}>
        {metricas.map(m => (
          <div
            key={m.key}
            title={m.titulo}
            style={{
              width: m.width, textAlign: 'right', font: 'var(--text-caption)',
              color: 'var(--ink-quiet)', letterSpacing: '.02em',
            }}
          >
            {m.label}
          </div>
        ))}
      </div>
      {/* Mismo hueco que la columna "actualizado hace X" del renglón, para que
          las etiquetas caigan exactamente sobre sus números. */}
      <div style={{ width: 70, flex: 'none' }} />
    </div>
  );
}

export function TotalesCells({ totales, metricas, strong = false }: {
  totales: TotalesDTO | undefined; metricas: Metrica[];
  /** Fila de suma (encabezado de grupo / gran total): mismo ancho y misma
   * posición de columna que un renglón normal, pero en negritas para que se
   * lea como un total y no como un proyecto más. */
  strong?: boolean;
}) {
  if (metricas.length === 0) return null;
  // Las celdas van en su PROPIO contenedor, no sueltas en el renglón: sueltas
  // heredaban el gap de 16 px del renglón mientras el encabezado usaba 10, y
  // esos 6 px por columna corrían los números casi 40 px a la izquierda de su
  // título (Efraín, 2026-08-20: "no cuadran las columnas"). Ahora el gap entre
  // celdas y el gap contra la fecha son los mismos constantes en los dos lados.
  return (
    <div style={{ display: 'flex', gap: GAP_METRICAS, flex: 'none' }}>
      {metricas.map(m => {
        const { texto, color } = textoDe(m, totales);
        return (
          <div
            key={m.key}
            title={m.titulo}
            style={{
              width: m.width, flex: 'none', textAlign: 'right',
              font: 'var(--text-label)', fontVariantNumeric: 'tabular-nums',
              color: color ?? (texto === '—' ? 'var(--ink-faint)' : strong ? 'var(--ink)' : 'var(--ink-secondary)'),
              fontWeight: strong ? 700 : color ? 600 : 400,
              whiteSpace: 'nowrap', overflow: 'hidden',
            }}
          >
            {texto}
          </div>
        );
      })}
    </div>
  );
}

/** Versión de celular: una línea de "etiqueta valor" que se acomoda sola, en
 * vez de columnas fijas que a 390 px no caben. */
export function TotalesChips({ totales, metricas }: { totales: TotalesDTO | undefined; metricas: Metrica[] }) {
  if (metricas.length === 0 || !totales) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 1 }}>
      {metricas.map(m => {
        const { texto, color } = textoDe(m, totales);
        if (texto === '—') return null;
        return (
          <div key={m.key} style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <span style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>{m.label}</span>
            <span style={{
              font: 'var(--text-label)', fontVariantNumeric: 'tabular-nums',
              color: color ?? 'var(--ink-secondary)', fontWeight: color ? 600 : 400,
            }}>{texto}</span>
          </div>
        );
      })}
    </div>
  );
}


/** Suma de varias cotizaciones — el total de una zona o de la lista completa
 * (Efraín, 2026-08-27, para el Reporte de Proyectos). Solo suma las métricas
 * que de verdad llegaron: si el rol no recibió `costo`, el total tampoco lo
 * inventa en $0 y la columna sigue sin pintarse. La Utilidad % se RECALCULA
 * ponderada sobre el subtotal sumado — promediar los porcentajes de cada
 * proyecto daría un número distinto (y falso) al de Monday y al de la fila de
 * totales del tab Cotización. */
export function sumaTotales(lista: (TotalesDTO | undefined)[]): TotalesDTO {
  const out: TotalesDTO = { lineas: 0 };
  const acumular = (k: 'costo' | 'subtotal' | 'total' | 'utilidad' | 'margenGob', v: number | undefined) => {
    if (v === undefined) return;
    out[k] = (out[k] ?? 0) + v;
  };
  for (const t of lista) {
    if (!t) continue;
    out.lineas += t.lineas;
    acumular('costo', t.costo);
    acumular('subtotal', t.subtotal);
    acumular('total', t.total);
    acumular('utilidad', t.utilidad);
    acumular('margenGob', t.margenGob);
  }
  if (out.utilidad !== undefined && out.subtotal !== undefined && out.subtotal > 0) {
    out.utilidadPct = (out.utilidad / out.subtotal) * 100;
  }
  return out;
}

/** Bloque de totales para el encabezado de un grupo (GroupCard): las mismas
 * celdas del renglón más el hueco de la columna "hace X", para que cada suma
 * caiga exactamente sobre su columna. */
export function TotalesGrupo({ totales, metricas, isMobile }: {
  totales: TotalesDTO; metricas: Metrica[]; isMobile: boolean;
}) {
  if (metricas.length === 0) return null;
  if (isMobile) {
    return (
      <div style={{ marginLeft: 'auto', minWidth: 0 }}>
        <TotalesChips totales={totales} metricas={metricas} />
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: GAP_RENGLON, marginLeft: 'auto', flex: 'none' }}>
      <TotalesCells totales={totales} metricas={metricas} strong />
      <div style={{ width: 70, flex: 'none' }} />
    </div>
  );
}

/** Gran total al final de la lista — misma geometría que TotalesHeader (que es
 * la del renglón), para que la última fila caiga en columna con todo lo de
 * arriba. Va sticky abajo: con 90 proyectos, un total al que hay que llegar
 * haciendo scroll no sirve de nada. */
export function TotalesGranTotal({ totales, metricas, isMobile }: {
  totales: TotalesDTO; metricas: Metrica[]; isMobile: boolean;
}) {
  if (metricas.length === 0) return null;
  return (
    <div
      style={{
        position: 'sticky', bottom: 0, zIndex: 3,
        display: 'flex', alignItems: 'center', gap: GAP_RENGLON,
        margin: `4px ${isMobile ? 10 : GROUPCARD_MARGEN}px 0`,
        padding: isMobile ? '10px 14px' : `10px ${GROUPCARD_BORDE + PADDING_RENGLON}px`,
        background: 'var(--bg-sunken)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)', letterSpacing: '.02em' }}>
        TOTAL
      </div>
      {isMobile ? (
        <div style={{ marginLeft: 'auto', minWidth: 0 }}>
          <TotalesChips totales={totales} metricas={metricas} />
        </div>
      ) : (
        <>
          <div style={{ marginLeft: 'auto' }} />
          <TotalesCells totales={totales} metricas={metricas} strong />
          <div style={{ width: 70, flex: 'none' }} />
        </>
      )}
    </div>
  );
}
