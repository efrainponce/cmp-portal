// Tablero "Lista de OC" (Elisa, 2026-09-18): las mismas órdenes de compra que
// viven dentro de cada Proyecto, todas en una lista — filtrables por zona y
// proveedor, con su proyecto a un clic y la marca de "pagada" (propia del
// portal, worker/lib/ocLista.ts).
//
// Los filtros NO se guardan entre sesiones, a diferencia de los de las listas
// de pipeline: un filtro recordado deja la lista en 0 sin avisar, y aquí la
// pregunta típica es "¿dónde está la OC tal?".
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OcListaRow } from '../../../shared/dto';
import { listOcLista, setOcMonto, setOcPagada } from '../../lib/apiClient';
import { fmtMoney2 } from '../../lib/format';
import { SearchInput } from '../../components/forms/SearchInput';
import { MonoTag } from '../../components/core/Badges';
import { useIsMobile } from '../../lib/useIsMobile';
import { textIncludes } from '../../lib/textMatch';

const TODAS = '__todas__';
const SIN_ZONA = 'Sin zona';
const GRID = '76px 1.2fr 1.5fr 0.6fr 130px 120px 90px';

/** PDFs que ya se abrieron en esta sesión y no traen totales legibles (OC-200 a
 * 205 salieron sin el bloque): no se vuelven a bajar en cada refresco. Por
 * asset, para que una orden regenerada sí se reintente. */
const ILEGIBLES_KEY = 'cmp:oc-lista:ilegibles';
function ilegiblesGuardados(): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(ILEGIBLES_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}

/** Suma por moneda: las OC en dólares no se mezclan con las de pesos. */
function sumaPorMoneda(filas: OcListaRow[]): string {
  const porMoneda = new Map<string, number>();
  for (const o of filas) if (o.subtotal != null) porMoneda.set(o.moneda ?? 'MXN', (porMoneda.get(o.moneda ?? 'MXN') ?? 0) + o.subtotal);
  if (porMoneda.size === 0) return '—';
  return [...porMoneda].sort(([a], [b]) => a.localeCompare(b)).map(([m, n]) => `${fmtMoney2(n)} ${m}`).join(' + ');
}

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

  // Subtotales: los que faltan se leen del PDF en segundo plano, de a dos, y se
  // asientan en el server — cada orden se lee UNA vez en la vida, no por visita.
  // La cola vive en refs y NO en el efecto: cada lectura exitosa cambia
  // `ordenes`, y si los trabajadores colgaran del cleanup del efecto se
  // cancelarían a sí mismos después de la primera orden.
  const [ilegibles, setIlegibles] = useState<Set<string>>(ilegiblesGuardados);
  const vistos = useRef(new Set<string>());
  const cola = useRef<OcListaRow[]>([]);
  const trabajadores = useRef(0);
  const montado = useRef(true);
  const [enCurso, setEnCurso] = useState(0);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);

  const trabajar = useCallback(async () => {
    trabajadores.current++;
    try {
      const { leerMontoDeOc } = await import('../../lib/ocPdfMonto');
      for (let orden = cola.current.shift(); orden && montado.current; orden = cola.current.shift()) {
        const { folio, url, assetId } = orden;
        try {
          const m = await leerMontoDeOc(url!);
          if (m) {
            await setOcMonto(folio, m);
            setOrdenes(prev => prev?.map(x => (x.folio === folio ? { ...x, ...m, moneda: m.moneda ?? x.moneda } : x)) ?? prev);
          } else {
            setIlegibles(prev => {
              const next = new Set(prev).add(assetId!);
              sessionStorage.setItem(ILEGIBLES_KEY, JSON.stringify([...next]));
              return next;
            });
          }
        } catch {
          // Red o PDF caído: se suelta para reintentarlo en la próxima carga.
          vistos.current.delete(assetId!);
        }
        setEnCurso(cola.current.length);
      }
    } finally {
      trabajadores.current--;
    }
  }, []);

  useEffect(() => {
    const nuevas = (ordenes ?? []).filter(o => o.subtotal == null && o.url && o.assetId
      && !ilegibles.has(o.assetId) && !vistos.current.has(o.assetId));
    if (nuevas.length === 0) return;
    for (const o of nuevas) vistos.current.add(o.assetId!);
    cola.current.push(...nuevas);
    setEnCurso(cola.current.length);
    while (trabajadores.current < 2) void trabajar();
  }, [ordenes, ilegibles, trabajar]);

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
  const sinMonto = visibles.filter(o => o.subtotal == null).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: isMobile ? '14px 14px 12px' : '26px 32px 16px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <div style={{ font: 'var(--text-title)', color: 'var(--ink)' }}>Lista de OC</div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', marginTop: 2 }}>
          {ordenes == null ? 'Cargando…'
            : `${hayFiltro ? `${visibles.length} de ${ordenes.length}` : ordenes.length} órdenes · ${pagadas} pagadas · ${visibles.length - pagadas} por pagar`}
        </div>
        {ordenes != null && (
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', marginTop: 6, display: 'flex', gap: isMobile ? 4 : 18, flexDirection: isMobile ? 'column' : 'row', flexWrap: 'wrap' }}>
            <span>Subtotal: <b style={{ color: 'var(--ink)' }}>{sumaPorMoneda(visibles)}</b></span>
            <span>Por pagar: <b style={{ color: 'var(--ink)' }}>{sumaPorMoneda(visibles.filter(o => !o.pagada))}</b></span>
            {sinMonto > 0 && (
              <span style={{ color: 'var(--ink-tertiary)' }} title="El subtotal se lee del PDF de cada orden. Las que no traen el bloque de totales en el PDF se quedan sin monto.">
                {enCurso > 0 ? `leyendo PDFs… faltan ${enCurso}` : `${sinMonto} sin monto (no suman)`}
              </span>
            )}
          </div>
        )}
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
            <div>Folio</div><div>Proveedor</div><div>Proyecto</div><div>Zona</div><div style={{ textAlign: 'right' }}>Subtotal</div><div>PDF</div><div>Pagada</div>
          </div>
        )}
        {ordenes != null && visibles.length === 0 && !error && (
          <div style={{ padding: '24px 0', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
            {hayFiltro ? 'Ninguna orden con esos filtros.' : 'Sin órdenes de compra.'}
          </div>
        )}
        {visibles.map(o => (
          <Fila key={o.folio} o={o} ilegible={!!o.assetId && ilegibles.has(o.assetId)} isMobile={isMobile} onOpenProyecto={onOpenProyecto} onToggle={() => void togglePagada(o)} />
        ))}
      </div>
    </div>
  );
}

