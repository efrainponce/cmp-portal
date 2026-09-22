// Board "Solicitudes de muestra" de Ventas (Efraín, 2026-09-21): las
// solicitudes de TODOS los vendedores en una lista, muy similar a la Lista de
// OC. Cada renglón lleva a su Oportunidad/Proyecto (tab Muestras) y se
// despliega para ver los productos. El recorte por renglón lo hace el server
// con el scoping del item ligado — un vendedor ve las suyas (y las de su zona).
//
// Los filtros NO se guardan entre sesiones, igual que en la Lista de OC: un
// filtro recordado deja la lista en 0 sin avisar.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { listMuestras } from '../../lib/muestrasApi';
import { SearchInput } from '../../components/forms/SearchInput';
import { MonoTag } from '../../components/core/Badges';
import { useIsMobile } from '../../lib/useIsMobile';
import { textIncludes } from '../../lib/textMatch';
import { EstadoMuestra, FechasMuestra, LineasMuestra, fmtFecha, hoyISO } from './SolicitudCard';
import {
  MUESTRA_ESTADOS, MUESTRA_ESTADO_LABEL, retornoVencido, type MuestraSolicitudDTO,
} from '../../../shared/muestras';

const TODAS = '__todas__';
const VENCIDAS = '__vencidas__';
const SIN_VENDEDOR = 'Sin vendedor';

const GRID = '16px 76px 150px 1.6fr 1fr 0.9fr 0.9fr 110px 1.3fr';

const selectStyle: React.CSSProperties = {
  height: 36, font: 'var(--text-label)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '0 10px',
  boxSizing: 'border-box', background: 'var(--bg-raised)', cursor: 'pointer', maxWidth: '100%',
};
const linkStyle: React.CSSProperties = {
  font: 'var(--text-label)', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer',
  padding: 0, textAlign: 'left', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
};

interface Props {
  onOpenItem: (s: MuestraSolicitudDTO) => void;
}

export default function MuestrasBoard({ onOpenItem }: Props) {
  const isMobile = useIsMobile();
  const [solicitudes, setSolicitudes] = useState<MuestraSolicitudDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState(TODAS);
  const [vendedor, setVendedor] = useState(TODAS);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setAbiertas(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const cargar = useCallback(async () => {
    try {
      setSolicitudes(await listMuestras());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar.');
    }
  }, []);
  useEffect(() => {
    void cargar();
    const t = window.setInterval(() => { if (!document.hidden) void cargar(); }, 60_000);
    return () => window.clearInterval(t);
  }, [cargar]);

  const hoy = hoyISO();
  const vendedores = useMemo(() => [...new Set((solicitudes ?? []).map(s => s.vendedor ?? SIN_VENDEDOR))].sort(), [solicitudes]);
  const visibles = useMemo(() => (solicitudes ?? []).filter(s =>
    (estado === TODAS || (estado === VENCIDAS ? retornoVencido(s, hoy) : s.estado === estado))
    && (vendedor === TODAS || (s.vendedor ?? SIN_VENDEDOR) === vendedor)
    && (!q.trim() || [s.folio, s.itemNombre, s.itemFolio ?? '', s.institucion ?? '', s.solicitante, ...s.lineas.map(l => `${l.producto} ${l.sku}`)]
      .some(t => textIncludes(t, q))),
  ), [solicitudes, estado, vendedor, q, hoy]);

  const hayFiltro = estado !== TODAS || vendedor !== TODAS || !!q.trim();
  const pendientes = (solicitudes ?? []).filter(s => s.estado === 'solicitada').length;
  const conCliente = (solicitudes ?? []).filter(s => s.estado === 'entregada').length;
  const vencidas = (solicitudes ?? []).filter(s => retornoVencido(s, hoy)).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: isMobile ? '14px 14px 12px' : '26px 32px 16px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <div style={{ font: 'var(--text-title)', color: 'var(--ink)' }}>Solicitudes de muestra</div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', marginTop: 2 }}>
          {solicitudes == null ? 'Cargando…'
            : `${hayFiltro ? `${visibles.length} de ${solicitudes.length}` : solicitudes.length} solicitudes · ${pendientes} por entregar · ${conCliente} con el cliente`}
          {vencidas > 0 && <span style={{ color: 'var(--status-perdida)' }}> · {vencidas} con retorno vencido</span>}
        </div>
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 4 }}>
          Se crean desde el tab «Muestras» de cada oportunidad o proyecto.
        </div>
        <div style={{ marginTop: isMobile ? 10 : 14, display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 10, flexWrap: 'wrap' }}>
          <SearchInput
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar folio, oportunidad, institución o producto…"
            style={isMobile ? { maxWidth: '100%', flexBasis: '100%' } : undefined}
          />
          <select aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)} style={selectStyle}>
            <option value={TODAS}>Estado: todos</option>
            {MUESTRA_ESTADOS.map(e => <option key={e} value={e}>{MUESTRA_ESTADO_LABEL[e]}</option>)}
            <option value={VENCIDAS}>Retorno vencido</option>
          </select>
          <select aria-label="Vendedor" value={vendedor} onChange={(e) => setVendedor(e.target.value)} style={{ ...selectStyle, maxWidth: isMobile ? '100%' : 240 }}>
            <option value={TODAS}>Vendedor: todos</option>
            {vendedores.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          {hayFiltro && (
            <button onClick={() => { setQ(''); setEstado(TODAS); setVendedor(TODAS); }} style={{ ...linkStyle, font: 'var(--text-label)' }}>
              Quitar filtros
            </button>
          )}
        </div>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: isMobile ? '4px 14px 24px' : '0 32px 24px' }}>
        {error && <div style={{ padding: '16px 0', font: 'var(--text-label)', color: 'var(--status-perdida)' }}>{error}</div>}
        {!isMobile && solicitudes != null && visibles.length > 0 && (
          <div style={{
            display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '12px 0 8px', position: 'sticky', top: 0,
            background: 'var(--bg)', borderBottom: '1px solid var(--border)', font: 'var(--text-label)', color: 'var(--ink-tertiary)', zIndex: 1,
          }}>
            <div /><div>Folio</div><div>Estado</div><div>Oportunidad / proyecto</div><div>Institución</div><div>Vendedor</div><div>Pidió</div><div>Productos</div><div>Fechas</div>
          </div>
        )}
        {solicitudes != null && visibles.length === 0 && !error && (
          <div style={{ padding: '24px 0', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
            {hayFiltro ? 'Ninguna solicitud con esos filtros.' : 'Todavía no hay solicitudes de muestra.'}
          </div>
        )}
        {visibles.map(s => (
          <Fila key={s.id} s={s} isMobile={isMobile} abierta={abiertas.has(s.id)} onAbrir={() => toggle(s.id)} onOpenItem={onOpenItem} onChanged={cargar} />
        ))}
      </div>
    </div>
  );
}

