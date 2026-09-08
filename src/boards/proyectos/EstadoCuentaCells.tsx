// Cifras del Estado de cuenta en el renglón de la lista del board "Estado de
// Cuenta" (Efraín, 2026-09-08): cobrado / por cobrar / pagado / por pagar /
// saldo por proyecto, la suma por grupo y el gran total. Misma geometría que
// TotalesCells (src/boards/oportunidades/TotalesCells.tsx) — encabezado
// sticky alineado con las celdas, celdas en su propio contenedor con gap
// fijo, hueco de 70 px de la columna "hace X" — para que las columnas caigan
// justo encima de sus números como en el Reporte de Proyectos. Si cambia la
// geometría allá, cámbiala aquí.
//
// Lo vencido (programado cuya fecha ya pasó) va en ROJO debajo del pendiente:
// es el número que se mira primero al provisionar — no "cuánto falta" sino
// "cuánto ya debería haber entrado y no entró".
import { fmtMoneyShort } from '../../lib/format';
import { RESUMEN_VACIO, sumarResumenes, type ResumenEstadoCuenta } from '../../../shared/estadoCuenta';

export type EcMetricaKey = 'cobrado' | 'porCobrar' | 'pagado' | 'porPagar' | 'saldo';

interface Metrica {
  key: EcMetricaKey;
  label: string;
  titulo: string;
  width: number;
  /** Qué cifra de vencido cuelga debajo (solo los pendientes). */
  vencido?: 'vencidoPorCobrar' | 'vencidoPorPagar';
}

export const EC_METRICAS: Metrica[] = [
  { key: 'cobrado', label: 'Cobrado', titulo: 'Cobrado — dinero que YA entró', width: 78 },
  { key: 'porCobrar', label: 'Por cobrar', titulo: 'Por cobrar — saldo de las facturas vivas; en rojo, lo vencido', width: 84, vencido: 'vencidoPorCobrar' },
  { key: 'pagado', label: 'Pagado', titulo: 'Pagado — dinero que YA salió', width: 78 },
  { key: 'porPagar', label: 'Por pagar', titulo: 'Por pagar — saldo de los compromisos vivos; en rojo, lo vencido', width: 84, vencido: 'vencidoPorPagar' },
  { key: 'saldo', label: 'Saldo', titulo: 'Saldo — cobrado menos pagado', width: 84 },
];

// En celular caben tres: lo que entró, lo que falta por cobrar y el saldo.
const MOVIL: EcMetricaKey[] = ['cobrado', 'porCobrar', 'saldo'];

const GAP_METRICAS = 10;
const GAP_RENGLON = 16;
const GROUPCARD_MARGEN = 24;
const GROUPCARD_BORDE = 1;
const PADDING_RENGLON = 18;

export function ecMetricas(isMobile: boolean): Metrica[] {
  return isMobile ? MOVIL.map(k => EC_METRICAS.find(m => m.key === k)!) : EC_METRICAS;
}

export { sumarResumenes, RESUMEN_VACIO };

function colorDe(m: Metrica, r: ResumenEstadoCuenta): string | undefined {
  if (m.key === 'cobrado' && r.cobrado > 0) return 'var(--status-ganada)';
  if (m.key === 'pagado' && r.pagado > 0) return 'var(--status-perdida)';
  if (m.key === 'saldo' && r.saldo < 0) return 'var(--status-perdida)';
  return undefined;
}

export function EstadoCuentaHeader({ metricas, isMobile }: { metricas: Metrica[]; isMobile: boolean }) {
  if (isMobile) return null;
  return (
    <div
      style={{
        position: 'sticky', top: 0, zIndex: 3,
        display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
        gap: GAP_RENGLON,
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
            style={{ width: m.width, textAlign: 'right', font: 'var(--text-caption)', color: 'var(--ink-quiet)', letterSpacing: '.02em' }}
          >
            {m.label}
          </div>
        ))}
      </div>
      <div style={{ width: 70, flex: 'none' }} />
    </div>
  );
}

