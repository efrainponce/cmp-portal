// Lista de Proyectos (post-venta) para los accesos del sidebar (Documentación y
// Tallas / Órdenes de Compra / Logística / Reporte de Proyectos) — agrupada por
// project_status o por Zona (selector "Agrupar" junto al buscador, guardado por
// persona; Efraín, 2026-09-07) y filtrada por config.statuses; sin `statuses`
// no se filtra nada. Fuente: board Proyectos directo, nunca vía el board_relation hacia la
// Oportunidad (Efraín, 2026-07-17 — ver dal.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBoards, usePoll, colForBoard, type ItemDTO } from '../../lib/api';
import { groupByColumn } from '../../lib/groupBy';
import { GroupCard } from '../../components/layout/GroupCard';
import { MonoTag, StatusBadge } from '../../components/core/Badges';
import { BoardStatus } from '../../components/board/BoardStatus';
import { SyncIndicator } from '../../components/board/SyncIndicator';
import { SearchInput } from '../../components/forms/SearchInput';
import { lastMondayUpdateFromItems } from '../../lib/syncStatus';
import { fmtSyncAgo } from '../../lib/format';
import { chipFor } from '../../components/board/cellHelpers';
import { statusIndex } from '../../lib/statusValue';
import { textIncludes } from '../../lib/textMatch';
import { PersonPair } from '../../components/core/PersonAvatar';
import { PROJECT_STATUS_ORDER, type ProjectBoardConfig } from '../../lib/projectStages';
import { useSavedView } from '../../lib/useSavedView';
import { useIsMobile } from '../../lib/useIsMobile';
import { batteryFromMirrorText } from '../../lib/estadoProductoBuckets';
import { ProgressBattery } from '../../components/board/ProgressBattery';
import { useMe } from '../../lib/useMe';
import { Button } from '../../components/core/Button';
import { FilePreviewModal } from '../../components/core/FilePreviewModal';
import type { TotalesDTO } from '../../../shared/dto';
import {
  TotalesCells, TotalesChips, TotalesGranTotal, TotalesGrupo, TotalesHeader,
  metricasVisibles, sumaTotales,
} from '../oportunidades/TotalesCells';
import {
  EstadoCuentaCells, EstadoCuentaChips, EstadoCuentaGranTotal, EstadoCuentaGrupo, EstadoCuentaHeader,
  ecMetricas, sumarResumenes,
} from './EstadoCuentaCells';
import { getEstadoCuentaResumen } from '../../lib/estadoCuentaApi';
import { getProyectoFiltros } from '../../lib/apiClient';
import type { ProyectoFiltrosDTO } from '../../../shared/dto';
import type { ResumenEstadoCuenta } from '../../../shared/estadoCuenta';

const FOLIO_COL = 'pulse_id_mm1a12gy';
const INSTITUCION_COL = 'lookup_mm1dwn6';
const FECHA_ENTREGA_COL = 'date_mm0m1vfv';
const VENDEDOR_COL = 'multiple_person_mm0hrnqq';
const COMPRAS_COL = 'project_owner';
const ESTADO_PRODUCTOS_COL = 'lookup_mm20g4n6';
const STATUS_COL = 'project_status';
const ZONA_COL = 'dropdown_mm0hnyv';

/** Criterios de agrupación de la lista. Reporte de Proyectos arranca por Zona
 * (así nació, Efraín 2026-08-05); los demás accesos por Estado, que es el
 * funnel del post-venta. */
type GroupBy = 'estado' | 'zona';
const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'estado', label: 'Estado' },
  { value: 'zona', label: 'Zona' },
];
function defaultGroupBy(config: ProjectBoardConfig): GroupBy {
  // Estado de Cuenta también por Zona: la pregunta ahí es "cuánto falta por
  // cobrar en tal plaza", no en qué etapa va la obra.
  return config.key === 'ejecucion' || config.key === 'estadocuenta' ? 'zona' : 'estado';
}
function parseGroupBy(raw: string | undefined, config: ProjectBoardConfig): GroupBy {
  return raw === 'zona' || raw === 'estado' ? raw : defaultGroupBy(config);
}