function Fila({ s, isMobile, abierta, onAbrir, onOpenItem, onChanged }: {
  s: MuestraSolicitudDTO; isMobile: boolean; abierta: boolean; onAbrir: () => void;
  onOpenItem: (s: MuestraSolicitudDTO) => void; onChanged: () => void;
}) {
  const piezas = s.lineas.reduce((n, l) => n + l.cantidad, 0);
  const chevron = (
    <button
      onClick={onAbrir} aria-expanded={abierta} aria-label={abierta ? 'Ocultar productos' : 'Ver productos'}
      style={{ background: 'none', border: 'none', padding: 0, width: 16, height: 20, cursor: 'pointer', color: 'var(--ink-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" style={{ transform: abierta ? 'rotate(90deg)' : undefined, transition: 'transform .12s' }}>
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
  const item = (
    <button onClick={() => onOpenItem(s)} title={`Abrir ${s.padre === 'oportunidades' ? 'la oportunidad' : 'el proyecto'}`} style={{ ...linkStyle, whiteSpace: isMobile ? 'normal' : 'nowrap' }}>
      <span style={{ color: 'var(--ink-tertiary)' }}>{s.padre === 'oportunidades' ? 'Opp' : 'Proy'} · </span>
      {s.itemFolio && !s.itemNombre.startsWith(s.itemFolio) ? `${s.itemFolio} · ` : ''}{s.itemNombre}
    </button>
  );
  const productos = (
    <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', whiteSpace: 'nowrap' }}>
      {s.lineas.length} · {piezas} {piezas === 1 ? 'pza' : 'pzas'}
    </div>
  );
  const caja: React.CSSProperties = {
    margin: isMobile ? '6px 0 2px' : '0 0 12px 28px', padding: isMobile ? '6px 10px' : '10px 14px',
    background: 'var(--bg-sunken)', borderRadius: 'var(--radius-lg)',
  };
  const detalle = abierta && (
    <div style={caja}>
      {s.notas && <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', marginBottom: 8, whiteSpace: 'pre-wrap' }}>{s.notas}</div>}
      <LineasMuestra s={s} />
    </div>
  );
  const texto = (v: string | null) => (
    <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v ?? undefined}>{v || '—'}</div>
  );

  if (isMobile) {
    return (
      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{chevron}<MonoTag style={{ padding: 0 }}>{s.folio}</MonoTag>{productos}</div>
          <EstadoMuestra key={s.estado} s={s} onChanged={onChanged} />
        </div>
        {item}
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>
          {[s.institucion, s.vendedor, `pidió ${s.solicitante}`].filter(Boolean).join(' · ')}
        </div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}><FechasMuestra s={s} /></div>
        {detalle}
      </div>
    );
  }
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center', padding: '10px 0' }}>
        {chevron}
        <MonoTag style={{ padding: 0 }}>{s.folio}</MonoTag>
        <div style={{ minWidth: 0 }}><EstadoMuestra key={s.estado} s={s} onChanged={onChanged} /></div>
        {item}
        {texto(s.institucion)}
        {texto(s.vendedor)}
        <div style={{ minWidth: 0 }}>
          {texto(s.solicitante)}
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>{fmtFecha(s.createdAt)}</div>
        </div>
        {productos}
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}><FechasMuestra s={s} /></div>
      </div>
      {detalle && <Fragment>{detalle}</Fragment>}
    </div>
  );
}