function Fila({ o, ilegible, isMobile, onOpenProyecto, onToggle }: {
  o: OcListaRow; ilegible: boolean; isMobile: boolean; onOpenProyecto: (id: string) => void; onToggle: () => void;
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
      {o.tambienEn.length > 0 && (
        <span
          style={{ color: 'var(--ink-tertiary)' }}
          title={`El mismo PDF está también en: ${o.tambienEn.map(t => `${t.proyectoFolio ?? ''} ${t.proyecto}`.trim()).join(' · ')} (proyecto clonado). Es una sola orden.`}
        >
          {' '}+ {o.tambienEn.map(t => t.proyectoFolio ?? 'clon').join(', ')}
        </span>
      )}
    </button>
  );
  const subtotal = (
    <div
      style={{ font: 'var(--text-body)', color: o.subtotal == null ? 'var(--ink-quiet)' : 'var(--ink)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
      title={o.subtotal != null && o.total != null ? `IVA ${fmtMoney2(o.iva ?? 0)} · Total ${fmtMoney2(o.total)}` : ilegible ? 'El PDF de esta orden no trae el bloque de totales.' : undefined}
    >
      {o.subtotal != null ? <>{fmtMoney2(o.subtotal)}{o.moneda && o.moneda !== 'MXN' ? <span style={{ color: 'var(--ink-tertiary)' }}> {o.moneda}</span> : null}</> : ilegible || !o.url ? '—' : '…'}
    </div>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ font: 'var(--text-body)', color: 'var(--ink)', minWidth: 0 }}>{o.proveedor}</div>
          {subtotal}
        </div>
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
      {subtotal}
      {pdfs}
      {pagada}
    </div>
  );
}
