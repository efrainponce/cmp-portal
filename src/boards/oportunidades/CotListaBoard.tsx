// Tablero "Lista de cotizaciones" de Ventas (Efraín, 2026-09-24): las mismas
// cotizaciones al cliente que viven dentro de cada Oportunidad, todas en una
// lista — como la Lista de OC (src/boards/proyectos/OcListaBoard.tsx), con los
// mismos filtros y, sobre todo, el CLIENTE con buscador (no solo un dropdown:
// son cientos de instituciones).
//
// Los filtros NO se guardan entre sesiones, igual que en la Lista de OC: un
// filtro recordado deja la lista en 0 sin avisar.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CotListaRow } from '../../../shared/dto';
import { listCotLista, setCotPdfDatos } from '../../lib/apiClient';
import { fmtMoney2 } from '../../lib/format';
import { DEAL_STAGE_ORDER, stageKeyForLabel } from '../../../shared/dealStages';
import { SearchInput } from '../../components/forms/SearchInput';
import { SearchableSelect, type SearchableOption } from '../../components/forms/SearchableSelect';
import { MonoTag } from '../../components/core/Badges';
import { FilePreviewModal } from '../../components/core/FilePreviewModal';
import { ColumnPicker } from '../../components/board/ColumnPicker';
import { ExportExcelButton } from '../../components/board/ExportExcelButton';
import type { ColumnaExport } from '../../lib/exportXlsx';
import { useColumnasVisibles, type ColumnaDef } from '../../lib/useColumnasVisibles';
import { useIsMobile } from '../../lib/useIsMobile';
import { compactText, searchMatches } from '../../lib/textMatch';

const TODAS = '__todas__';
const SIN_ZONA = 'Sin zona';
const SIN_VENDEDOR = 'Sin vendedor';
const SIN_CLIENTE = 'Sin cliente';

const COLUMNAS: readonly (ColumnaDef & { ancho: string; derecha?: boolean })[] = [
  { key: 'folio', label: 'Folio', ancho: '80px', fija: true },
  { key: 'fecha', label: 'Fecha', ancho: '78px' },
  { key: 'cliente', label: 'Cliente', ancho: '1.4fr' },
  { key: 'oportunidad', label: 'Oportunidad', ancho: '1.5fr' },
  { key: 'vendedor', label: 'Vendedor', ancho: '0.8fr' },
  { key: 'zona', label: 'Zona', ancho: '0.5fr' },
  { key: 'etapa', label: 'Etapa', ancho: '0.7fr' },
  { key: 'subtotal', label: 'Subtotal', ancho: '130px', derecha: true },
  { key: 'pdf', label: 'PDF', ancho: '120px' },
];