/** ¿El Vendedor del proyecto es uno de estos nombres? Sin lista, pasa todo.
 * Proyectos tiene UNA sola columna de dueño (shared/boards.ts authzCols), a
 * diferencia de Oportunidades (dueño + secundario), pero el texto del mirror
 * puede traer varias personas separadas por coma — se comparan todas. */
function vendedorNamesMatch(item: ItemDTO, names: string[] | undefined): boolean {
  if (!names || names.length === 0) return true;
  const wanted = names.map((n) => n.toUpperCase());
  return (item.cols[VENDEDOR_COL]?.text || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .some((v) => v && wanted.includes(v));
}

/** Las personas de una columna `people`: el texto del mirror las trae
 * separadas por coma. */
function personas(item: ItemDTO, col: string): string[] {
  return (item.cols[col]?.text || '').split(',').map((s) => s.trim()).filter(Boolean);
}

const TODOS = '';
const selectStyle: React.CSSProperties = {
  height: 36, font: 'var(--text-label)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '0 10px',
  boxSizing: 'border-box', background: 'var(--bg-raised)', cursor: 'pointer', maxWidth: '100%',
};

/** Una sola línea con puntos suspensivos — se usa donde el ancho ya está
 * comprometido por las columnas de métricas. */
const recorte: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

/** Tope del PDF de estatus — el mismo que ESTATUS_MAX_PROYECTOS del worker. */
const ESTATUS_PDF_MAX = 150;

function dedupeMirrorText(text: string): string {
  const parts = Array.from(new Set(text.split(',').map((s) => s.trim()).filter(Boolean)));
  return parts.length <= 2 ? parts.join(', ') : `${parts[0]} +${parts.length - 1}`;
}

/** Agrupa por Zona (dropdown, no status) — Ejecución se divide por zona geográfica
 * de entrega, no por etapa (Efraín, 2026-08-05). `groupByColumn` no aplica: está
 * hecho para columnas `status` (índice numérico), y Zona es un `dropdown` cuyo
 * value trae `{ids:[...]}`, no `{index}` — se agrupa directo por el texto ya
 * resuelto del serializer. Sin metadata de color para dropdowns, se usa un tono
 * neutro fijo para todos los grupos. */
function groupByZona(items: ItemDTO[]): { key: string; label: string; color: string; items: ItemDTO[] }[] {
  const map = new Map<string, ItemDTO[]>();
  for (const item of items) {
    const label = item.cols[ZONA_COL]?.text?.trim() || 'Sin zona';
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(item);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, groupItems]) => ({ key: label, label, color: '#7f8f78', items: groupItems }));
}

interface Props {
  config: ProjectBoardConfig;
  q: string;
  onSearch: (q: string) => void;
  onOpen: (id: string) => void;
  /** Se llama UNA vez, cuando la lista ya pintó datos. Lo usan los wrappers
   * para precargar el drawer sin estorbarle a la carga inicial. */
  onReady?: () => void;
  /** Botón/acción a la derecha del buscador (p.ej. "Nuevo proyecto") — mismo
   * contrato que StageBoardList. */
  headerAction?: React.ReactNode;
}

