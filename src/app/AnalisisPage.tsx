// Pantalla "Análisis" (admin, Efraín 2026-08-17): embudo de conversión, tiempo
// de costeo y montos, cortados por Zona o Vendedor.
//
// Todo el cálculo vive en el servidor (shared/analytics.ts sobre D1); aquí solo
// se pinta. La pantalla tiene tres partes y el orden importa: los números
// grandes arriba (lo que se mira en tres segundos), el embudo en medio (dónde
// se cae el negocio), y "Datos por resolver" abajo — los renglones que el
// tablero no puede clasificar, con link al drawer para arreglarlos. Ese último
// panel es parte de la feature, no un extra: mientras existan, cualquier corte
// por zona miente un poco (Efraín: "si faltan datos hay que resolverlo").
import { useState } from 'react';
import {
  useAnalytics, PERIODOS,
  type AnalyticsResponse, type FunnelBucket, type GroupBy, type GrupoMetrics,
  type Hueco, type PeriodoDias,
} from '../lib/analyticsApi';
import { useIsMobile } from '../lib/useIsMobile';
import { fmtSyncAgo } from '../lib/format';

interface Props {
  onOpenOportunidad: (itemId: string) => void;
}

// ── Formato ──────────────────────────────────────────────────────────────────

/** Los montos aquí son de licitación: 472,105,423 no se lee de un vistazo y no
 * cabe en una celda a 390px. Se abrevia en la escala que usa la gente. */
