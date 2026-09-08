// Tab "Estado de cuenta" del Proyecto (board "Estado de Cuenta", Efraín
// 2026-09-08 — portado de janing-portal). CONCEPTOS (la factura, el
// compromiso) con sus COBROS/PAGOS, que llegan en partes y cada uno con SU
// fecha: uno con fecha ya entró; sin ella está programado para su fecha
// estimada. Eso es lo que hace posible la gráfica de arriba — cuánto entra y
// cuánto sale cada mes.
//
// La factura del concepto y el comprobante de cada cobro se suben aquí mismo
// (R2 vía el worker, un archivo por renglón) y se abren en el visor del
// portal (FilePreviewModal). Todo es nativo en D1: nada toca Monday.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EstadoCuentaAbonoDTO, EstadoCuentaConceptoDTO, EstadoCuentaTipo } from '../../../shared/dto';
import {
  addAbono, addEstadoCuenta, archivoAbonoUrl, archivoConceptoUrl, downloadBlob, estadoCuentaPdf, estadoCuentaXlsx,
  getEstadoCuenta, removeAbono, removeEstadoCuenta, subirComprobante, subirFactura, updateAbono,
} from '../../lib/estadoCuentaApi';
import { FilePreviewModal } from '../../components/core/FilePreviewModal';
import { Button } from '../../components/core/Button';
import { StatusBadge } from '../../components/core/Badges';
import { fmtMoney2 } from '../../lib/format';
import { useIsMobile } from '../../lib/useIsMobile';
import {
  ESTADO_LABEL, abonoVencido, diasParaPago, etiquetaMes, flujoPorMes, hoyISO,
  resumenConcepto, resumenEstadoCuenta, type EstadoConcepto, type MesFlujo,
} from '../../../shared/estadoCuenta';

interface Props {
  proyectoId: string;
  /** Quien ve el board captura (la whitelist es la misma para leer y para
   * escribir); false = solo lectura, p.ej. mientras /me no ha resuelto. */
  editable: boolean;
}

const TIPO_LABEL: Record<EstadoCuentaTipo, string> = { ingreso: 'Ingreso', egreso: 'Egreso' };
const TIPO_COLOR: Record<EstadoCuentaTipo, string> = { ingreso: 'var(--status-ganada)', egreso: 'var(--status-perdida)' };
const TIPO_TINT: Record<EstadoCuentaTipo, string> = { ingreso: 'var(--status-ganada-tint)', egreso: 'var(--status-perdida-tint)' };

const ESTADO_COLOR: Record<EstadoConcepto, { color: string; tint: string }> = {
  pendiente: { color: 'var(--status-esperando)', tint: 'var(--status-esperando-tint)' },
  parcial: { color: 'var(--status-esperando)', tint: 'var(--status-esperando-tint)' },
  liquidado: { color: 'var(--status-ganada)', tint: 'var(--status-ganada-tint)' },
  sobrepago: { color: 'var(--status-perdida)', tint: 'var(--status-perdida-tint)' },
};

// Serie de la gráfica. NO son los colores de los chips: ese par tiene ΔE 1.5
// en visión deuterana — dos barras del mismo color para quien no distingue
// rojo de verde. Este par está re-escalonado dentro de las mismas familias y
// pasa las validaciones de contraste y CVD (decisión tomada en janing). Aun
// así la identidad nunca va sola en el color: hay leyenda, posición fija
// (ingreso a la izquierda) y etiqueta al pasar el cursor.
const SERIE = { ingreso: '#6b9a5b', egreso: '#8f3f30' } as const;
/** Lo estimado se raya sobre el mismo color: la identidad la da el color, el
 * "todavía no pasa" la textura. */
const rayado = (color: string) =>
  `repeating-linear-gradient(135deg, ${color} 0 4px, rgba(255,255,255,.55) 4px 7px)`;

