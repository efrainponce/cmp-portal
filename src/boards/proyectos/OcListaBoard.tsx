// Tablero "Lista de OC" (Elisa, 2026-09-18): las mismas órdenes de compra que
// viven dentro de cada Proyecto, todas en una lista — filtrables por zona y
// proveedor, con su proyecto a un clic y la marca de "pagada" (propia del
// portal, worker/lib/ocLista.ts).
//
// Los filtros NO se guardan entre sesiones, a diferencia de los de las listas
// de pipeline: un filtro recordado deja la lista en 0 sin avisar, y aquí la
// pregunta típica es "¿dónde está la OC tal?".
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OcListaRow } from '../../../shared/dto';
import { listOcLista, setOcPagada } from '../../lib/apiClient';
import { SearchInput } from '../../components/forms/SearchInput';
import { MonoTag } from '../../components/core/Badges';
import { useIsMobile } from '../../lib/useIsMobile';
import { textIncludes } from '../../lib/textMatch';

const TODAS = '__todas__';
const SIN_ZONA = 'Sin zona';
const GRID = '84px 1.3fr 1.6fr 0.7fr 150px 90px';

const selectStyle: React.CSSProperties = {
  height: 36, font: 'var(--text-label)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '0 10px',
  boxSizing: 'border-box', background: 'var(--bg-raised)', cursor: 'pointer', maxWidth: '100%',
};
const linkStyle: React.CSSProperties = { font: 'var(--text-label)', color: 'var(--accent)', textDecoration: 'none' };

interface Props {
  onOpenProyecto: (proyectoId: string) => void;
}