export function ProyectoBoardList({ config, q, onSearch, onOpen, onReady, headerAction }: Props) {
  const isMobile = useIsMobile();
  const { boards } = useBoards();
  const cols = colForBoard(boards, 'proyectos');
  const statusCol = cols.find((c) => c.id === STATUS_COL);
  const estadoProductosCol = cols.find((c) => c.id === ESTADO_PRODUCTOS_COL);
  const me = useMe();
  // Las seis cifras de la cotización por PROYECTO — lo mismo que ya pinta
  // Validación de Costeo por oportunidad (Efraín, 2026-08-27). Solo en el
  // Reporte de Proyectos y solo para admin: el worker vuelve a checar el rol
  // (worker/routes/boards.ts) y sin ese permiso ni siquiera calcula el mapa,
  // así que esto es nada más no pedir lo que no se va a recibir.
  const conTotales = config.key === 'ejecucion' && me?.role === 'admin';
  // Reporte de Proyectos (Efraín, 2026-09-21): filtros por Proveedor, Vendedor
  // y Compras, y buscador por folio — el del proyecto, el de la Oportunidad y
  // los de sus OC. Aquí la búsqueda es SOLO del cliente (como en Lista de OC):
  // el `q` del server busca en columnas del proyecto, y ni el proveedor ni el
  // folio de la OC ni el OPP viven ahí — mandarlo devolvía cero filas antes de
  // que el cliente pudiera empatar nada. Los filtros NO se guardan entre
  // sesiones, igual que en Lista de OC: uno recordado deja la lista en 0.
  const conFiltros = config.key === 'ejecucion';
  const { status, data } = usePoll('proyectos', conFiltros ? '' : q, undefined, conTotales);
  const [extras, setExtras] = useState<Record<string, ProyectoFiltrosDTO>>({});
  useEffect(() => {
    if (!conFiltros) return;
    let vivo = true;
    const cargar = (desdeCero = false) => {
      getProyectoFiltros(desdeCero).then((r) => { if (vivo && r) setExtras(r); }).catch(() => {});
    };
    cargar(true);
    const t = setInterval(() => { if (!document.hidden) cargar(); }, 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, [conFiltros]);
  const [proveedor, setProveedor] = useState(TODOS);
  const [vendedorF, setVendedorF] = useState(TODOS);
  const [comprasF, setComprasF] = useState(TODOS);
  // Board "Estado de Cuenta" (Efraín, 2026-09-08): el resumen de cobros y
  // pagos de cada proyecto, en UNA consulta agregada aparte de la lista (no
  // viaja en /items: es otra fuente, D1 nativa, y solo para la whitelist).
  // Se pide al montar y se refresca cada 30 s — es lo que se suma por zona.
  const esEstadoCuenta = config.key === 'estadocuenta';
  const [ecResumen, setEcResumen] = useState<Record<string, ResumenEstadoCuenta> | null>(null);
  useEffect(() => {
    if (!esEstadoCuenta || !me?.estadoCuentaAccess) return;
    let vivo = true;
    const cargar = () => { getEstadoCuentaResumen().then((r) => { if (vivo) setEcResumen(r); }).catch(() => {}); };
    cargar();
    const t = setInterval(cargar, 30_000);
    return () => { vivo = false; clearInterval(t); };
  }, [esEstadoCuenta, me?.estadoCuentaAccess]);

  // Igual que StageBoardList: avisa una sola vez que ya hay datos pintados,
  // para que el wrapper precargue el drawer sin estorbarle a esta carga.
  const avisado = useRef(false);
  useEffect(() => {
    if (avisado.current || status !== 'ready') return;
    avisado.current = true;
    onReady?.();
  }, [status, onReady]);
  const allItems = data?.items ?? [];
  const statusItems = allItems
    .filter((it) => !config.statuses || config.statuses.includes(statusIndex(it.cols[STATUS_COL])))
    .filter((it) => vendedorNamesMatch(it, config.vendedorNames));
  const sync = lastMondayUpdateFromItems(statusItems);

  const { collapsedGroups, toggleGroup, groupBy: groupBySaved, setGroupBy } = useSavedView(config.key);
  const groupBy = parseGroupBy(groupBySaved, config);

  // Filtro de Zona (Efraín, 2026-09-21): existe para sacar el PDF de estatus
  // "por zona o vendedor". Como los demás filtros, no se guarda entre sesiones.
  const [zonaFiltro, setZonaFiltro] = useState(TODOS);
  const [estatusPdf, setEstatusPdf] = useState<string | null>(null);
  const zonas = useMemo(
    () => [...new Set(statusItems.map((it) => it.cols[ZONA_COL]?.text?.trim() || '').filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [statusItems],
  );

  // Opciones de cada filtro = lo que hay en la lista. Un filtro sin opciones
  // no se pinta (a ventas no le llegan ni Compras ni proveedores).
  const opciones = useMemo(() => {
    const orden = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
    const prov = new Set<string>(), vend = new Set<string>(), comp = new Set<string>();
    if (conFiltros) for (const it of statusItems) {
      extras[it.id]?.proveedores.forEach((p) => prov.add(p));
      personas(it, VENDEDOR_COL).forEach((p) => vend.add(p));
      personas(it, COMPRAS_COL).forEach((p) => comp.add(p));
    }
    return { proveedores: orden(prov), vendedores: orden(vend), compras: orden(comp) };
  }, [conFiltros, statusItems, extras]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cada palabra del buscador tiene que aparecer, en cualquier campo y orden
  // (misma regla que el `q` del server, worker/lib/dal.ts searchTokens).
  const palabras = q.trim().split(/\s+/).filter(Boolean);
  const items = statusItems.filter((it) => {
    if (zonaFiltro !== TODOS && (it.cols[ZONA_COL]?.text?.trim() || '') !== zonaFiltro) return false;
    if (conFiltros) {
      if (proveedor !== TODOS && !extras[it.id]?.proveedores.includes(proveedor)) return false;
      if (vendedorF !== TODOS && !personas(it, VENDEDOR_COL).includes(vendedorF)) return false;
      if (comprasF !== TODOS && !personas(it, COMPRAS_COL).includes(comprasF)) return false;
    }
    if (palabras.length === 0) return true;
    const haystack = [
      it.name,
      it.cols[INSTITUCION_COL]?.text,
      it.cols[FOLIO_COL]?.text,
      it.cols[VENDEDOR_COL]?.text,
      ...(conFiltros ? [
        it.oportunidad?.folio,
        it.cols[COMPRAS_COL]?.text,
        ...(extras[it.id]?.proveedores ?? []),
        ...(extras[it.id]?.ocs ?? []),
      ] : []),
    ].filter(Boolean).join(' ');
    return palabras.every((p) => textIncludes(haystack, p));
  });
  const hayFiltro = proveedor !== TODOS || vendedorF !== TODOS || comprasF !== TODOS || zonaFiltro !== TODOS;

  const groups = groupBy === 'zona'
    ? groupByZona(items)
    : groupByColumn(items, statusCol, undefined, undefined, PROJECT_STATUS_ORDER);

  const totales = data?.totales;
  const metricas = useMemo(() => metricasVisibles(totales, isMobile), [totales, isMobile]);
  // Suma por zona y gran total (Efraín, 2026-08-27). Se calculan sobre los
  // proyectos ya FILTRADOS (búsqueda incluida), no sobre el board completo: el
  // total tiene que ser el de lo que se está viendo.
  const granTotal = useMemo(
    () => (metricas.length ? sumaTotales(items.map((it) => totales?.[it.id])) : null),
    [metricas.length, items, totales],
  );
  const ecCols = useMemo(() => (esEstadoCuenta ? ecMetricas(isMobile) : []), [esEstadoCuenta, isMobile]);
  // Suma por grupo y gran total del Estado de cuenta, sobre lo FILTRADO (igual
  // que las métricas de costeo): un proyecto sin movimientos no aporta nada.
  // Sin un solo proyecto con movimientos, undefined: guiones, no ceros.
  const sumaEc = (lista: ItemDTO[]): ResumenEstadoCuenta | undefined => {
    const partes = lista.map((it) => ecResumen?.[it.id]).filter((r): r is ResumenEstadoCuenta => !!r);
    return partes.length ? sumarResumenes(partes) : undefined;
  };
  const ecGranTotal = useMemo(() => (esEstadoCuenta ? sumaEc(items) : undefined), [esEstadoCuenta, items, ecResumen]); // eslint-disable-line react-hooks/exhaustive-deps
  const hayHeader = !isMobile && (metricas.length > 0 || esEstadoCuenta);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: isMobile ? '14px 14px 12px' : '26px 32px 16px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ font: 'var(--text-title)', color: 'var(--ink)' }}>{config.title}</div>
          {headerAction}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>
            {hayFiltro || (conFiltros && palabras.length > 0) ? `${items.length} de ${statusItems.length}` : items.length} proyectos
          </div>
          <SyncIndicator syncedAt={sync.updatedAt} pending={sync.pending} label="actualizado" />
        </div>
        <div style={{ marginTop: isMobile ? 10 : 14, display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 10, flexWrap: 'wrap' }}>
          <SearchInput
            value={q}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={conFiltros ? 'Buscar proyecto, folio (PRO, OPP u OC), proveedor…' : 'Buscar proyecto, folio o institución…'}
            style={isMobile ? { maxWidth: '100%', flexBasis: '100%' } : undefined}
          />
          {/* Mismo look que los selects de FilterBar (StageBoardList). Al
              agrupar por Zona, el renglón pinta la etapa (ver Row.statusCol):
              si no, no habría dónde leer en qué paso va cada proyecto. */}
          <select
            aria-label="Agrupar por"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            style={selectStyle}
          >
            {GROUP_BY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>Agrupar: {o.label}</option>
            ))}
          </select>
          {zonas.length > 0 && (
            <select aria-label="Zona" value={zonaFiltro} onChange={(e) => setZonaFiltro(e.target.value)} style={selectStyle}>
              <option value={TODOS}>Zona: todas</option>
              {zonas.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          )}
          {opciones.proveedores.length > 0 && (
            <select aria-label="Proveedor" value={proveedor} onChange={(e) => setProveedor(e.target.value)} style={{ ...selectStyle, maxWidth: isMobile ? '100%' : 260 }}>
              <option value={TODOS}>Proveedor: todos</option>
              {opciones.proveedores.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {opciones.vendedores.length > 0 && (
            <select aria-label="Vendedor" value={vendedorF} onChange={(e) => setVendedorF(e.target.value)} style={selectStyle}>
              <option value={TODOS}>Vendedor: todos</option>
              {opciones.vendedores.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {opciones.compras.length > 0 && (
            <select aria-label="Compras" value={comprasF} onChange={(e) => setComprasF(e.target.value)} style={selectStyle}>
              <option value={TODOS}>Compras: todos</option>
              {opciones.compras.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {hayFiltro && (
            <button
              type="button"
              onClick={() => { setProveedor(TODOS); setVendedorF(TODOS); setComprasF(TODOS); setZonaFiltro(TODOS); }}
              style={{ font: 'var(--text-label)', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}
            >
              Quitar filtros
            </button>
          )}
          {items.length > 0 && (
            <Button
              variant={items.length > ESTATUS_PDF_MAX ? 'disabled' : 'secondary'}
              style={{ height: 36, padding: '0 14px', font: 'var(--text-label)' }}
              title={items.length > ESTATUS_PDF_MAX
                ? `Máximo ${ESTATUS_PDF_MAX} proyectos por PDF — filtra por zona o vendedor`
                : `Resumen imprimible de los ${items.length} proyectos en pantalla: un renglón por producto y color`}
              onClick={() => {
                const alcance = [
                  zonaFiltro !== TODOS && `Zona ${zonaFiltro}`, vendedorF !== TODOS && vendedorF,
                  comprasF !== TODOS && comprasF, proveedor !== TODOS && proveedor, q.trim() && `"${q.trim()}"`,
                ].filter(Boolean).join(' · ') || config.title;
                const qs = new URLSearchParams({ ids: items.map((it) => it.id).join(','), alcance });
                setEstatusPdf(`/api/proyectos-estatus/pdf?${qs.toString()}`);
              }}
            >
              Estatus PDF ({items.length})
            </Button>
          )}
        </div>
      </div>

      {/* Igual que StageBoardList: cuando el encabezado de métricas existe, el
          padding de arriba se lo lleva él (es sticky y tiene que llegar al
          borde, o las filas se le asoman por encima al hacer scroll). */}
      <div style={{ overflowY: 'auto', padding: isMobile ? '12px 0 16px' : `${hayHeader ? 0 : 16}px 0 24px`, flex: 1 }}>
        <BoardStatus status={status}>
          <TotalesHeader metricas={metricas} isMobile={isMobile} />
          {esEstadoCuenta && <EstadoCuentaHeader metricas={ecCols} isMobile={isMobile} />}
          {groups.length === 0 && (
            <div style={{ padding: 24, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
              {hayFiltro || palabras.length > 0 ? 'Ningún proyecto con esos filtros.' : 'Sin proyectos.'}
            </div>
          )}
          {groups.map((g) => (
            <GroupCard
              key={g.key} label={g.label} color={g.color} tint={g.color + '22'} count={g.items.length}
              collapsed={!!collapsedGroups[g.key]} onToggleCollapsed={() => toggleGroup(g.key)}
              headerRight={metricas.length > 0 ? (
                <TotalesGrupo
                  totales={sumaTotales(g.items.map((it) => totales?.[it.id]))}
                  metricas={metricas} isMobile={isMobile}
                />
              ) : esEstadoCuenta ? (
                <EstadoCuentaGrupo resumen={sumaEc(g.items)} metricas={ecCols} isMobile={isMobile} />
              ) : undefined}
            >
              {g.items.map((item) => (
                <Row
                  key={item.id} item={item} estadoProductosCol={estadoProductosCol}
                  showBattery={config.key === 'ejecucion'}
                  statusCol={groupBy === 'zona' ? statusCol : undefined}
                  totales={totales?.[item.id]} metricas={metricas}
                  ecResumen={esEstadoCuenta ? ecResumen?.[item.id] : undefined} ecCols={ecCols}
                  onClick={() => onOpen(item.id)}
                />
              ))}
            </GroupCard>
          ))}
          {granTotal && groups.length > 0 && (
            <TotalesGranTotal totales={granTotal} metricas={metricas} isMobile={isMobile} />
          )}
          {ecGranTotal && groups.length > 0 && (
            <EstadoCuentaGranTotal resumen={ecGranTotal} metricas={ecCols} isMobile={isMobile} />
          )}
        </BoardStatus>
      </div>
      {estatusPdf && (
        <FilePreviewModal url={estatusPdf} name="Estatus de proyectos.pdf" onClose={() => setEstatusPdf(null)} />
      )}
    </div>
  );
}

function Row({ item, estadoProductosCol, showBattery, statusCol, totales, metricas, ecResumen, ecCols, onClick }: {
  item: ItemDTO; estadoProductosCol?: ReturnType<typeof colForBoard>[number]; showBattery: boolean;
  /** Métricas de la cotización de la Oportunidad ligada — solo el Reporte de
   * Proyectos las recibe (y solo para admin). Ausentes = proyecto sin
   * oportunidad, o sin líneas todavía: las celdas se pintan en "—" para no
   * romper la columna, igual que en Validación de Costeo. */
  totales?: TotalesDTO; metricas: ReturnType<typeof metricasVisibles>;
  /** Solo llega al agrupar por Zona (y no por etapa): ahí el renglón es el
   * único lugar donde se puede leer en qué etapa va el proyecto — sin esto, un
   * "Proyecto Terminado" se ve igual que uno en Ejecución (Efraín, 2026-08-14). */
  statusCol?: ReturnType<typeof colForBoard>[number];
  /** Cobrado / por cobrar / pagado / por pagar / saldo del proyecto — solo en
   * el board Estado de Cuenta. `ecCols` vacío = no se pintan. */
  ecResumen?: ResumenEstadoCuenta; ecCols: ReturnType<typeof ecMetricas>;
  onClick: () => void;
}) {
  const isMobile = useIsMobile();
  const institucion = item.cols[INSTITUCION_COL]?.text || '—';
  const folio = item.cols[FOLIO_COL]?.text || '—';
  // Folio de la Oportunidad ligada junto al del proyecto (Efraín, 2026-09-10:
  // "que se vea la oportunidad ligada así OPP-XXX") — lo cruza el worker
  // (worker/lib/oportunidadLigada.ts).
  const oppFolio = item.oportunidad?.folio;
  const fechaEntrega = item.cols[FECHA_ENTREGA_COL]?.text;
  const vendedor = item.cols[VENDEDOR_COL]?.text || undefined;
  const estadoVal = estadoProductosCol ? item.cols[estadoProductosCol.id] : undefined;
  const battery = showBattery ? batteryFromMirrorText(estadoVal?.text) : null;
  const etapaVal = statusCol ? item.cols[statusCol.id] : undefined;
  const etapa = statusCol && etapaVal?.text ? chipFor(statusCol, etapaVal) : null;
  const conMetricas = metricas.length > 0 || ecCols.length > 0;

  if (isMobile) {
    return (
      <div
        className="row-hover"
        onClick={onClick}
        style={{
          display: 'flex', flexDirection: 'column', gap: 4,
          padding: '12px 14px', background: '#fff', borderTop: '1px solid var(--border-subtle)', cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)', minWidth: 0 }}>{item.name}</div>
          <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
            {oppFolio && <MonoTag>{oppFolio}</MonoTag>}
            <MonoTag>{folio}</MonoTag>
          </div>
        </div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>{institucion}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
          {etapa && <StatusBadge label={etapa.label} color={etapa.color} tint={etapa.tint} />}
          <PersonPair vendedor={vendedor} />
          {battery && <div style={{ flex: 1, minWidth: 80 }}><ProgressBattery data={battery} /></div>}
          {!battery && estadoVal?.text && (() => {
            const { color, tint } = chipFor(estadoProductosCol!, estadoVal);
            return <StatusBadge label={dedupeMirrorText(estadoVal.text)} color={color} tint={tint} />;
          })()}
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)', marginLeft: battery ? undefined : 'auto' }}>
            {fechaEntrega ? `Entrega ${fechaEntrega}` : item.mondayUpdatedAt ? fmtSyncAgo(item.mondayUpdatedAt) : '—'}
          </div>
        </div>
        <TotalesChips totales={totales} metricas={metricas} />
        {ecCols.length > 0 && <EstadoCuentaChips resumen={ecResumen} metricas={ecCols} />}
      </div>
    );
  }

  return (
    <div
      className="row-hover"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        padding: '3px 18px', background: '#fff', borderTop: '1px solid var(--border-subtle)', cursor: 'pointer',
      }}
    >
      {/* Con las métricas a la derecha (Reporte de Proyectos) el nombre se queda
          con ~120 px y los proyectos de nombre largo — que aquí son casi todos:
          "Uniformes 5.11 Policía - Ocuilan - OPP-0450 (copy)" — reventaban el
          renglón en ocho líneas. Se recorta con puntos suspensivos y el nombre
          completo queda en el `title` (Efraín, 2026-08-27). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: battery || conMetricas ? 1 : 'none' }}>
        <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)', ...recorte }} title={item.name}>{item.name}</div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', ...recorte }} title={institucion}>{institucion}</div>
      </div>
      {battery && (
        <div
          className={conMetricas ? 'reporte-solo-ancho' : undefined}
          style={{ width: conMetricas ? 110 : 160, flex: 'none' }}
        >
          <ProgressBattery data={battery} />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 'none' }}>
        {etapa && (
          <StatusBadge
            label={etapa.label} color={etapa.color} tint={etapa.tint}
            style={{ width: 168, justifyContent: 'center', display: 'flex' }}
          />
        )}
        <PersonPair vendedor={vendedor} />
        {!battery && estadoVal?.text && (() => {
          const { color, tint } = chipFor(estadoProductosCol!, estadoVal);
          return <StatusBadge label={dedupeMirrorText(estadoVal.text)} color={color} tint={tint} />;
        })()}
        {/* Con métricas, la fecha va en una columna de ancho fijo aunque esté
            vacía: si no, los proyectos con entrega capturada recorren el nombre
            de los que no la tienen y cada renglón se corta en un punto distinto. */}
        {conMetricas ? (
          <div className="reporte-solo-ancho" style={{ width: 118, flex: 'none', textAlign: 'right', font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
            {fechaEntrega ? `Entrega ${fechaEntrega}` : ''}
          </div>
        ) : fechaEntrega ? (
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>Entrega {fechaEntrega}</div>
        ) : null}
        {/* Sin oportunidad (proyecto hecho desde cero, o una que el viewer no
            ve) se guarda el hueco: si no, la fecha y la etapa de ese renglón se
            recorren y dejan de caer en columna con las de los demás. */}
        <MonoTag style={oppFolio ? undefined : { visibility: 'hidden' }}>{oppFolio || 'OPP-0000'}</MonoTag>
        <MonoTag>{folio}</MonoTag>
        <TotalesCells totales={totales} metricas={metricas} />
        {ecCols.length > 0 && <EstadoCuentaCells resumen={ecResumen} metricas={ecCols} />}
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)', width: 70, textAlign: 'right' }}>
          {item.mondayUpdatedAt ? fmtSyncAgo(item.mondayUpdatedAt) : '—'}
        </div>
      </div>
    </div>
  );
}
