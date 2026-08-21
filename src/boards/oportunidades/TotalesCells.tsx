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
        position: 'sticky', top: 0, zIndex: 2,
        display: 'flex', justifyContent: 'flex-end', gap: 10,
        padding: '4px 18px 5px', background: 'var(--surface-quiet, #fafafa)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
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
      {/* Mismo hueco que la columna "actualizado hace X" del renglón, para que
          las etiquetas caigan exactamente sobre sus números. */}
      <div style={{ width: 70, flex: 'none' }} />
    </div>
  );
}

export function TotalesCells({ totales, metricas }: { totales: TotalesDTO | undefined; metricas: Metrica[] }) {
  if (metricas.length === 0) return null;
  return (
    <>
      {metricas.map(m => {
        const { texto, color } = textoDe(m, totales);
        return (
          <div
            key={m.key}
            title={m.titulo}
            style={{
              width: m.width, flex: 'none', textAlign: 'right',
              font: 'var(--text-label)', fontVariantNumeric: 'tabular-nums',
              color: color ?? (texto === '—' ? 'var(--ink-faint)' : 'var(--ink-secondary)'),
              fontWeight: color ? 600 : 400,
              whiteSpace: 'nowrap', overflow: 'hidden',
            }}
          >
            {texto}
          </div>
        );
      })}
    </>
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