const EXPORT_POR_COLUMNA: Record<string, ColumnaExport<CotListaRow>[]> = {
  folio: [
    { titulo: 'Folio', valor: c => c.folio },
    { titulo: 'Reemplazada por', valor: c => c.reemplazadaPor },
  ],
  fecha: [{ titulo: 'Fecha', valor: c => c.fecha }],
  cliente: [
    { titulo: 'Institución', valor: c => c.institucion },
    { titulo: 'Contacto', valor: c => c.contacto },
  ],
  oportunidad: [
    { titulo: 'Folio de la oportunidad', valor: c => c.oportunidadFolio },
    { titulo: 'Oportunidad', valor: c => c.oportunidad },
  ],
  vendedor: [{ titulo: 'Vendedor', valor: c => c.vendedor }],
  zona: [{ titulo: 'Zona', valor: c => c.zona }],
  etapa: [{ titulo: 'Etapa', valor: c => c.etapa }],
  subtotal: [
    { titulo: 'Subtotal', valor: c => c.subtotal, moneda: true, ancho: 18 },
    { titulo: 'IVA', valor: c => c.iva, moneda: true, ancho: 18 },
    { titulo: 'Total', valor: c => c.total, moneda: true, ancho: 18 },
    { titulo: 'Moneda', valor: c => (c.subtotal == null ? null : c.moneda ?? 'MXN') },
  ],
  pdf: [{ titulo: 'Firmada por vendedor', valor: c => (c.urlFirmada ? 'Sí' : 'No') }],
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** aaaa-mm-dd → "18 sep 26", a mano (con Date se recorre un día en México). */
function fmtFecha(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${Number(d)} ${MESES[Number(m) - 1] ?? m} ${a.slice(2)}`;
}

/** Subtotal por moneda de las cotizaciones que SUMAN (vigentes con monto leído). */
function totalesPorMoneda(filas: CotListaRow[]): [string, number][] {
  const porMoneda = new Map<string, number>();
  for (const c of filas) if (c.subtotal != null && !c.reemplazadaPor) porMoneda.set(c.moneda ?? 'MXN', (porMoneda.get(c.moneda ?? 'MXN') ?? 0) + c.subtotal);
  return [...porMoneda].sort(([a], [b]) => a.localeCompare(b));
}

function sumaPorMoneda(filas: CotListaRow[]): string {
  const t = totalesPorMoneda(filas);
  return t.length === 0 ? '—' : t.map(([m, n]) => `${fmtMoney2(n)} ${m}`).join(' + ');
}

const clienteDe = (c: CotListaRow) => c.institucion ?? SIN_CLIENTE;

const selectStyle: React.CSSProperties = {
  height: 36, font: 'var(--text-label)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '0 10px',
  boxSizing: 'border-box', background: 'var(--bg-raised)', cursor: 'pointer', maxWidth: '100%',
};
const linkStyle: React.CSSProperties = { font: 'var(--text-label)', color: 'var(--accent)', textDecoration: 'none' };
const botonLink: React.CSSProperties = { ...linkStyle, background: 'none', border: 'none', cursor: 'pointer', padding: 0 };

interface Props {
  onOpenOportunidad: (oportunidadId: string) => void;
}

export default function CotListaBoard({ onOpenOportunidad }: Props) {
  const isMobile = useIsMobile();
  const [cotizaciones, setCotizaciones] = useState<CotListaRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  // '' = todos: es el valor "vacío" de SearchableSelect (su × lo limpia a '').
  const [cliente, setCliente] = useState('');
  const [zona, setZona] = useState(TODAS);
  const [vendedor, setVendedor] = useState(TODAS);
  const [etapa, setEtapa] = useState(TODAS);
  const [firma, setFirma] = useState(TODAS);
  const [soloVigentes, setSoloVigentes] = useState(false);
  const cols = useColumnasVisibles('cot_lista', COLUMNAS);
  const visiblesCols = COLUMNAS.filter(c => cols.visible(c.key));
  const grid = visiblesCols.map(c => c.ancho).join(' ');
  const columnasExport = (isMobile ? COLUMNAS : visiblesCols).flatMap(c => EXPORT_POR_COLUMNA[c.key] ?? []);
  const [viendo, setViendo] = useState<string | null>(null);

  const cargar = useCallback(async (desdeCero = false) => {
    try {
      const nuevas = await listCotLista(desdeCero);
      if (nuevas) setCotizaciones(nuevas); // null = 304
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar.');
    }
  }, []);
  useEffect(() => {
    void cargar(true);
    const t = window.setInterval(() => { if (!document.hidden) void cargar(); }, 60_000);
    return () => window.clearInterval(t);
  }, [cargar]);

  // Fecha y subtotal de las cotizaciones nuevas se leen del PDF en segundo
  // plano, de a dos, y se asientan en el server — cada PDF se lee UNA vez en la
  // vida (el histórico ya se asentó con scripts/cot-lista-backfill.mjs). Mismo
  // patrón que la Lista de OC: la cola vive en refs, no en el efecto.
  const vistos = useRef(new Set<string>());
  const cola = useRef<CotListaRow[]>([]);
  const trabajadores = useRef(0);
  const montado = useRef(true);
  const [enCurso, setEnCurso] = useState(0);
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);

  const trabajar = useCallback(async () => {
    trabajadores.current++;
    try {
      const { leerDatosDeCotizacion } = await import('../../lib/cotPdfMonto');
      for (let c = cola.current.shift(); c && montado.current; c = cola.current.shift()) {
        const { clave, llave } = c;
        try {
          const { fecha, monto } = await leerDatosDeCotizacion((c.url ?? c.urlFirmada)!);
          await setCotPdfDatos(clave, {
            fecha, subtotal: monto?.subtotal ?? null, iva: monto?.iva ?? null, total: monto?.total ?? null, moneda: monto?.moneda ?? null,
          });
          setCotizaciones(prev => prev?.map(x => (x.clave === clave
            ? { ...x, pdfLeido: true, fecha, ...(monto ?? {}) }
            : x)) ?? prev);
        } catch {
          vistos.current.delete(llave!);
        }
        setEnCurso(cola.current.length);
      }
    } finally {
      trabajadores.current--;
    }
  }, []);

  useEffect(() => {
    const nuevas = (cotizaciones ?? []).filter(c => !c.pdfLeido && c.llave && (c.url || c.urlFirmada) && !vistos.current.has(c.llave));
    if (nuevas.length === 0) return;
    for (const c of nuevas) vistos.current.add(c.llave!);
    cola.current.push(...nuevas);
    setEnCurso(cola.current.length);
    while (trabajadores.current < 2) void trabajar();
  }, [cotizaciones, trabajar]);

  // Cliente por LLAVE (sin acentos ni signos), no por texto exacto: la misma
  // institución llega escrita distinto. Se muestra la variante más usada, con
  // cuántas cotizaciones tiene — así el buscador también sirve para ver volumen.
  const clientes = useMemo<SearchableOption[]>(() => {
    const conteo = new Map<string, Map<string, number>>();
    for (const c of cotizaciones ?? []) {
      const nombre = clienteDe(c);
      const k = compactText(nombre);
      const v = conteo.get(k) ?? conteo.set(k, new Map()).get(k)!;
      v.set(nombre, (v.get(nombre) ?? 0) + 1);
    }
    return [...conteo].map(([clave, v]) => {
      const n = [...v.values()].reduce((a, b) => a + b, 0);
      return { value: clave, label: [...v].sort((a, b) => b[1] - a[1])[0][0], sublabel: `${n} ${n === 1 ? 'cotización' : 'cotizaciones'}` };
    }).sort((a, b) => a.label.localeCompare(b.label));
  }, [cotizaciones]);
  const zonas = useMemo(() => [...new Set((cotizaciones ?? []).map(c => c.zona ?? SIN_ZONA))].sort(), [cotizaciones]);
  const vendedores = useMemo(() => [...new Set((cotizaciones ?? []).map(c => c.vendedor ?? SIN_VENDEDOR))].sort(), [cotizaciones]);
  const etapas = useMemo(() => {
    const orden = (l: string) => { const i = DEAL_STAGE_ORDER.indexOf(stageKeyForLabel(l) ?? ''); return i < 0 ? 99 : i; };
    return [...new Set((cotizaciones ?? []).map(c => c.etapa).filter((e): e is string => !!e))].sort((a, b) => orden(a) - orden(b));
  }, [cotizaciones]);

  const visibles = useMemo(() => (cotizaciones ?? []).filter(c =>
    (!cliente || compactText(clienteDe(c)) === cliente)
    && (zona === TODAS || (c.zona ?? SIN_ZONA) === zona)
    && (vendedor === TODAS || (c.vendedor ?? SIN_VENDEDOR) === vendedor)
    && (etapa === TODAS || c.etapa === etapa)
    && (firma === TODAS || (firma === 'si') === !!c.urlFirmada)
    && (!soloVigentes || !c.reemplazadaPor)
    && searchMatches([c.folio, c.institucion ?? '', c.contacto ?? '', c.oportunidad, c.oportunidadFolio ?? '', c.vendedor ?? '',
      ...c.tambienEn.map(t => t.oportunidadFolio ?? '')], q),
  ), [cotizaciones, cliente, zona, vendedor, etapa, firma, soloVigentes, q]);

  const hayFiltro = !!cliente || zona !== TODAS || vendedor !== TODAS || etapa !== TODAS || firma !== TODAS || soloVigentes || !!q.trim();
  const vigentes = visibles.filter(c => !c.reemplazadaPor);
  const anteriores = visibles.length - vigentes.length;
  const firmadas = vigentes.filter(c => c.urlFirmada).length;
  const sinMonto = vigentes.filter(c => c.subtotal == null).length;
  const quitarFiltros = () => { setQ(''); setCliente(''); setZona(TODAS); setVendedor(TODAS); setEtapa(TODAS); setFirma(TODAS); setSoloVigentes(false); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: isMobile ? '14px 14px 12px' : '26px 32px 16px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <div style={{ font: 'var(--text-title)', color: 'var(--ink)' }}>Lista de cotizaciones</div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', marginTop: 2 }}>
          {cotizaciones == null ? 'Cargando…'
            : `${hayFiltro ? `${visibles.length} de ${cotizaciones.length}` : cotizaciones.length} cotizaciones · ${vigentes.length} vigentes · ${firmadas} firmadas por vendedor${anteriores > 0 ? ` · ${anteriores} versiones anteriores (no suman)` : ''}`}
        </div>
        {cotizaciones != null && (
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', marginTop: 6, display: 'flex', gap: isMobile ? 4 : 18, flexDirection: isMobile ? 'column' : 'row', flexWrap: 'wrap' }}>
            <span>Subtotal: <b style={{ color: 'var(--ink)' }}>{sumaPorMoneda(visibles)}</b></span>
            {sinMonto > 0 && (
              <span style={{ color: 'var(--ink-tertiary)' }} title="El subtotal se lee del PDF de cada cotización. Las que no traen el bloque de totales se quedan sin monto.">
                {enCurso > 0 ? `leyendo PDFs… faltan ${enCurso}` : `${sinMonto} sin monto (no suman)`}
              </span>
            )}
          </div>
        )}
        <div style={{ marginTop: isMobile ? 10 : 14, display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 10, flexWrap: 'wrap' }}>
          <SearchInput
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar folio, cliente, contacto u oportunidad…"
            style={isMobile ? { maxWidth: '100%', flexBasis: '100%' } : undefined}
          />
          <div style={{ width: isMobile ? '100%' : 280 }} aria-label="Cliente">
            <SearchableSelect
              value={cliente} onChange={setCliente} options={clientes}
              placeholder="Cliente: todos (escribe para buscar)" emptyMessage="Ningún cliente con ese nombre."
            />
          </div>
          <select aria-label="Zona" value={zona} onChange={(e) => setZona(e.target.value)} style={selectStyle}>
            <option value={TODAS}>Zona: todas</option>
            {zonas.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
          <select aria-label="Vendedor" value={vendedor} onChange={(e) => setVendedor(e.target.value)} style={{ ...selectStyle, maxWidth: isMobile ? '100%' : 220 }}>
            <option value={TODAS}>Vendedor: todos</option>
            {vendedores.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select aria-label="Etapa" value={etapa} onChange={(e) => setEtapa(e.target.value)} style={selectStyle}>
            <option value={TODAS}>Etapa: todas</option>
            {etapas.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <select aria-label="Firma" value={firma} onChange={(e) => setFirma(e.target.value)} style={selectStyle}>
            <option value={TODAS}>Firma: todas</option>
            <option value="si">Firmadas por vendedor</option>
            <option value="no">Sin firmar</option>
          </select>
          <select aria-label="Versiones" value={soloVigentes ? 'vigentes' : TODAS} onChange={(e) => setSoloVigentes(e.target.value === 'vigentes')} style={selectStyle}>
            <option value={TODAS}>Versiones: todas</option>
            <option value="vigentes">Solo la vigente</option>
          </select>
          {!isMobile && (
            <ColumnPicker columnas={COLUMNAS} visible={cols.visible} onToggle={cols.toggle} onRestablecer={cols.restablecer} personalizado={cols.personalizado} />
          )}
          {hayFiltro && <button onClick={quitarFiltros} style={botonLink}>Quitar filtros</button>}
          <ExportExcelButton titulo="Lista de cotizaciones" columnas={columnasExport} filas={visibles} />
        </div>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: isMobile ? '4px 14px 0' : '0 32px 0' }}>
        {error && <div style={{ padding: '16px 0', font: 'var(--text-label)', color: 'var(--danger, #b42318)' }}>{error}</div>}
        {!isMobile && cotizaciones != null && (
          <div style={{
            display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '12px 0 8px', position: 'sticky', top: 0,
            background: 'var(--bg)', borderBottom: '1px solid var(--border)', font: 'var(--text-label)', color: 'var(--ink-tertiary)', zIndex: 1,
          }}>
            {visiblesCols.map(c => <div key={c.key} style={c.derecha ? { textAlign: 'right' } : undefined}>{c.label}</div>)}
          </div>
        )}
        {cotizaciones != null && visibles.length === 0 && !error && (
          <div style={{ padding: '24px 0', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
            {hayFiltro ? 'Ninguna cotización con esos filtros.' : 'Sin cotizaciones.'}
          </div>
        )}
        {visibles.map(c => (
          <Fila key={c.clave} c={c} isMobile={isMobile} grid={grid} columnas={visiblesCols.map(x => x.key)} onOpenOportunidad={onOpenOportunidad} onVer={setViendo} />
        ))}
        {/* Total de lo que deja ver el filtro, pegado abajo como en la Lista de OC. */}
        {visibles.length > 0 && (
          <div style={{
            position: 'sticky', bottom: 0, zIndex: 1, background: 'var(--bg)', borderTop: '1px solid var(--border)',
            marginTop: -1, padding: '10px 0', display: isMobile || !cols.visible('subtotal') ? 'flex' : 'grid', gridTemplateColumns: grid, gap: 12,
            justifyContent: 'space-between', alignItems: 'start', font: 'var(--text-label)', color: 'var(--ink-secondary)',
          }}>
            <div style={isMobile || !cols.visible('subtotal') ? undefined : { gridColumn: `1 / ${visiblesCols.findIndex(c => c.key === 'subtotal') + 1}` }}>
              Subtotal de {vigentes.length} {vigentes.length === 1 ? 'cotización vigente' : 'cotizaciones vigentes'}{hayFiltro ? ' (con los filtros de arriba)' : ''}
              {anteriores > 0 ? ` · ${anteriores} versiones anteriores no suman` : ''}
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

function Fila({ c, isMobile, grid, columnas, onOpenOportunidad, onVer }: {
  c: CotListaRow; isMobile: boolean; grid: string; columnas: string[];
  onOpenOportunidad: (id: string) => void; onVer: (url: string) => void;
}) {
  const anterior = !!c.reemplazadaPor;
  const folio = (
    <div style={{ minWidth: 0 }}>
      <MonoTag style={{ padding: 0 }}>{c.folio}</MonoTag>
      {anterior && (
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)', whiteSpace: 'nowrap' }} title={`Versión anterior: la vigente es ${c.reemplazadaPor}. No suma.`}>
          → {c.reemplazadaPor}
        </div>
      )}
    </div>
  );
  const fecha = (
    <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }} title={c.fecha ? 'Fecha impresa en la cotización' : undefined}>
      {c.fecha ? fmtFecha(c.fecha) : c.pdfLeido ? '—' : '…'}
    </div>
  );
  const cliente = (
    <div style={{ minWidth: 0 }}>
      <div style={{ font: 'var(--text-body)', color: anterior ? 'var(--ink-tertiary)' : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isMobile ? 'normal' : 'nowrap' }} title={c.institucion ?? undefined}>
        {c.institucion ?? SIN_CLIENTE}
      </div>
      {c.contacto && (
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.contacto}>{c.contacto}</div>
      )}
    </div>
  );
  const oportunidad = (
    <button
      onClick={() => onOpenOportunidad(c.oportunidadId)}
      title="Abrir la oportunidad"
      style={{
        ...botonLink, textAlign: 'left', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: isMobile ? 'normal' : 'nowrap',
      }}
    >
      {c.oportunidad}
      {c.tambienEn.length > 0 && (
        <span
          style={{ color: 'var(--ink-tertiary)' }}
          title={`El mismo PDF está también en: ${c.tambienEn.map(t => t.oportunidad).join(' · ')} (oportunidad duplicada). Es una sola cotización.`}
        >
          {' '}+ {c.tambienEn.map(t => t.oportunidadFolio ?? 'copia').join(', ')}
        </span>
      )}
    </button>
  );
  const subtotal = (
    <div
      style={{
        font: 'var(--text-body)', color: c.subtotal == null || anterior ? 'var(--ink-quiet)' : 'var(--ink)', textAlign: 'right',
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textDecoration: anterior && c.subtotal != null ? 'line-through' : undefined,
      }}
      title={anterior ? `No suma: la vigente es ${c.reemplazadaPor}.` : c.subtotal != null && c.total != null ? `IVA ${fmtMoney2(c.iva ?? 0)} · Total ${fmtMoney2(c.total)}` : c.pdfLeido ? 'El PDF no trae el bloque de totales.' : undefined}
    >
      {c.subtotal != null ? <>{fmtMoney2(c.subtotal)}{c.moneda && c.moneda !== 'MXN' ? <span style={{ color: 'var(--ink-tertiary)' }}> {c.moneda}</span> : null}</> : c.pdfLeido ? '—' : '…'}
    </div>
  );
  const pdfs = (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {c.url && <button onClick={() => onVer(c.url!)} style={botonLink}>Ver</button>}
      {c.urlFirmada && <button onClick={() => onVer(c.urlFirmada!)} style={{ ...botonLink, color: 'var(--status-ganada)' }} title="Firmada por el vendedor">Firmada</button>}
    </div>
  );
  const etiqueta = (t: string | null, vacio = '—') => (
    <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t ?? undefined}>{t ?? vacio}</div>
  );

  const celdas: Record<string, React.ReactNode> = {
    folio, fecha, cliente, oportunidad, subtotal, pdf: pdfs,
    vendedor: etiqueta(c.vendedor), zona: etiqueta(c.zona, SIN_ZONA), etapa: etiqueta(c.etapa),
  };

  if (isMobile) {
    return (
      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>{folio}{fecha}</div>
          {subtotal}
        </div>
        {cliente}
        {oportunidad}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>{[c.vendedor, c.zona ?? SIN_ZONA, c.etapa].filter(Boolean).join(' · ')}</div>
          {pdfs}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      {columnas.map(k => <Fragment key={k}>{celdas[k]}</Fragment>)}
    </div>
  );
}
