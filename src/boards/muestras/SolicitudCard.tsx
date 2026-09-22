// Una solicitud de muestras: encabezado (folio, estado, quién la pidió, fechas)
// y sus renglones. La usan el tab del drawer (tarjeta completa) y la lista
// "Solicitudes de muestra" (LineasMuestra al desplegar el renglón).
import { useState } from 'react';
import { StatusBadge, MonoTag } from '../../components/core/Badges';
import { ActionMenu } from '../../components/core/ActionMenu';
import { Button } from '../../components/core/Button';
import { useIsMobile } from '../../lib/useIsMobile';
import { borrarMuestra, cambiarEstadoMuestra, enviarMuestra, nuevaVersionMuestra } from '../../lib/muestrasApi';
import { MuestraModal } from './MuestraModal';
import {
  MUESTRA_ESTADOS_GESTION, MUESTRA_ESTADO_LABEL, muestraEtiqueta, retornoVencido,
  type MuestraEstado, type MuestraSolicitudDTO,
} from '../../../shared/muestras';

export const ESTADO_COLOR: Record<MuestraEstado, { color: string; tint: string }> = {
  borrador: { color: 'var(--status-cancelada)', tint: 'var(--status-cancelada-tint)' },
  enviada: { color: 'var(--status-esperando)', tint: 'var(--status-esperando-tint)' },
  validada: { color: 'var(--status-confirmado)', tint: 'var(--status-confirmado-tint)' },
  entregada: { color: 'var(--status-ganada)', tint: 'var(--status-ganada-tint)' },
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** aaaa-mm-dd → "14 sep 26", a mano (Date recorre un día en México). */
export function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)} ${MESES[Number(m) - 1] ?? m} ${a.slice(2)}`;
}

export const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Estado: select para Compras/admin (solo en el board, `gestionar`), chip
 * para el resto y en el tab del drawer. */
export function EstadoMuestra({ s, onChanged, gestionar = false }: { s: MuestraSolicitudDTO; onChanged: () => void; gestionar?: boolean }) {
  const [valor, setValor] = useState<MuestraEstado>(s.estado);
  const [guardando, setGuardando] = useState(false);
  const c = ESTADO_COLOR[valor];
  if (!gestionar || !s.gestionable) return <StatusBadge label={MUESTRA_ESTADO_LABEL[valor]} color={c.color} tint={c.tint} />;
  return (
    <select
      aria-label="Estado de la solicitud"
      value={valor}
      disabled={guardando}
      onClick={(e) => e.stopPropagation()}
      onChange={async (e) => {
        const nuevo = e.target.value as MuestraEstado;
        const previo = valor;
        setValor(nuevo); // optimista
        setGuardando(true);
        const res = await cambiarEstadoMuestra(s.id, nuevo);
        setGuardando(false);
        if (!res.ok) { setValor(previo); window.alert(res.error ?? 'No se pudo cambiar el estado.'); return; }
        onChanged();
      }}
      style={{
        font: 'var(--text-chip)', color: c.color, background: c.tint, border: 'none', cursor: 'pointer',
        padding: '4px 8px', borderRadius: 'var(--radius-pill)', opacity: guardando ? .6 : 1, maxWidth: '100%',
      }}
    >
      {MUESTRA_ESTADOS_GESTION.map(e => <option key={e} value={e}>{MUESTRA_ESTADO_LABEL[e]}</option>)}
    </select>
  );
}

const GRID = '28px 2.2fr 1fr 0.8fr 56px 2fr';

export function LineasMuestra({ s }: { s: MuestraSolicitudDTO }) {
  const isMobile = useIsMobile();
  const num = { textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' };
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {s.lineas.map((l, i) => (
          <div key={l.id} style={{ padding: '8px 0', borderTop: i ? '1px solid var(--border-subtle)' : undefined, font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>
            <div style={{ color: 'var(--ink)' }}>{l.cantidad} × {l.producto}</div>
            <div>{[l.sku, l.marca, l.color, l.talla && `Talla ${l.talla}`].filter(Boolean).join(' · ')}</div>
            {l.comentarios && <div style={{ color: 'var(--ink-tertiary)' }}>{l.comentarios}</div>}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 10, color: 'var(--ink-tertiary)', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
        <div>#</div><div>Producto</div><div>Color</div><div>Talla</div><div style={num}>Cant.</div><div>Comentarios</div>
      </div>
      {s.lineas.map((l, i) => (
        <div key={l.id} style={{ display: 'grid', gridTemplateColumns: GRID, gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', alignItems: 'start' }}>
          <div style={{ color: 'var(--ink-tertiary)' }}>{i + 1}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--ink)' }}>{l.producto}</div>
            {(l.sku || l.marca) && <div style={{ color: 'var(--ink-tertiary)' }}>{[l.sku, l.marca].filter(Boolean).join(' · ')}</div>}
          </div>
          <div>{l.color || '—'}</div>
          <div>{l.talla || '—'}</div>
          <div style={{ ...num, color: 'var(--ink)' }}>{l.cantidad}</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{l.comentarios || '—'}</div>
        </div>
      ))}
    </div>
  );
}

/** "Entrega 14 sep 26 · regresa 21 sep 26 (7 días)", con el retorno vencido en rojo. */
export function FechasMuestra({ s }: { s: MuestraSolicitudDTO }) {
  const vencido = retornoVencido(s, hoyISO());
  if (!s.fechaEntrega && s.diasRetorno == null) return <span style={{ color: 'var(--ink-quiet)' }}>Sin fecha de entrega</span>;
  return (
    <span>
      Entrega {fmtFecha(s.fechaEntrega)}
      {s.fechaRetorno && (
        <span style={vencido ? { color: 'var(--status-perdida)', fontWeight: 600 } : undefined} title={vencido ? 'Ya pasó la fecha de retorno y sigue con el cliente' : undefined}>
          {' '}· regresa {fmtFecha(s.fechaRetorno)}{vencido ? ' (vencida)' : ''}
        </span>
      )}
      {s.diasRetorno != null && !s.fechaRetorno && ` · retorno ${s.diasRetorno} días`}
    </span>
  );
}

export function SolicitudCard({ s, onChanged }: { s: MuestraSolicitudDTO; onChanged: () => void }) {
  const [editando, setEditando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const piezas = s.lineas.reduce((n, l) => n + l.cantidad, 0);

  const enviar = async () => {
    if (!window.confirm(`¿Enviar ${muestraEtiqueta(s)} a Compras?\n\nSe publica en Actualizaciones y a Compras le llega un aviso por WhatsApp. Ya enviada no se puede editar.`)) return;
    setEnviando(true);
    const res = await enviarMuestra(s.id);
    setEnviando(false);
    if (!res.ok) { window.alert(res.error ?? 'No se pudo enviar.'); return; }
    onChanged();
  };

  const borrar = async () => {
    const res = await borrarMuestra(s.id);
    if (!res.ok) { window.alert(res.error ?? 'No se pudo borrar.'); return; }
    onChanged();
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', background: 'var(--bg-sunken)', borderBottom: '1px solid var(--border)' }}>
        <MonoTag style={{ padding: 0 }}>{muestraEtiqueta(s)}</MonoTag>
        <EstadoMuestra key={s.estado} s={s} onChanged={onChanged} />
        <span style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>
          {s.lineas.length} {s.lineas.length === 1 ? 'producto' : 'productos'} · {piezas} {piezas === 1 ? 'pieza' : 'piezas'}
        </span>
        <span style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}><FechasMuestra s={s} /></span>
        <span style={{ marginLeft: 'auto', font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
          {s.enviadaAt ? `Enviada por ${s.solicitante} · ${fmtFecha(s.enviadaAt)}` : `Borrador de ${s.solicitante} · ${fmtFecha(s.createdAt)}`}
        </span>
        {s.editable && (
          <Button variant="primary" onClick={enviando ? undefined : enviar} style={enviando ? { opacity: .6 } : undefined}>
            {enviando ? 'Enviando…' : 'Enviar a Compras'}
          </Button>
        )}
        {s.editable && (
          <ActionMenu
            items={[
              { key: 'editar', label: 'Editar', onSelect: () => setEditando(true) },
              { key: 'borrar', label: 'Borrar solicitud', danger: true, confirmLabel: `Sí, borrar ${muestraEtiqueta(s)}`, onSelect: borrar },
            ]}
          />
        )}
      </div>
      <div style={{ padding: '8px 14px 12px' }}>
        {s.notas && <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', marginBottom: 8, whiteSpace: 'pre-wrap' }}>{s.notas}</div>}
        <LineasMuestra s={s} />
      </div>
      {editando && <MuestraModal padre={s.padre} itemId={s.itemId} solicitud={s} onClose={() => setEditando(false)} onSaved={onChanged} />}
    </div>
  );
}

/** Una solicitud con todas sus versiones, como la cotización: chips V1/V2…
 * (la más nueva resaltada), las anteriores en solo lectura, y "+ Nueva
 * versión" junto a la última cuando ya se envió — duplica TAL CUAL en borrador
 * para editarla y volverla a enviar (Efraín, 2026-09-22). */
export function SolicitudGrupo({ versiones, readOnly, onChanged }: {
  versiones: MuestraSolicitudDTO[]; readOnly: boolean; onChanged: () => void;
}) {
  const orden = [...versiones].sort((a, b) => a.version - b.version);
  const ultima = orden[orden.length - 1];
  const [elegida, setElegida] = useState<string | null>(null); // null = la última
  const [creando, setCreando] = useState(false);
  const vista = orden.find(v => v.id === elegida) ?? ultima;
  const bloquear = (v: MuestraSolicitudDTO): MuestraSolicitudDTO =>
    (readOnly ? { ...v, editable: false, puedeNuevaVersion: false } : v);
  const puedeNueva = !readOnly && ultima.puedeNuevaVersion;

  const nuevaVersion = async () => {
    if (!window.confirm(`¿Crear V${ultima.version + 1} de ${ultima.folio}?\n\nSe copia tal cual ${muestraEtiqueta(ultima)} como borrador para que la edites y la vuelvas a enviar. La anterior queda archivada.`)) return;
    setCreando(true);
    const res = await nuevaVersionMuestra(ultima.id);
    setCreando(false);
    if (!res.ok) { window.alert(res.error ?? 'No se pudo crear la versión.'); return; }
    setElegida(null);
    onChanged();
  };

  const chip = (activa: boolean): React.CSSProperties => ({
    cursor: 'pointer', font: 'var(--text-label-strong)', padding: '4px 12px', borderRadius: 'var(--radius-pill)',
    background: activa ? 'var(--ink)' : 'var(--bg-sunken)', color: activa ? '#fff' : 'var(--ink-secondary)',
  });

  return (
    <div>
      {(orden.length > 1 || puedeNueva) && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {orden.map(v => (
            <div
              key={v.id}
              onClick={() => setElegida(v.id === ultima.id ? null : v.id)}
              title={v.id === ultima.id ? 'La más nueva' : `Archivada — ${MUESTRA_ESTADO_LABEL[v.estado]}`}
              style={chip(v.id === vista.id)}
            >
              V{v.version}{v.id === ultima.id ? ' · vigente' : ''}
            </div>
          ))}
          {puedeNueva && (
            <div
              onClick={creando ? undefined : nuevaVersion}
              title="Duplica la solicitud como una nueva versión editable — la anterior queda archivada"
              style={{
                cursor: 'pointer', font: 'var(--text-label-strong)', padding: '4px 12px', borderRadius: 'var(--radius-pill)',
                border: '1px dashed var(--border)', color: 'var(--accent)', background: 'transparent', opacity: creando ? .6 : 1,
              }}
            >
              {creando ? 'Creando…' : '+ Nueva versión'}
            </div>
          )}
        </div>
      )}
      {vista.id !== ultima.id && (
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 6 }}>
          Versión archivada — la vigente es V{ultima.version}.
        </div>
      )}
      <SolicitudCard key={vista.id} s={bloquear(vista)} onChanged={onChanged} />
    </div>
  );
}