/** Sin estado de cuenta capturado va un guion, no un $0: "no hay factura" y
 * "ya se cobró todo" son cosas distintas. */
export function EstadoCuentaCells({ resumen, metricas, strong = false }: {
  resumen: ResumenEstadoCuenta | undefined; metricas: Metrica[]; strong?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: GAP_METRICAS, flex: 'none' }}>
      {metricas.map(m => {
        const vacio = !resumen;
        const valor = resumen ? resumen[m.key] : 0;
        const vencido = resumen && m.vencido ? resumen[m.vencido] : 0;
        const color = resumen ? colorDe(m, resumen) : undefined;
        return (
          <div
            key={m.key}
            title={resumen ? `${m.titulo}: ${valor.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}` : m.titulo}
            style={{
              width: m.width, flex: 'none', textAlign: 'right',
              font: 'var(--text-label)', fontVariantNumeric: 'tabular-nums',
              color: vacio ? 'var(--ink-faint)' : color ?? (strong ? 'var(--ink)' : 'var(--ink-secondary)'),
              fontWeight: strong ? 700 : color ? 600 : 400,
              whiteSpace: 'nowrap', overflow: 'hidden', lineHeight: 1.15,
            }}
          >
            {vacio ? '—' : fmtMoneyShort(valor)}
            {vencido > 0 && (
              <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)', fontWeight: 600 }} title={`Vencido: ${fmtMoneyShort(vencido)}`}>
                {fmtMoneyShort(vencido)} venc.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Versión de celular: "etiqueta valor" que se acomoda solo. */
export function EstadoCuentaChips({ resumen, metricas }: { resumen: ResumenEstadoCuenta | undefined; metricas: Metrica[] }) {
  if (!resumen) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 1 }}>
      {metricas.map(m => {
        const vencido = m.vencido ? resumen[m.vencido] : 0;
        const color = colorDe(m, resumen);
        return (
          <div key={m.key} style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            <span style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>{m.label}</span>
            <span style={{ font: 'var(--text-label)', fontVariantNumeric: 'tabular-nums', color: color ?? 'var(--ink-secondary)', fontWeight: color ? 600 : 400 }}>
              {fmtMoneyShort(resumen[m.key])}
            </span>
            {vencido > 0 && <span style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)', fontWeight: 600 }}>({fmtMoneyShort(vencido)} venc.)</span>}
          </div>
        );
      })}
    </div>
  );
}

/** `resumen` undefined = ningún proyecto del grupo tiene movimientos: se
 * pintan guiones, no ceros (mismo criterio que el renglón). */
export function EstadoCuentaGrupo({ resumen, metricas, isMobile }: { resumen: ResumenEstadoCuenta | undefined; metricas: Metrica[]; isMobile: boolean }) {
  if (isMobile) {
    if (!resumen) return null;
    return (
      <div style={{ marginLeft: 'auto', minWidth: 0 }}>
        <EstadoCuentaChips resumen={resumen} metricas={metricas} />
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: GAP_RENGLON, marginLeft: 'auto', flex: 'none' }}>
      <EstadoCuentaCells resumen={resumen} metricas={metricas} strong />
      <div style={{ width: 70, flex: 'none' }} />
    </div>
  );
}

export function EstadoCuentaGranTotal({ resumen, metricas, isMobile }: { resumen: ResumenEstadoCuenta; metricas: Metrica[]; isMobile: boolean }) {
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
      <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)', letterSpacing: '.02em' }}>TOTAL</div>
      {isMobile ? (
        <div style={{ marginLeft: 'auto', minWidth: 0 }}>
          <EstadoCuentaChips resumen={resumen} metricas={metricas} />
        </div>
      ) : (
        <>
          <div style={{ marginLeft: 'auto' }} />
          <EstadoCuentaCells resumen={resumen} metricas={metricas} strong />
          <div style={{ width: 70, flex: 'none' }} />
        </>
      )}
    </div>
  );
}
