// Una solicitud de muestras: encabezado (folio, estado, quién la pidió, fechas)
// y sus renglones. La usan el tab del drawer (tarjeta completa) y la lista
// "Solicitudes de muestra" (LineasMuestra al desplegar el renglón).
import { useState } from 'react';
import { StatusBadge, MonoTag } from '../../components/core/Badges';
import { ActionMenu } from '../../components/core/ActionMenu';
import { useIsMobile } from '../../lib/useIsMobile';
import { borrarMuestra, cambiarEstadoMuestra } from '../../lib/muestrasApi';
import { MuestraModal } from './MuestraModal';
import {
  MUESTRA_ESTADOS, MUESTRA_ESTADO_LABEL, retornoVencido,
  type MuestraEstado, type MuestraSolicitudDTO,
} from '../../../shared/muestras';

export const ESTADO_COLOR: Record<MuestraEstado, { color: string; tint: string }> = {
  solicitada: { color: 'var(--status-esperando)', tint: 'var(--status-esperando-tint)' },
  entregada: { color: 'var(--status-en-coste)', tint: 'var(--status-en-coste-tint)' },
  devuelta: { color: 'var(--status-ganada)', tint: 'var(--status-ganada-tint)' },
  cancelada: { color: 'var(--status-cancelada)', tint: 'var(--status-cancelada-tint)' },
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

/** Estado: select para quien puede escribir, chip para el resto. */
export function EstadoMuestra({ s, onChanged }: { s: MuestraSolicitudDTO; onChanged: () => void }) {
  const [valor, setValor] = useState<MuestraEstado>(s.estado);
  const [guardando, setGuardando] = useState(false);
  const c = ESTADO_COLOR[valor];
  if (!s.editable) return <StatusBadge label={MUESTRA_ESTADO_LABEL[valor]} color={c.color} tint={c.tint} />;
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
      {MUESTRA_ESTADOS.map(e => <option key={e} value={e}>{MUESTRA_ESTADO_LABEL[e]}</option>)}
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
  const piezas = s.lineas.reduce((n, l) => n + l.cantidad, 0);

  const borrar = async () => {
    const res = await borrarMuestra(s.id);
    if (!res.ok) { window.alert(res.error ?? 'No se pudo borrar.'); return; }
    onChanged();
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', background: 'var(--bg-sunken)', borderBottom: '1px solid var(--border)' }}>
        <MonoTag style={{ padding: 0 }}>{s.folio}</MonoTag>
        <EstadoMuestra key={s.estado} s={s} onChanged={onChanged} />
        <span style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>
          {s.lineas.length} {s.lineas.length === 1 ? 'producto' : 'productos'} · {piezas} {piezas === 1 ? 'pieza' : 'piezas'}
        </span>
        <span style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}><FechasMuestra s={s} /></span>
        <span style={{ marginLeft: 'auto', font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
          Pidió {s.solicitante} · {fmtFecha(s.createdAt)}
        </span>
        {s.editable && (
          <ActionMenu
            items={[
              { key: 'editar', label: 'Editar', onSelect: () => setEditando(true) },
              { key: 'borrar', label: 'Borrar solicitud', danger: true, confirmLabel: `Sí, borrar ${s.folio}`, onSelect: borrar },
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