export default function OcListaBoard({ onOpenProyecto }: Props) {
  const isMobile = useIsMobile();
  const [ordenes, setOrdenes] = useState<OcListaRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [zona, setZona] = useState(TODAS);
  const [proveedor, setProveedor] = useState(TODAS);
  const [pago, setPago] = useState(TODAS);

  const cargar = useCallback(async () => {
    try {
      setOrdenes(await listOcLista());
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

  const zonas = useMemo(() => [...new Set((ordenes ?? []).map(o => o.zona ?? SIN_ZONA))].sort(), [ordenes]);
  const proveedores = useMemo(() => [...new Set((ordenes ?? []).map(o => o.proveedor))].sort(), [ordenes]);

  const visibles = useMemo(() => (ordenes ?? []).filter(o =>
    (zona === TODAS || (o.zona ?? SIN_ZONA) === zona)
    && (proveedor === TODAS || o.proveedor === proveedor)
    && (pago === TODAS || (pago === 'si') === o.pagada)
    && (!q.trim() || [o.folio, o.proveedor, o.proyecto, o.proyectoFolio ?? ''].some(t => textIncludes(t, q))),
  ), [ordenes, zona, proveedor, pago, q]);

  // Optimista: la marca se ve de inmediato y se revierte si el server la rechaza.
  const togglePagada = async (o: OcListaRow) => {
    const pagada = !o.pagada;
    const aplica = (v: boolean) => setOrdenes(prev => prev?.map(x => (x.folio === o.folio ? { ...x, pagada: v } : x)) ?? prev);
    aplica(pagada);
    try {
      await setOcPagada(o.folio, pagada);
    } catch (e) {
      aplica(!pagada);
      window.alert(e instanceof Error ? e.message : 'No se pudo guardar.');
    }
  };

  const hayFiltro = zona !== TODAS || proveedor !== TODAS || pago !== TODAS || !!q.trim();
  const pagadas = visibles.filter(o => o.pagada).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: isMobile ? '14px 14px 12px' : '26px 32px 16px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <div style={{ font: 'var(--text-title)', color: 'var(--ink)' }}>Lista de OC</div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', marginTop: 2 }}>
          {ordenes == null ? 'Cargando…'
            : `${hayFiltro ? `${visibles.length} de ${ordenes.length}` : ordenes.length} órdenes · ${pagadas} pagadas · ${visibles.length - pagadas} por pagar`}
        </div>
        <div style={{ marginTop: isMobile ? 10 : 14, display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 10, flexWrap: 'wrap' }}>
          <SearchInput
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar folio, proveedor o proyecto…"
            style={isMobile ? { maxWidth: '100%', flexBasis: '100%' } : undefined}
          />
          <select aria-label="Zona" value={zona} onChange={(e) => setZona(e.target.value)} style={selectStyle}>
            <option value={TODAS}>Zona: todas</option>
            {zonas.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
          <select aria-label="Proveedor" value={proveedor} onChange={(e) => setProveedor(e.target.value)} style={{ ...selectStyle, maxWidth: isMobile ? '100%' : 260 }}>
            <option value={TODAS}>Proveedor: todos</option>
            {proveedores.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select aria-label="Pago" value={pago} onChange={(e) => setPago(e.target.value)} style={selectStyle}>
            <option value={TODAS}>Pago: todas</option>
            <option value="no">Por pagar</option>
            <option value="si">Pagadas</option>
          </select>
          {hayFiltro && (
            <button
              onClick={() => { setQ(''); setZona(TODAS); setProveedor(TODAS); setPago(TODAS); }}
              style={{ ...linkStyle, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Quitar filtros
            </button>
          )}
        </div>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: isMobile ? '4px 14px 16px' : '0 32px 24px' }}>
        {error && <div style={{ padding: '16px 0', font: 'var(--text-label)', color: 'var(--danger, #b42318)' }}>{error}</div>}
        {!isMobile && ordenes != null && (
          <div style={{
            display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '12px 0 8px', position: 'sticky', top: 0,
            background: 'var(--bg)', borderBottom: '1px solid var(--border)', font: 'var(--text-label)', color: 'var(--ink-tertiary)', zIndex: 1,
          }}>
            <div>Folio</div><div>Proveedor</div><div>Proyecto</div><div>Zona</div><div>PDF</div><div>Pagada</div>
          </div>
        )}
        {ordenes != null && visibles.length === 0 && !error && (
          <div style={{ padding: '24px 0', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
            {hayFiltro ? 'Ninguna orden con esos filtros.' : 'Sin órdenes de compra.'}
          </div>
        )}
        {visibles.map(o => (
          <Fila key={o.folio} o={o} isMobile={isMobile} onOpenProyecto={onOpenProyecto} onToggle={() => void togglePagada(o)} />
        ))}
      </div>
    </div>
  );
}

function Fila({ o, isMobile, onOpenProyecto, onToggle }: {
  o: OcListaRow; isMobile: boolean; onOpenProyecto: (id: string) => void; onToggle: () => void;
}) {
  const proyecto = (
    <button
      onClick={() => onOpenProyecto(o.proyectoId)}
      title="Abrir el proyecto"
      style={{
        ...linkStyle, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
        minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isMobile ? 'normal' : 'nowrap',
      }}
    >
      {o.proyectoFolio ? `${o.proyectoFolio} · ` : ''}{o.proyecto}
    </button>
  );
  const pdfs = (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {o.url && <a href={o.url} target="_blank" rel="noreferrer" style={linkStyle}>Ver OC</a>}
      {o.urlSinCostos && <a href={o.urlSinCostos} target="_blank" rel="noreferrer" style={linkStyle}>Sin costos</a>}
    </div>
  );
  const pagada = (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, font: 'var(--text-label)', color: o.pagada ? 'var(--ink)' : 'var(--ink-tertiary)', cursor: 'pointer' }}>
      <input type="checkbox" checked={o.pagada} onChange={onToggle} style={{ cursor: 'pointer' }} />
      {o.pagada ? 'Pagada' : 'Por pagar'}
    </label>
  );

  if (isMobile) {
    return (
      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <MonoTag style={{ padding: 0 }}>{o.folio}</MonoTag>
          {pagada}
        </div>
        <div style={{ font: 'var(--text-body)', color: 'var(--ink)' }}>{o.proveedor}</div>
        {proyecto}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>{o.zona ?? SIN_ZONA}</div>
          {pdfs}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <MonoTag style={{ padding: 0 }}>{o.folio}</MonoTag>
      <div style={{ font: 'var(--text-body)', color: 'var(--ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.proveedor}>{o.proveedor}</div>
      {proyecto}
      <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>{o.zona ?? SIN_ZONA}</div>
      {pdfs}
      {pagada}
    </div>
  );
}