function fmtMonto(n: number): string {
  if (!n) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toLocaleString('es-MX', { maximumFractionDigits: 1 })} M`;
  if (abs >= 10_000) return `$${Math.round(n / 1000).toLocaleString('es-MX')} mil`;
  return '$' + Math.round(n).toLocaleString('es-MX');
}

const fmtNum = (n: number) => n.toLocaleString('es-MX');

/** null se pinta como "—", nunca como 0%: "todavía no hay cerradas" y "cerró en
 * cero" son cosas distintas y confundirlas es un error de lectura caro. */
function fmtPct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

/** Horas cuando es menos de un día; días con un decimal cuando es más. */
function fmtDuracion(horas: number | null): string {
  if (horas === null) return '—';
  if (horas < 24) return `${horas.toLocaleString('es-MX', { maximumFractionDigits: 1 })} h`;
  return `${(horas / 24).toLocaleString('es-MX', { maximumFractionDigits: 1 })} d`;
}

// ── Piezas ───────────────────────────────────────────────────────────────────

function StatTile({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: 'ganada' | 'perdida';
}) {
  const color = tone === 'ganada' ? 'var(--status-ganada)'
    : tone === 'perdida' ? 'var(--status-perdida)'
      : 'var(--ink)';
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)',
      padding: '14px 16px', minWidth: 0, flex: '1 1 160px',
    }}>
      <div style={{ font: 'var(--text-eyebrow)', color: 'var(--ink-tertiary)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ font: 'var(--text-title)', color, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {hint && <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

/** Embudo: una sola serie (cuántas oportunidades llegaron a cada escalón), así
 * que un solo color y la longitud carga el dato. El % que se resalta es el del
 * escalón ANTERIOR, no el del total: ahí es donde se ve la caída real.
 *
 * Los números van FUERA de la barra a propósito: dentro, el texto cae unas
 * veces sobre el relleno y otras sobre el riel según qué tan largo salga el
 * escalón, y el monto del último paso quedaba ilegible (verificado en
 * pantalla, no supuesto). Fuera, el contraste es el mismo siempre. */
function Embudo({ buckets, isMobile }: { buckets: FunnelBucket[]; isMobile: boolean }) {
  const max = buckets[0]?.n || 1;

  const cifras = (b: FunnelBucket) => (
    <>
      <span style={{ font: 'var(--text-small-strong)', color: 'var(--ink)' }}>{fmtNum(b.n)}</span>
      <span style={{ color: 'var(--ink-secondary)' }}>{fmtMonto(b.monto)}</span>
    </>
  );

  const caidaTexto = (b: FunnelBucket, i: number) => {
    const caida = i > 0 ? 1 - b.pctDelAnterior : 0;
    return (
      <span style={{ color: caida >= 0.3 ? 'var(--status-perdida)' : 'var(--ink-quiet)' }}>
        {i === 0 ? fmtPct(1) : `−${fmtPct(caida)}`}
      </span>
    );
  };

  const track = (b: FunnelBucket) => (
    <div
      style={{ flex: 1, minWidth: 0, height: 26, background: 'var(--bg-sunken)', borderRadius: 4 }}
      title={`${fmtNum(b.n)} oportunidades · ${fmtMonto(b.monto)} · ${fmtPct(b.pctDeCreadas)} de las creadas`}
    >
      <div style={{
        width: `${Math.max((b.n / max) * 100, b.n > 0 ? 1.5 : 0)}%`, height: '100%',
        background: 'var(--accent)', borderRadius: 4,
      }} />
    </div>
  );

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {buckets.map((b, i) => (
          <div key={b.step} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', gap: 8,
              font: 'var(--text-caption)', color: 'var(--ink-secondary)', fontVariantNumeric: 'tabular-nums',
            }}>
              <span>{b.label}</span>
              <span style={{ display: 'flex', gap: 8 }}>{cifras(b)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {track(b)}
              <span style={{ flex: 'none', width: 46, textAlign: 'right', font: 'var(--text-caption)', fontVariantNumeric: 'tabular-nums' }}>
                {caidaTexto(b, i)}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {buckets.map((b, i) => (
        <div key={b.step} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 34 }}>
          <div style={{
            width: 150, flex: 'none', font: 'var(--text-caption)', color: 'var(--ink-secondary)',
            textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {b.label}
          </div>
          {track(b)}
          <div style={{
            flex: 'none', width: 150, display: 'flex', justifyContent: 'flex-end', gap: 10,
            font: 'var(--text-caption)', fontVariantNumeric: 'tabular-nums',
          }}>
            {cifras(b)}
          </div>
          <div style={{ flex: 'none', width: 56, textAlign: 'right', font: 'var(--text-caption)', fontVariantNumeric: 'tabular-nums' }}>
            {caidaTexto(b, i)}
          </div>
        </div>
      ))}
    </div>
  );
}

const TH: React.CSSProperties = {
  font: 'var(--text-eyebrow)', color: 'var(--ink-tertiary)', textTransform: 'uppercase',
  textAlign: 'right', padding: '8px 10px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)',
};
const TD: React.CSSProperties = {
  font: 'var(--text-caption)', color: 'var(--ink)', textAlign: 'right', padding: '9px 10px',
  whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid var(--border-subtle)',
};

/** La tabla ES la vista de datos del embudo: mismos números, sin geometría de
 * por medio, y el único lugar donde se comparan zonas entre sí. */
function TablaGrupos({ grupos, por }: { grupos: GrupoMetrics[]; por: GroupBy }) {
  const paso = (g: GrupoMetrics, step: string) => g.embudo.find(b => b.step === step)?.n ?? 0;
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
        <thead>
          <tr>
            <th style={{ ...TH, textAlign: 'left' }}>{por === 'zona' ? 'Zona' : 'Vendedor'}</th>
            <th style={TH}>Creadas</th>
            <th style={TH}>A costeo</th>
            <th style={TH}>Cotizadas</th>
            <th style={TH}>Ganadas</th>
            <th style={TH}>Tasa cierre</th>
            <th style={TH}>Costeo (mediana)</th>
            <th style={TH}>Pipeline</th>
            <th style={TH}>Ganado</th>
          </tr>
        </thead>
        <tbody>
          {grupos.map(g => (
            <tr key={g.clave}>
              <td style={{ ...TD, textAlign: 'left', font: 'var(--text-small-strong)' }}>{g.clave}</td>
              <td style={TD}>{fmtNum(g.creadas)}</td>
              <td style={TD}>{fmtNum(paso(g, 'costeo'))}</td>
              <td style={TD}>{fmtNum(paso(g, 'cotizada'))}</td>
              <td style={{ ...TD, color: 'var(--status-ganada)' }}>{fmtNum(g.conversion.ganadas)}</td>
              <td style={TD}>
                {fmtPct(g.conversion.tasaCierre)}
                {g.conversion.cerradas > 0 && (
                  <span style={{ color: 'var(--ink-quiet)' }}> ({g.conversion.ganadas}/{g.conversion.cerradas})</span>
                )}
              </td>
              <td style={TD}>{fmtDuracion(g.tiempoCosteo.medianaHoras)}</td>
              <td style={TD}>{fmtMonto(g.montoPipeline)}</td>
              <td style={{ ...TD, color: 'var(--status-ganada)' }}>{fmtMonto(g.conversion.montoGanado)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PanelHuecos({ huecos, onOpenOportunidad }: { huecos: Hueco[]; onOpenOportunidad: (id: string) => void }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  if (huecos.length === 0) {
    return (
      <div style={{ font: 'var(--text-caption)', color: 'var(--status-ganada)' }}>
        Sin huecos: todas las oportunidades del periodo tienen zona, vendedor, monto y sus hitos en orden.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {huecos.map(h => {
        const open = abierto === h.kind;
        return (
          <div key={h.kind} style={{
            border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
            background: 'var(--bg-raised)', overflow: 'hidden',
          }}>
            <button
              type="button"
              onClick={() => setAbierto(open ? null : h.kind)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
                background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{
                flex: 'none', minWidth: 30, textAlign: 'center', font: 'var(--text-chip)',
                color: 'var(--status-en-coste)', background: 'var(--status-en-coste-tint)',
                borderRadius: 'var(--radius-full)', padding: '3px 8px', fontVariantNumeric: 'tabular-nums',
              }}>
                {h.n}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{h.label}</span>
                <span style={{ display: 'block', font: 'var(--text-caption)', color: 'var(--ink-quiet)', marginTop: 2 }}>{h.arreglo}</span>
              </span>
              <span style={{ flex: 'none', font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>{open ? '▲' : '▼'}</span>
            </button>
            {open && (
              <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '8px 14px 12px' }}>
                {h.items.map(it => (
                  <button
                    key={it.itemId}
                    type="button"
                    onClick={() => onOpenOportunidad(String(it.itemId))}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '6px 0',
                      background: 'none', border: 'none', cursor: 'pointer',
                      font: 'var(--text-caption)', color: 'var(--accent)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}
                  >
                    {it.name}
                  </button>
                ))}
                {h.n > h.items.length && (
                  <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)', paddingTop: 6 }}>
                    …y {fmtNum(h.n - h.items.length)} más
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Pantalla ─────────────────────────────────────────────────────────────────

function Seccion({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <h2 style={{ font: 'var(--text-subtitle)', color: 'var(--ink)', margin: 0 }}>{titulo}</h2>
        {nota && <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)', marginTop: 2 }}>{nota}</div>}
      </div>
      {children}
    </section>
  );
}

function Toggle<T extends string | number | null>({ value, options, onChange }: {
  value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void;
}) {
  return (
    <div style={{
      display: 'inline-flex', background: 'var(--bg-sunken)', borderRadius: 'var(--radius-full)', padding: 2,
    }}>
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          style={{
            border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-full)', padding: '5px 12px',
            font: 'var(--text-caption)',
            background: o.value === value ? 'var(--bg-raised)' : 'transparent',
            color: o.value === value ? 'var(--ink)' : 'var(--ink-tertiary)',
            boxShadow: o.value === value ? '0 1px 2px rgba(43,41,37,.12)' : 'none',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AnalisisPage({ onOpenOportunidad }: Props) {
  const [por, setPor] = useState<GroupBy>('zona');
  const [dias, setDias] = useState<PeriodoDias>(90);
  const isMobile = useIsMobile();
  const { data, loading, error, refetch } = useAnalytics(por, dias);

  return (
    <div style={{
      height: '100%', overflowY: 'auto', padding: isMobile ? '16px 14px 40px' : '24px 28px 48px',
      display: 'flex', flexDirection: 'column', gap: 24,
    }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ font: 'var(--text-display)', color: 'var(--ink)', margin: 0 }}>Análisis</h1>
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)', marginTop: 4 }}>
            {data
              ? `${fmtNum(data.totalOportunidades)} oportunidades creadas en el periodo · mirror sincronizado ${data.syncedAt ? fmtSyncAgo(data.syncedAt) : '—'}`
              : 'Cargando…'}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Toggle
            value={dias}
            options={PERIODOS.map(p => ({ value: p.dias, label: p.label }))}
            onChange={setDias}
          />
          <Toggle
            value={por}
            options={[{ value: 'zona' as GroupBy, label: 'Zona' }, { value: 'vendedor' as GroupBy, label: 'Vendedor' }]}
            onChange={setPor}
          />
        </div>
      </header>

      {error && (
        <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>
          {error} · <button type="button" onClick={refetch} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', font: 'inherit' }}>reintentar</button>
        </div>
      )}

      {loading && !data && <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>Calculando sobre el mirror…</div>}

      {data && <Contenido data={data} por={por} isMobile={isMobile} onOpenOportunidad={onOpenOportunidad} />}
    </div>
  );
}

function Contenido({ data, por, isMobile, onOpenOportunidad }: {
  data: AnalyticsResponse; por: GroupBy; isMobile: boolean; onOpenOportunidad: (id: string) => void;
}) {
  const { conversion: c, tiempoCosteo: t } = data;
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <StatTile
          label="Pipeline"
          value={fmtMonto(data.montoPipeline)}
          hint={`${fmtMonto(c.montoAbierto)} todavía abierto`}
        />
        {/* Sin utilidad (admin fuera de la whitelist de shared/visibility.ts) el
            tile enseña solo el monto ganado — nunca "utilidad $0", que se lee
            como "no ganamos nada" en vez de "esto no te toca verlo". */}
        <StatTile
          label="Ganado"
          value={fmtMonto(c.montoGanado)}
          hint={data.utilidadGanada === undefined ? undefined : `utilidad ${fmtMonto(data.utilidadGanada)}`}
          tone="ganada"
        />
        <StatTile
          label="Tasa de cierre"
          value={fmtPct(c.tasaCierre)}
          hint={`${fmtNum(c.ganadas)} ganadas de ${fmtNum(c.cerradas)} cerradas · ${fmtNum(c.abiertas)} abiertas`}
        />
        <StatTile
          label="Costeo (mediana)"
          value={fmtDuracion(t.medianaHoras)}
          hint={`promedio ${fmtDuracion(t.promedioHoras)} · p90 ${fmtDuracion(t.p90Horas)} · n=${fmtNum(t.n)}`}
        />
      </div>

      <Seccion
        titulo="Embudo de conversión"
        nota="De las oportunidades creadas en el periodo, cuántas llegaron a cada paso. El % de la derecha es lo que se cae respecto al paso anterior."
      >
        <Embudo buckets={data.embudo} isMobile={isMobile} />
      </Seccion>

      <Seccion titulo={por === 'zona' ? 'Por zona' : 'Por vendedor'}>
        <TablaGrupos grupos={data.grupos} por={por} />
      </Seccion>

      <Seccion
        titulo="Datos por resolver"
        nota="Renglones que el tablero no puede clasificar. Mientras existan, los cortes de arriba traen un margen de error — click para abrir y corregir en la oportunidad."
      >
        <PanelHuecos huecos={data.huecos} onOpenOportunidad={onOpenOportunidad} />
      </Seccion>
    </>
  );
}
