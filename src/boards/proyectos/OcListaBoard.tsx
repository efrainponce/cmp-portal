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
import { listOcLista, setOcPdfDatos, setOcPagada } from '../../lib/apiClient';
import { fmtMoney2 } from '../../lib/format';
import { esReemplazoDudoso } from '../../../shared/ocReemplazo';
import { lineasCuadran, type OcLineasPdf } from '../../../shared/ocLineasPdf';
import { SearchInput } from '../../components/forms/SearchInput';
import { MonoTag } from '../../components/core/Badges';
import { FilePreviewModal } from '../../components/core/FilePreviewModal';
import { useIsMobile } from '../../lib/useIsMobile';
import { textIncludes } from '../../lib/textMatch';

const TODAS = '__todas__';
const SIN_ZONA = 'Sin zona';
const GRID = '16px 76px 78px 1.2fr 1.5fr 0.6fr 130px 120px 90px';
const GRID_LINEAS = '1.6fr 1.1fr 0.9fr 60px 90px 60px 100px';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** aaaa-mm-dd → "18 sep 26". A mano y no con Date: una fecha sin hora pasada
 * por Date se recorre un día en zonas al oeste de UTC (México). */
function fmtFechaOc(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${Number(d)} ${MESES[Number(m) - 1] ?? m} ${a.slice(2)}`;
}

/** Subtotal por moneda de las órdenes que SUMAN (vigentes con monto leído). */
function totalesPorMoneda(filas: OcListaRow[]): [string, number][] {
  const porMoneda = new Map<string, number>();
  for (const o of filas) if (o.subtotal != null && !o.reemplazadaPor) porMoneda.set(o.moneda ?? 'MXN', (porMoneda.get(o.moneda ?? 'MXN') ?? 0) + o.subtotal);
  return [...porMoneda].sort(([a], [b]) => a.localeCompare(b));
}

/** Suma por moneda: las OC en dólares no se mezclan con las de pesos. Las
 * re-emisiones no entran: de cada proveedor en un proyecto solo cuenta la
 * última OC (Efraín, 2026-09-18). */
function sumaPorMoneda(filas: OcListaRow[]): string {
  const t = totalesPorMoneda(filas);
  return t.length === 0 ? '—' : t.map(([m, n]) => `${fmtMoney2(n)} ${m}`).join(' + ');
}

const selectStyle: React.CSSProperties = {
  height: 36, font: 'var(--text-label)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '0 10px',
  boxSizing: 'border-box', background: 'var(--bg-raised)', cursor: 'pointer', maxWidth: '100%',
};
const linkStyle: React.CSSProperties = { font: 'var(--text-label)', color: 'var(--accent)', textDecoration: 'none' };

const botonLink: React.CSSProperties = { ...linkStyle, background: 'none', border: 'none', cursor: 'pointer', padding: 0 };

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
  const [soloVigentes, setSoloVigentes] = useState(false);
  // El PDF se abre en el lector del portal, no en otra pestaña (Efraín,
  // 2026-09-18) — el modal ya trae "Abrir en pestaña" y "Descargar".
  const [viendo, setViendo] = useState<string | null>(null);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const toggleAbierta = (folio: string) => setAbiertas(prev => {
    const next = new Set(prev);
    if (!next.delete(folio)) next.add(folio);
    return next;
  });

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

  // Fecha y subtotal: lo que falta se lee del PDF en segundo plano, de a dos, y se
  // asientan en el server — cada orden se lee UNA vez en la vida, no por visita.
  // La cola vive en refs y NO en el efecto: cada lectura exitosa cambia
  // `ordenes`, y si los trabajadores colgaran del cleanup del efecto se
  // cancelarían a sí mismos después de la primera orden.
  const vistos = useRef(new Set<string>());
  const cola = useRef<OcListaRow[]>([]);
  const trabajadores = useRef(0);
  const montado = useRef(true);
  const [enCurso, setEnCurso] = useState(0);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);

  const trabajar = useCallback(async () => {
    trabajadores.current++;
    try {
      const { leerDatosDeOc } = await import('../../lib/ocPdfMonto');
      for (let orden = cola.current.shift(); orden && montado.current; orden = cola.current.shift()) {
        const { folio, url, assetId } = orden;
        try {
          const { fecha, monto } = await leerDatosDeOc(url!);
          // Se asienta SIEMPRE, aunque el PDF no traiga totales: la fila es la
          // marca de "ya leído" y evita rebajarlo en cada visita.
          await setOcPdfDatos(folio, {
            fecha, subtotal: monto?.subtotal ?? null, iva: monto?.iva ?? null, total: monto?.total ?? null, moneda: monto?.moneda ?? null,
          });
          setOrdenes(prev => prev?.map(x => (x.folio === folio
            ? { ...x, pdfLeido: true, fecha: fecha ?? x.fecha, ...(monto ? { ...monto, moneda: monto.moneda ?? x.moneda } : {}) }
            : x)) ?? prev);
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
    const nuevas = (ordenes ?? []).filter(o => !o.pdfLeido && o.url && o.assetId && !vistos.current.has(o.assetId));
    if (nuevas.length === 0) return;
    for (const o of nuevas) vistos.current.add(o.assetId!);
    cola.current.push(...nuevas);
    setEnCurso(cola.current.length);
    while (trabajadores.current < 2) void trabajar();
  }, [ordenes, trabajar]);

  const zonas = useMemo(() => [...new Set((ordenes ?? []).map(o => o.zona ?? SIN_ZONA))].sort(), [ordenes]);
  const proveedores = useMemo(() => [...new Set((ordenes ?? []).map(o => o.proveedor))].sort(), [ordenes]);

  const visibles = useMemo(() => (ordenes ?? []).filter(o =>
    (zona === TODAS || (o.zona ?? SIN_ZONA) === zona)
    && (proveedor === TODAS || o.proveedor === proveedor)
    && (pago === TODAS || (pago === 'si') === o.pagada)
    && (!soloVigentes || !o.reemplazadaPor)
    && (!q.trim() || [o.folio, o.proveedor, o.proyecto, o.proyectoFolio ?? ''].some(t => textIncludes(t, q))),
  ), [ordenes, zona, proveedor, pago, soloVigentes, q]);

  // Re-emisiones cuyo monto no se parece al de la orden que las reemplazó: se
  // pintan, sin más (shared/ocReemplazo.ts). Se calcula aquí y no en el server
  // porque los montos van llegando conforme se leen los PDFs.
  const dudosas = useMemo(() => {
    const porFolio = new Map((ordenes ?? []).map(o => [o.folio, o]));
    return new Set((ordenes ?? [])
      .filter(o => o.reemplazadaPor && esReemplazoDudoso(o.subtotal, porFolio.get(o.reemplazadaPor)?.subtotal ?? null))
      .map(o => o.folio));
  }, [ordenes]);

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

  const hayFiltro = zona !== TODAS || proveedor !== TODAS || pago !== TODAS || soloVigentes || !!q.trim();
  // Los conteos y las sumas son de las VIGENTES: una re-emisión no es una
  // orden más por pagar.
  const vigentes = visibles.filter(o => !o.reemplazadaPor);
  const reemplazadas = visibles.length - vigentes.length;
  const pagadas = vigentes.filter(o => o.pagada).length;
  const sinMonto = vigentes.filter(o => o.subtotal == null).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: isMobile ? '14px 14px 12px' : '26px 32px 16px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <div style={{ font: 'var(--text-title)', color: 'var(--ink)' }}>Lista de OC</div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', marginTop: 2 }}>
          {ordenes == null ? 'Cargando…'
            : `${hayFiltro ? `${visibles.length} de ${ordenes.length}` : ordenes.length} órdenes · ${pagadas} pagadas · ${vigentes.length - pagadas} por pagar${reemplazadas > 0 ? ` · ${reemplazadas} reemplazadas (no suman)` : ''}`}
        </div>
        {ordenes != null && (
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', marginTop: 6, display: 'flex', gap: isMobile ? 4 : 18, flexDirection: isMobile ? 'column' : 'row', flexWrap: 'wrap' }}>
            <span>Subtotal: <b style={{ color: 'var(--ink)' }}>{sumaPorMoneda(visibles)}</b></span>
            <span>Por pagar: <b style={{ color: 'var(--ink)' }}>{sumaPorMoneda(vigentes.filter(o => !o.pagada))}</b></span>
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
          <select aria-label="Vigencia" value={soloVigentes ? 'vigentes' : TODAS} onChange={(e) => setSoloVigentes(e.target.value === 'vigentes')} style={selectStyle}>
            <option value={TODAS}>Órdenes: todas</option>
            <option value="vigentes">Solo vigentes</option>
          </select>
          {hayFiltro && (
            <button
              onClick={() => { setQ(''); setZona(TODAS); setProveedor(TODAS); setPago(TODAS); setSoloVigentes(false); }}
              style={{ ...linkStyle, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Quitar filtros
            </button>
          )}
        </div>
      </div>

      {/* Sin padding abajo: el pie de totales es sticky y el padding del contenedor
          dejaba asomar una fila por debajo de él. */}
      <div style={{ overflowY: 'auto', flex: 1, padding: isMobile ? '4px 14px 0' : '0 32px 0' }}>
        {error && <div style={{ padding: '16px 0', font: 'var(--text-label)', color: 'var(--danger, #b42318)' }}>{error}</div>}
        {!isMobile && ordenes != null && (
          <div style={{
            display: 'grid', gridTemplateColumns: GRID, gap: 12, padding: '12px 0 8px', position: 'sticky', top: 0,
            background: 'var(--bg)', borderBottom: '1px solid var(--border)', font: 'var(--text-label)', color: 'var(--ink-tertiary)', zIndex: 1,
          }}>
            <div /><div>Folio</div><div>Fecha</div><div>Proveedor</div><div>Proyecto</div><div>Zona</div><div style={{ textAlign: 'right' }}>Subtotal</div><div>PDF</div><div>Pagada</div>
          </div>
        )}
        {ordenes != null && visibles.length === 0 && !error && (
          <div style={{ padding: '24px 0', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
            {hayFiltro ? 'Ninguna orden con esos filtros.' : 'Sin órdenes de compra.'}
          </div>
        )}
        {visibles.map(o => (
          <Fila key={o.folio} o={o} dudosa={dudosas.has(o.folio)} ilegible={o.pdfLeido && o.subtotal == null} isMobile={isMobile} onOpenProyecto={onOpenProyecto} onVer={setViendo} abierta={abiertas.has(o.folio)} onAbrir={() => toggleAbierta(o.folio)} onToggle={() => void togglePagada(o)} />
        ))}
        {/* Total de lo que deja ver el filtro (Efraín, 2026-09-18). Pegado abajo:
            con 269 filas, un total al final de la lista no lo vería nadie. */}
        {visibles.length > 0 && (
          <div style={{
            position: 'sticky', bottom: 0, zIndex: 1, background: 'var(--bg)', borderTop: '1px solid var(--border)',
            marginTop: -1, padding: '10px 0', display: isMobile ? 'flex' : 'grid', gridTemplateColumns: GRID, gap: 12,
            justifyContent: 'space-between', alignItems: 'start', font: 'var(--text-label)', color: 'var(--ink-secondary)',
          }}>
            <div style={isMobile ? undefined : { gridColumn: '1 / 7' }}>
              Subtotal de {vigentes.length} {vigentes.length === 1 ? 'orden' : 'órdenes'}{hayFiltro ? ' (con los filtros de arriba)' : ''}
              {reemplazadas > 0 ? ` · ${reemplazadas} reemplazadas no suman` : ''}
              {sinMonto > 0 ? ` · ${sinMonto} sin monto` : ''}
            </div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', font: 'var(--text-body)', color: 'var(--ink)', fontWeight: 600 }}>
              {totalesPorMoneda(vigentes).length === 0 ? '—' : totalesPorMoneda(vigentes).map(([m, n]) => (
                <div key={m}>{fmtMoney2(n)} <span style={{ color: 'var(--ink-tertiary)', fontWeight: 400 }}>{m}</span></div>
              ))}
            </div>
          </div>
        )}
      </div>
      {viendo && <FilePreviewModal url={viendo} onClose={() => setViendo(null)} />}
    </div>
  );
}

function Fila({ o, dudosa, ilegible, isMobile, onOpenProyecto, onVer, abierta, onAbrir, onToggle }: {
  o: OcListaRow; dudosa: boolean; ilegible: boolean; isMobile: boolean; onOpenProyecto: (id: string) => void;
  onVer: (url: string) => void; abierta: boolean; onAbrir: () => void; onToggle: () => void;
}) {
  const chevron = (
    <button
      onClick={onAbrir} disabled={!o.url} aria-expanded={abierta} aria-label={abierta ? 'Ocultar lo que trae la orden' : 'Ver lo que trae la orden'}
      title={o.url ? 'Ver lo que trae la orden' : 'Esta orden no tiene PDF con costos'}
      style={{
        background: 'none', border: 'none', padding: 0, width: 16, height: 20, cursor: o.url ? 'pointer' : 'default', flex: 'none',
        color: o.url ? 'var(--ink-tertiary)' : 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" style={{ transform: abierta ? 'rotate(90deg)' : undefined, transition: 'transform .12s' }}>
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
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
      style={{
        font: 'var(--text-body)', color: dudosa ? 'var(--status-esperando)' : o.subtotal == null || o.reemplazadaPor ? 'var(--ink-quiet)' : 'var(--ink)', textAlign: 'right',
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textDecoration: o.reemplazadaPor && o.subtotal != null ? 'line-through' : undefined,
      }}
      title={dudosa ? `No suma, pero ojo: su monto es muy distinto al de ${o.reemplazadaPor}, que la reemplazó. Puede ser una compra aparte.` : o.reemplazadaPor ? `No suma: la reemplazó ${o.reemplazadaPor}, la OC más reciente de este proveedor en el proyecto.` : o.subtotal != null && o.total != null ? `IVA ${fmtMoney2(o.iva ?? 0)} · Total ${fmtMoney2(o.total)}` : ilegible ? 'El PDF de esta orden no trae el bloque de totales.' : undefined}
    >
      {o.subtotal != null ? <>{fmtMoney2(o.subtotal)}{o.moneda && o.moneda !== 'MXN' ? <span style={{ color: 'var(--ink-tertiary)' }}> {o.moneda}</span> : null}</> : ilegible || !o.url ? '—' : '…'}
    </div>
  );
  const folio = (
    <div style={{ minWidth: 0 }}>
      <MonoTag style={{ padding: 0 }}>{o.folio}</MonoTag>
      {o.reemplazadaPor && (
        <div
          style={{ font: 'var(--text-label)', color: dudosa ? 'var(--status-esperando)' : 'var(--ink-quiet)', whiteSpace: 'nowrap' }}
          title={dudosa
            ? `No suma: la reemplazó ${o.reemplazadaPor}. Pero su monto es muy distinto al de esa orden — puede ser una compra aparte y no una corrección.`
            : `Re-emisión: la vigente es ${o.reemplazadaPor}. No suma.`}
        >
          → {o.reemplazadaPor}
        </div>
      )}
    </div>
  );
  const fecha = (
    <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }} title={o.fecha ? 'Fecha impresa en la orden' : undefined}>
      {o.fecha ? fmtFechaOc(o.fecha) : o.pdfLeido || !o.url ? '—' : '…'}
    </div>
  );
  const pdfs = (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {o.url && <button onClick={() => onVer(o.url!)} style={botonLink}>Ver OC</button>}
      {o.urlSinCostos && <button onClick={() => onVer(o.urlSinCostos!)} style={botonLink}>Sin costos</button>}
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
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>{chevron}{folio}{fecha}</div>
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
        {abierta && o.url && <LineasDeOc o={o} isMobile />}
      </div>
    );
  }
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
    <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'center', padding: '10px 0' }}>
      {chevron}
      {folio}
      {fecha}
      <div style={{ font: 'var(--text-body)', color: o.reemplazadaPor ? 'var(--ink-tertiary)' : 'var(--ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.proveedor}>{o.proveedor}</div>
      {proyecto}
      <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>{o.zona ?? SIN_ZONA}</div>
      {subtotal}
      {pdfs}
      {pagada}
    </div>
    {abierta && o.url && <LineasDeOc o={o} isMobile={false} />}
    </div>
  );
}

// Lo que ya se leyó en esta sesión: reabrir un chevron no vuelve a bajar el PDF.
const lineasLeidas = new Map<string, OcLineasPdf | null>();

/** Lo que trae la orden, leído de la tabla de SU PDF (shared/ocLineasPdf.ts) —
 * no de las líneas del proyecto, que no dicen de qué OC son y ya no se parecen
 * a una orden reemplazada. */
function LineasDeOc({ o, isMobile }: { o: OcListaRow; isMobile: boolean }) {
  const llave = o.assetId ?? o.url!;
  const [estado, setEstado] = useState<{ r: OcLineasPdf | null } | { error: string } | null>(
    lineasLeidas.has(llave) ? { r: lineasLeidas.get(llave)! } : null,
  );
  useEffect(() => {
    if (estado) return;
    let vivo = true;
    void (async () => {
      try {
        const { leerLineasDeOc } = await import('../../lib/ocPdfMonto');
        const r = await leerLineasDeOc(o.url!);
        lineasLeidas.set(llave, r);
        if (vivo) setEstado({ r });
      } catch (e) {
        if (vivo) setEstado({ error: e instanceof Error ? e.message : 'No se pudo leer el PDF.' });
      }
    })();
    return () => { vivo = false; };
  }, [estado, llave, o.url]);

  const caja: React.CSSProperties = {
    margin: isMobile ? '4px 0 2px' : '0 0 12px 28px', padding: isMobile ? '8px 10px' : '10px 14px',
    background: 'var(--bg-sunken)', borderRadius: 'var(--radius-lg)', font: 'var(--text-label)', color: 'var(--ink-secondary)',
  };
  if (!estado) return <div style={caja}>Leyendo el PDF…</div>;
  if ('error' in estado) return <div style={caja}>{estado.error}</div>;
  if (!estado.r) return <div style={caja}>El PDF de esta orden no trae una tabla que se pueda leer. Ábrelo con "Ver OC".</div>;

  const { lineas, suma } = estado.r;
  const piezas = lineas.reduce((s, l) => s + l.cantidad, 0);
  const num: React.CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
  return (
    <div style={caja}>
      {!isMobile && (
        <div style={{ display: 'grid', gridTemplateColumns: GRID_LINEAS, gap: 10, color: 'var(--ink-tertiary)', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
          <div>Producto</div><div>Modelo / color</div><div>Talla</div><div style={num}>Cant.</div><div style={num}>Precio</div><div style={num}>Desc.</div><div style={num}>Subtotal</div>
        </div>
      )}
      {lineas.map((l, i) => isMobile ? (
        <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ color: 'var(--ink)' }}>{l.producto}</div>
          <div>{[l.modelo, l.talla].filter(Boolean).join(' · ')}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
            <span>{l.cantidad} × {fmtMoney2(l.precio)}{l.descuento && l.descuento !== '0%' ? ` − ${l.descuento}` : ''}</span>
            <span style={{ color: 'var(--ink)' }}>{fmtMoney2(l.subtotal)}</span>
          </div>
        </div>
      ) : (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: GRID_LINEAS, gap: 10, padding: '5px 0', borderBottom: '1px solid var(--border)', alignItems: 'start' }}>
          <div style={{ color: 'var(--ink)' }}>{l.producto}</div>
          <div>{l.modelo}</div>
          <div>{l.talla}</div>
          <div style={num}>{l.cantidad}</div>
          <div style={num}>{fmtMoney2(l.precio)}</div>
          <div style={num}>{l.descuento}</div>
          <div style={{ ...num, color: 'var(--ink)' }}>{fmtMoney2(l.subtotal)}</div>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingTop: 6, flexWrap: 'wrap' }}>
        <span>{lineas.length} {lineas.length === 1 ? 'renglón' : 'renglones'} · {piezas.toLocaleString('es-MX')} piezas</span>
        <span style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney2(suma)}{o.moneda ? ` ${o.moneda}` : ''}</span>
      </div>
      {o.subtotal != null && !lineasCuadran(estado.r, o.subtotal) && (
        <div style={{ color: 'var(--status-esperando)', paddingTop: 4 }}>
          Ojo: estos renglones suman {fmtMoney2(suma)} y el PDF dice {fmtMoney2(o.subtotal)}. Puede faltar alguno aquí — revisa el PDF.
        </div>
      )}
    </div>
  );
}