const campoStyle = {
  width: '100%', font: 'var(--text-body)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '8px 10px', boxSizing: 'border-box' as const, background: '#fff',
};
const etiquetaStyle = { font: 'var(--text-micro)', color: 'var(--ink-quiet)', marginBottom: 4 } as const;
const quitarStyle = { cursor: 'pointer', color: 'var(--status-perdida)', font: 'var(--text-caption)' } as const;

function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "vencido hace 6 días" / "en 12 días" — el texto que de verdad se busca al
 * revisar qué cobrar hoy. */
function textoPlazo(fechaEstimada: string | null): { texto: string; vencido: boolean } | null {
  const dias = diasParaPago(fechaEstimada);
  if (dias === null) return null;
  const abs = Math.abs(dias);
  const plural = abs === 1 ? 'día' : 'días';
  if (dias < 0) return { texto: `vencido hace ${abs} ${plural}`, vencido: true };
  if (dias === 0) return { texto: 'es hoy', vencido: false };
  return { texto: `en ${dias} ${plural}`, vencido: false };
}

export function EstadoCuentaTab({ proyectoId, editable }: Props) {
  const isMobile = useIsMobile();
  const [conceptos, setConceptos] = useState<EstadoCuentaConceptoDTO[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [bajando, setBajando] = useState<'pdf' | 'xlsx' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    getEstadoCuenta(proyectoId).then(setConceptos).catch(() => setError('No se pudo cargar el estado de cuenta.'));
  }, [proyectoId]);

  useEffect(() => { setConceptos(null); reload(); }, [reload]);

  async function onRemove(conceptoId: string) {
    if (!window.confirm('¿Quitar este concepto y todos sus cobros?')) return;
    const res = await removeEstadoCuenta(proyectoId, conceptoId);
    if (res.ok) reload(); else setError(res.error ?? 'No se pudo quitar.');
  }

  const exportar = async (formato: 'pdf' | 'xlsx') => {
    setBajando(formato);
    setError(null);
    try {
      const blob = formato === 'pdf' ? await estadoCuentaPdf(proyectoId) : await estadoCuentaXlsx(proyectoId);
      // El nombre real lo manda el worker en Content-Disposition; este es el
      // que ve quien descarga desde memoria.
      downloadBlob(blob, `Estado-de-cuenta.${formato}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo exportar.');
    } finally {
      setBajando(null);
    }
  };

  const res = useMemo(() => resumenEstadoCuenta((conceptos ?? []).map(c => ({
    tipo: c.tipo, total: c.total, abonado: c.abonado, saldo: c.saldo, programado: c.programado, vencido: c.vencido,
  }))), [conceptos]);

  const meses = useMemo(() => flujoPorMes((conceptos ?? []).flatMap(c => c.abonos.map(a => ({
    tipo: c.tipo, monto: a.monto, fecha: a.fecha, fechaEstimada: a.fechaEstimada,
  })))), [conceptos]);

  // Pendientes primero y por próximo cobro ascendente: lo más vencido arriba.
  // Los que no tienen ni un cobro programado van al final de su grupo (no se
  // pueden provisionar, pero tampoco deben esconder a los que sí).
  const { pendientes, liquidados } = useMemo(() => {
    const lista = conceptos ?? [];
    const pend = lista.filter(c => !c.liquidado).sort((a, b) => {
      if (!a.proximaFecha) return b.proximaFecha ? 1 : 0;
      if (!b.proximaFecha) return -1;
      return a.proximaFecha.localeCompare(b.proximaFecha);
    });
    return { pendientes: pend, liquidados: lista.filter(c => c.liquidado) };
  }, [conceptos]);

  const hayAlgo = (conceptos ?? []).length > 0;

  return (
    <div style={{ padding: isMobile ? '16px 14px 40px' : '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
      {hayAlgo && (
        <>
          <FlujoMensual meses={meses} isMobile={isMobile} />

          <div style={{ display: 'flex', gap: isMobile ? 12 : 22, flexWrap: 'wrap', marginBottom: 14 }}>
            <Cifra label="Cobrado" value={res.cobrado} color="var(--status-ganada)" />
            <Cifra label="Por cobrar" value={res.porCobrar} color="var(--ink)" alerta={res.vencidoPorCobrar} alertaLabel="vencido" />
            <Cifra label="Pagado" value={res.pagado} color="var(--status-perdida)" />
            <Cifra label="Por pagar" value={res.porPagar} color="var(--ink)" alerta={res.vencidoPorPagar} alertaLabel="vencido" />
            <Cifra label="Saldo" value={res.saldo} color="var(--ink)" />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
            <Button variant={bajando ? 'disabled' : 'secondary'} onClick={() => exportar('pdf')}>
              {bajando === 'pdf' ? 'Generando…' : 'Exportar PDF'}
            </Button>
            <Button variant={bajando ? 'disabled' : 'secondary'} onClick={() => exportar('xlsx')}>
              {bajando === 'xlsx' ? 'Generando…' : 'Exportar Excel'}
            </Button>
          </div>
        </>
      )}
      {error && <div style={{ font: 'var(--text-label)', color: 'var(--status-perdida)', marginBottom: 12 }}>{error}</div>}

      {conceptos === null && !error ? (
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Cargando…</div>
      ) : conceptos !== null && !hayAlgo ? (
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)', maxWidth: 560 }}>
          Sin movimientos todavía. Captura la primera factura (ingreso) o el primer compromiso con un
          proveedor (egreso) con «+ Agregar concepto»; los cobros y pagos se van colgando de cada uno.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pendientes.length > 0 && <Encabezado texto={`Pendientes (${pendientes.length})`} />}
          {pendientes.map(c => (
            <ConceptoCard key={c.id} concepto={c} editable={editable} proyectoId={proyectoId} onRemove={() => onRemove(c.id)} onSaved={reload} />
          ))}
          {liquidados.length > 0 && <Encabezado texto={`Liquidados (${liquidados.length})`} />}
          {liquidados.map(c => (
            <ConceptoCard key={c.id} concepto={c} editable={editable} proyectoId={proyectoId} onRemove={() => onRemove(c.id)} onSaved={reload} />
          ))}
        </div>
      )}

      {editable && conceptos !== null && (
        <div style={{ marginTop: 14 }}>
          {showAdd ? (
            <AddConceptoForm proyectoId={proyectoId} onCancel={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); reload(); }} />
          ) : (
            <Button variant="primary" onClick={() => setShowAdd(true)}>+ Agregar concepto</Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Gráfica de flujo mensual ────────────────────────────────────────────────
// Dos barras por mes, ingresos y egresos. Un cobro cae en el mes de su fecha
// real si ya entró y en el de su fecha estimada si está programado, así que la
// misma gráfica es historia a la izquierda y provisión a la derecha; lo que
// todavía no pasa va rayado.

const ALTO_GRAFICA = 104;

function FlujoMensual({ meses, isMobile }: { meses: MesFlujo[]; isMobile: boolean }) {
  const [hover, setHover] = useState<{ mes: string; serie: 'ingreso' | 'egreso' } | null>(null);
  if (meses.length === 0) return null;

  const maximo = Math.max(...meses.map(m => Math.max(m.ingreso, m.egreso)), 1);
  const anchoBarra = isMobile ? 12 : (meses.length <= 8 ? 26 : 16);
  const anchoMes = anchoBarra * 2 + (isMobile ? 12 : 20);
  const activo = hover ? meses.find(m => m.mes === hover.mes) : null;

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ font: 'var(--text-micro)', color: 'var(--ink-quiet)', textTransform: 'uppercase', letterSpacing: '.4px' }}>
          Flujo por mes
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
          <Leyenda color={SERIE.ingreso} texto="Ingresos" />
          <Leyenda color={SERIE.egreso} texto="Egresos" />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 18, height: 10, borderRadius: 2, background: rayado('#8a8275'), display: 'inline-block' }} />
            estimado
          </span>
        </div>
      </div>

      <div style={{ position: 'relative', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: '#fff', padding: '12px 14px 8px' }}>
        {/* Solo el tope como escala: con dos series y etiquetas al pasar el
            cursor, una rejilla completa sería ruido. */}
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)', textAlign: 'right', marginBottom: 2 }}>
          {fmtMoney2(maximo)}
        </div>
        <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0, minWidth: 'min-content', width: '100%' }}>
            {meses.map(m => (
              <div
                key={m.mes}
                style={{ minWidth: anchoMes, flex: '1 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                onMouseLeave={() => setHover(h => (h?.mes === m.mes ? null : h))}
              >
                <div style={{ height: ALTO_GRAFICA, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
                  <Barra
                    total={m.ingreso} estimado={m.ingresoEstimado} maximo={maximo} ancho={anchoBarra}
                    color={SERIE.ingreso} atenuada={Boolean(hover) && !(hover?.mes === m.mes && hover.serie === 'ingreso')}
                    onHover={() => setHover({ mes: m.mes, serie: 'ingreso' })}
                  />
                  <Barra
                    total={m.egreso} estimado={m.egresoEstimado} maximo={maximo} ancho={anchoBarra}
                    color={SERIE.egreso} atenuada={Boolean(hover) && !(hover?.mes === m.mes && hover.serie === 'egreso')}
                    onHover={() => setHover({ mes: m.mes, serie: 'egreso' })}
                  />
                </div>
                <div style={{
                  font: 'var(--text-caption)', color: hover?.mes === m.mes ? 'var(--ink)' : 'var(--ink-quiet)',
                  marginTop: 6, whiteSpace: 'nowrap',
                }}>
                  {etiquetaMes(m.mes)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detalle del mes señalado: qué parte ya es un hecho y qué se estima. */}
        <div style={{ minHeight: 20, marginTop: 6, font: 'var(--text-caption)', color: 'var(--ink-secondary)' }}>
          {activo && hover ? (
            <span>
              <b>{etiquetaMes(activo.mes)}</b> · {hover.serie === 'ingreso' ? 'Ingresos' : 'Egresos'}{' '}
              {fmtMoney2(hover.serie === 'ingreso' ? activo.ingreso : activo.egreso)}
              {' — '}
              {fmtMoney2(hover.serie === 'ingreso' ? activo.ingresoReal : activo.egresoReal)} ya se movió,{' '}
              {fmtMoney2(hover.serie === 'ingreso' ? activo.ingresoEstimado : activo.egresoEstimado)} estimado
            </span>
          ) : (
            <span style={{ color: 'var(--ink-faint)' }}>Pasa el cursor por una barra para ver el detalle del mes.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
      {texto}
    </span>
  );
}

function Barra({ total, estimado, maximo, ancho, color, atenuada, onHover }: {
  total: number; estimado: number; maximo: number; ancho: number; color: string; atenuada: boolean; onHover: () => void;
}) {
  // Un mes en cero se dibuja como un tope de 2px: "aquí no hay nada" es un
  // dato, y sin él la columna se ve rota.
  const alto = total > 0 ? Math.max(3, (total / maximo) * ALTO_GRAFICA) : 2;
  const altoEstimado = total > 0 ? Math.min(alto, (estimado / maximo) * ALTO_GRAFICA) : 0;
  return (
    <div
      onMouseEnter={onHover}
      style={{
        width: ancho, height: alto, background: total > 0 ? color : 'var(--border)',
        borderRadius: '4px 4px 0 0', overflow: 'hidden',
        opacity: atenuada ? 0.45 : 1, transition: 'opacity .12s',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {altoEstimado > 0 && (
        <div style={{
          height: altoEstimado, background: rayado(color),
          // 2px de superficie entre los dos tramos, para que se lean como dos.
          borderBottom: altoEstimado < alto ? '2px solid #fff' : undefined,
          boxSizing: 'border-box',
        }} />
      )}
    </div>
  );
}

function Encabezado({ texto }: { texto: string }) {
  return (
    <div style={{ font: 'var(--text-micro)', color: 'var(--ink-quiet)', textTransform: 'uppercase', letterSpacing: '.4px', marginTop: 6 }}>
      {texto}
    </div>
  );
}

function Cifra({ label, value, color, alerta, alertaLabel }: {
  label: string; value: number; color: string; alerta?: number; alertaLabel?: string;
}) {
  return (
    <div>
      <div style={{ font: 'var(--text-micro)', color: 'var(--ink-quiet)', textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
      <div style={{ font: 'var(--text-subtitle)', color, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney2(value)}</div>
      {alerta !== undefined && alerta > 0 && (
        <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>{fmtMoney2(alerta)} {alertaLabel}</div>
      )}
    </div>
  );
}

/** Barra de avance del concepto: la lectura de un vistazo de "cuánto va". */
function BarraAvance({ avance, color }: { avance: number; color: string }) {
  return (
    <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--bg-sunken)', overflow: 'hidden', flex: '1 1 120px', minWidth: 90 }}>
      <div style={{ width: `${Math.round(avance * 100)}%`, height: '100%', background: color, borderRadius: 'var(--radius-pill)' }} />
    </div>
  );
}

/** Botón "Ver factura" / "Ver comprobante" que abre el visor del portal. */
function VerArchivo({ url, nombre, etiqueta }: { url: string; nombre: string; etiqueta: string }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Button variant="ghost" onClick={() => setAbierto(true)} title={nombre}>{etiqueta}</Button>
      {abierto && <FilePreviewModal url={url} name={nombre} onClose={() => setAbierto(false)} />}
    </>
  );
}

function ConceptoCard({ concepto, editable, proyectoId, onRemove, onSaved }: {
  concepto: EstadoCuentaConceptoDTO; editable: boolean; proyectoId: string; onRemove: () => void; onSaved: () => void;
}) {
  const [showAbono, setShowAbono] = useState(false);
  const { abonado, saldo, avance, estado, programado, sinProgramar } = resumenConcepto(concepto.total, concepto.abonos);
  const plazo = textoPlazo(concepto.proximaFecha);
  const colorTipo = TIPO_COLOR[concepto.tipo];
  const esIngreso = concepto.tipo === 'ingreso';
  const estadoUi = ESTADO_COLOR[estado];

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '12px 14px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
          <StatusBadge label={TIPO_LABEL[concepto.tipo]} color={colorTipo} tint={TIPO_TINT[concepto.tipo]} />
          <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{concepto.concepto || 'Sin concepto'}</div>
          <StatusBadge label={ESTADO_LABEL[estado]} color={estadoUi.color} tint={estadoUi.tint} />
        </div>
        {editable && <span onClick={onRemove} style={quitarStyle}>Quitar</span>}
      </div>

      {/* Cobrado de Total + barra + saldo: el renglón que contesta la pregunta. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
          {fmtMoney2(abonado)} <span style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>de {fmtMoney2(concepto.total)}</span>
        </div>
        <BarraAvance avance={avance} color={estado === 'sobrepago' ? 'var(--status-perdida)' : colorTipo} />
        <div style={{ font: 'var(--text-label)', color: saldo > 0 ? 'var(--ink-secondary)' : 'var(--ink-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
          {saldo >= 0 ? `Saldo ${fmtMoney2(saldo)}` : `Sobrepago ${fmtMoney2(-saldo)}`}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
        <span>Fecha {fmtFecha(concepto.fecha)}</span>
        {concepto.proximaFecha && (
          <>
            <span>·</span>
            <span>Próximo {esIngreso ? 'cobro' : 'pago'} {fmtFecha(concepto.proximaFecha)}</span>
            {plazo && <span style={{ color: plazo.vencido ? 'var(--status-perdida)' : 'var(--ink-tertiary)', fontWeight: plazo.vencido ? 600 : undefined }}>· {plazo.texto}</span>}
          </>
        )}
        {programado > 0 && <span>· {fmtMoney2(programado)} programado</span>}
        {concepto.archivo ? (
          <VerArchivo url={archivoConceptoUrl(proyectoId, concepto.id)} nombre={concepto.archivo.nombre} etiqueta="Ver factura" />
        ) : editable ? (
          <AdjuntarArchivo etiqueta="Adjuntar factura" onSubir={file => subirFactura(proyectoId, concepto.id, file)} onSaved={onSaved} />
        ) : null}
      </div>

      {/* Lo que falta y ni siquiera tiene fecha: no se puede provisionar, y en
          la gráfica no aparece por ningún lado. Decirlo aquí es la única
          manera de que no se pierda. */}
      {sinProgramar > 0 && (
        <div style={{ font: 'var(--text-caption)', color: 'var(--status-esperando)' }}>
          {fmtMoney2(sinProgramar)} sin fecha estimada — no entra al flujo por mes
        </div>
      )}

      {concepto.abonos.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          {concepto.abonos.map(a => (
            <AbonoRow key={a.id} abono={a} concepto={concepto} editable={editable} proyectoId={proyectoId} onSaved={onSaved} />
          ))}
        </div>
      )}

      {editable && (
        showAbono ? (
          <AddAbonoForm
            proyectoId={proyectoId}
            conceptoId={concepto.id}
            esIngreso={esIngreso}
            saldoSugerido={Math.max(0, saldo - programado) || Math.max(0, saldo)}
            onCancel={() => setShowAbono(false)}
            onAdded={() => { setShowAbono(false); onSaved(); }}
          />
        ) : (
          <div><Button variant="ghost" onClick={() => setShowAbono(true)}>+ Agregar {esIngreso ? 'cobro' : 'pago'}</Button></div>
        )
      )}
    </div>
  );
}

function AbonoRow({ abono, concepto, editable, proyectoId, onSaved }: {
  abono: EstadoCuentaAbonoDTO; concepto: EstadoCuentaConceptoDTO; editable: boolean; proyectoId: string; onSaved: () => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const recibido = Boolean(abono.fecha);
  const vencido = abonoVencido(abono);
  const esIngreso = concepto.tipo === 'ingreso';

  const quitar = async () => {
    if (!window.confirm(`¿Quitar este ${recibido ? 'movimiento' : 'programado'}?`)) return;
    const res = await removeAbono(proyectoId, concepto.id, abono.id);
    if (res.ok) onSaved();
  };

  /** Marcar un programado como ya recibido: entra con la fecha de hoy y el
   * monto que se había acordado, que es el caso normal. Si entró distinto, se
   * corrige el monto desde el renglón nuevo. */
  const marcarCobrado = async () => {
    setGuardando(true);
    try {
      const res = await updateAbono(proyectoId, concepto.id, abono.id, { fecha: hoyISO() });
      if (res.ok) onSaved();
    } finally {
      setGuardando(false);
    }
  };

  const colorProgramado = vencido ? 'var(--status-perdida)' : 'var(--status-esperando)';
  const tintProgramado = vencido ? 'var(--status-perdida-tint)' : 'var(--status-esperando-tint)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', font: 'var(--text-caption)', color: 'var(--ink-secondary)' }}>
      <span style={{ color: vencido ? 'var(--status-perdida)' : 'var(--ink-tertiary)', minWidth: 92 }}>
        {fmtFecha(abono.fecha ?? abono.fechaEstimada)}
      </span>
      <span style={{ font: 'var(--text-body-strong)', color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney2(abono.monto)}</span>
      {!recibido && (
        <StatusBadge label={vencido ? 'Programado · vencido' : 'Programado'} color={colorProgramado} tint={tintProgramado} />
      )}
      {abono.nota && <span>{abono.nota}</span>}

      {!recibido && editable && (
        <Button variant={guardando ? 'disabled' : 'secondary'} onClick={marcarCobrado}>
          {guardando ? 'Guardando…' : `Marcar ${esIngreso ? 'cobrado' : 'pagado'}`}
        </Button>
      )}

      {recibido && (abono.archivo ? (
        <VerArchivo url={archivoAbonoUrl(proyectoId, concepto.id, abono.id)} nombre={abono.archivo.nombre} etiqueta="Ver comprobante" />
      ) : editable ? (
        <AdjuntarArchivo etiqueta="Adjuntar comprobante" onSubir={file => subirComprobante(proyectoId, concepto.id, abono.id, file)} onSaved={onSaved} />
      ) : null)}

      {editable && <span onClick={quitar} style={{ ...quitarStyle, marginLeft: 'auto' }}>Quitar</span>}
    </div>
  );
}

/** Un solo clic: el input va escondido y sube en cuanto se elige el archivo
 * — con un paso extra de "Subir", la mitad de los comprobantes se quedaban
 * sin subir (aprendizaje de janing). */
function AdjuntarArchivo({ etiqueta, onSubir, onSaved }: {
  etiqueta: string;
  onSubir: (file: File) => Promise<{ ok: boolean; error?: string }>;
  onSaved: () => void;
}) {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setSubiendo(true);
    setError(null);
    try {
      const res = await onSubir(file);
      if (!res.ok) { setError(res.error ?? 'No se pudo subir el archivo.'); return; }
      onSaved();
    } catch {
      setError('No se pudo subir el archivo. Verifica tu conexión.');
    } finally {
      setSubiendo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={fileInputRef} type="file" style={{ display: 'none' }}
        accept=".pdf,.xml,.jpg,.jpeg,.png,.webp,.heic,.heif"
        onChange={e => onPick(e.target.files?.[0])}
      />
      <Button variant={subiendo ? 'disabled' : 'ghost'} onClick={() => fileInputRef.current?.click()}>
        {subiendo ? 'Subiendo…' : etiqueta}
      </Button>
      {error && <span style={{ color: 'var(--status-perdida)' }}>{error}</span>}
    </>
  );
}

function AddAbonoForm({ proyectoId, conceptoId, esIngreso, saldoSugerido, onCancel, onAdded }: {
  proyectoId: string; conceptoId: string; esIngreso: boolean; saldoSugerido: number; onCancel: () => void; onAdded: () => void;
}) {
  // Arranca en "programado": lo que más se captura es el calendario de cobros
  // acordado, y el dinero que ya entró casi siempre se marca desde su renglón.
  const [yaEntro, setYaEntro] = useState(false);
  const [monto, setMonto] = useState(saldoSugerido > 0 ? String(Math.round(saldoSugerido * 100) / 100) : '');
  const [fecha, setFecha] = useState(() => hoyISO());
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const n = Number(monto);
    if (!Number.isFinite(n) || n <= 0) { setError('Monto inválido.'); return; }
    if (!fecha) { setError('Falta la fecha.'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await addAbono(proyectoId, conceptoId, {
        monto: n,
        fecha: yaEntro ? fecha : undefined,
        fechaEstimada: yaEntro ? undefined : fecha,
        nota: nota || undefined,
      });
      if (!res.ok) { setError(res.error ?? 'No se pudo registrar.'); return; }
      onAdded();
    } catch {
      setError('No se pudo registrar. Verifica tu conexión.');
    } finally {
      setSaving(false);
    }
  };

  const verbo = esIngreso ? 'cobro' : 'pago';

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 12, background: 'var(--bg-raised)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
      <div style={{ width: 160 }}>
        <div style={etiquetaStyle}>Tipo</div>
        <select value={yaEntro ? 'real' : 'programado'} onChange={e => setYaEntro(e.target.value === 'real')} style={campoStyle}>
          <option value="programado">Programado</option>
          <option value="real">Ya se {esIngreso ? 'cobró' : 'pagó'}</option>
        </select>
      </div>
      <div style={{ width: 150 }}>
        <div style={etiquetaStyle}>Monto</div>
        <input type="number" inputMode="decimal" min="0" step="0.01" autoFocus value={monto} onChange={e => setMonto(e.target.value)} style={campoStyle} />
      </div>
      <div style={{ width: 170 }}>
        <div style={etiquetaStyle}>{yaEntro ? `Fecha del ${verbo}` : `Fecha estimada del ${verbo}`}</div>
        <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={campoStyle} />
      </div>
      <div style={{ minWidth: 170, flex: '1 1 170px' }}>
        <div style={etiquetaStyle}>Nota (referencia, banco…)</div>
        <input value={nota} onChange={e => setNota(e.target.value)} style={campoStyle} />
      </div>
      <Button variant={saving ? 'disabled' : 'primary'} onClick={submit}>{saving ? 'Guardando…' : 'Agregar'}</Button>
      <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
      {error && <div style={{ width: '100%', color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
    </div>
  );
}

function AddConceptoForm({ proyectoId, onCancel, onAdded }: { proyectoId: string; onCancel: () => void; onAdded: () => void }) {
  const [tipo, setTipo] = useState<EstadoCuentaTipo>('ingreso');
  const [total, setTotal] = useState('');
  const [fecha, setFecha] = useState(() => hoyISO());
  const [fechaEstimada, setFechaEstimada] = useState('');
  const [concepto, setConcepto] = useState('');
  const [yaPagado, setYaPagado] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const n = Number(total);
    if (!Number.isFinite(n) || n <= 0) { setError('Monto inválido.'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await addEstadoCuenta(proyectoId, {
        tipo, total: n, fecha: fecha || undefined, concepto: concepto || undefined,
        abonoInicial: yaPagado ? n : undefined,
        fechaEstimada: !yaPagado && fechaEstimada ? fechaEstimada : undefined,
      });
      if (!res.ok) { setError(res.error ?? 'No se pudo agregar.'); return; }
      onAdded();
    } catch {
      setError('No se pudo agregar. Verifica tu conexión.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14, background: 'var(--bg-raised)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
      <div style={{ width: 110 }}>
        <div style={etiquetaStyle}>Tipo</div>
        <select value={tipo} onChange={e => setTipo(e.target.value as EstadoCuentaTipo)} style={campoStyle}>
          <option value="ingreso">Ingreso</option>
          <option value="egreso">Egreso</option>
        </select>
      </div>
      <div style={{ minWidth: 220, flex: '1 1 220px' }}>
        <div style={etiquetaStyle}>Concepto (factura, estimación…)</div>
        <input autoFocus value={concepto} onChange={e => setConcepto(e.target.value)} style={campoStyle} placeholder="FACTURA 2794 // Factura 2. CENACE" />
      </div>
      <div style={{ width: 150 }}>
        <div style={etiquetaStyle}>Total</div>
        <input type="number" inputMode="decimal" min="0" step="0.01" value={total} onChange={e => setTotal(e.target.value)} style={campoStyle} />
      </div>
      <div style={{ width: 150 }}>
        <div style={etiquetaStyle}>Fecha</div>
        <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={campoStyle} />
      </div>
      {!yaPagado && (
        <div style={{ width: 170 }}>
          <div style={etiquetaStyle}>Se estima {tipo === 'ingreso' ? 'cobrar' : 'pagar'} el</div>
          <input type="date" value={fechaEstimada} onChange={e => setFechaEstimada(e.target.value)} style={campoStyle} />
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, font: 'var(--text-label)', color: 'var(--ink-secondary)', paddingBottom: 8 }}>
        <input type="checkbox" checked={yaPagado} onChange={e => setYaPagado(e.target.checked)} />
        Ya está {tipo === 'ingreso' ? 'cobrado' : 'pagado'} completo
      </label>
      <Button variant={saving ? 'disabled' : 'primary'} onClick={submit}>{saving ? 'Agregando…' : 'Agregar'}</Button>
      <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
      {error && <div style={{ width: '100%', color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
      <div style={{ width: '100%', font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
        {yaPagado
          ? 'Se registra el total como movimiento del día.'
          : 'La fecha estimada programa el total; si se cobra en partes, después se parte en varios cobros.'}
      </div>
    </div>
  );
}
