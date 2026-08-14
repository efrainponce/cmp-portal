// Shared list view for every stage-filtered Oportunidades destination
// (Oportunidades, Costeo, Validación Costeo, Documentación y Tallas, Órdenes
// de Compra, Logística) — same row template as Board Costeo/Validacion in the
// design, just a different deal_stage filter + grouping column per board.
import { memo, useEffect, useMemo, useRef } from 'react';
import { useBoards, usePoll, colForBoard, type ItemDTO } from '../../lib/api';
import { useMe } from '../../lib/useMe';
import { groupByColumn } from '../../lib/groupBy';
import { GroupCard } from '../../components/layout/GroupCard';
import { StatusBadge, MonoTag } from '../../components/core/Badges';
import { BoardStatus } from '../../components/board/BoardStatus';
import { SyncIndicator } from '../../components/board/SyncIndicator';
import { SearchInput } from '../../components/forms/SearchInput';
import { FilterBar, ALL_VALUE, type FilterOption } from '../../components/forms/FilterBar';
import { lastMondayUpdateFromItems } from '../../lib/syncStatus';
import { fmtSyncAgo } from '../../lib/format';
import { chipFor } from '../../components/board/cellHelpers';
import { statusIndex } from '../../lib/statusValue';
import { textIncludes } from '../../lib/textMatch';
import { PersonPair } from '../../components/core/PersonAvatar';
import { DEAL_STAGE_LABELS, DEAL_STAGE_ORDER, type StageBoardConfig } from '../../lib/dealStages';
import { useSavedView } from '../../lib/useSavedView';
import { useIsMobile } from '../../lib/useIsMobile';

/** Mirror columns fan in one value per subitem, so `text` can be a long
 * comma-joined repeat (e.g. "Listo, Listo, Listo"). Collapse to the
 * distinct values for a readable row chip. */
function dedupeMirrorText(text: string): string {
  const parts = Array.from(new Set(text.split(',').map((s) => s.trim()).filter(Boolean)));
  return parts.length <= 2 ? parts.join(', ') : `${parts[0]} +${parts.length - 1}`;
}

const FOLIO_COL = 'pulse_id_mm0qcq0m';
const INSTITUCION_COL = 'lookup_mm1bs976';
const ETAPA_COSTEO_COL = 'lookup_mm087at6';
const VENDEDOR_COL = 'deal_owner';
const COMPRAS_COL = 'multiple_person_mm03qyw9';
const VENDEDOR_SECUNDARIO_COL = 'multiple_person_mm0wt53c';
const CONTACTO_COL = 'deal_contact';
const ETAPA_COL = 'deal_stage';

// Las ÚNICAS columnas que esta lista lee — de renglón, de filtros y de
// agrupación. Se le pasan a usePoll para que el worker no mande las ~34 que
// trae cada oportunidad: medido, la respuesta completa eran 2.15 MB (158 KB
// gz) por 628 items y se re-bajaba cada vez que cualquier item se sincronizaba.
//
// Si agregas algo que lea otra columna de `item.cols` en este archivo, agrégala
// AQUÍ también o llegará vacía. `name`, `group` y `mondayUpdatedAt` no van en
// la lista: son campos propios del item, no columnas, y siempre viajan.
const LIST_COLS = [
  FOLIO_COL, INSTITUCION_COL, ETAPA_COSTEO_COL, VENDEDOR_COL,
  COMPRAS_COL, VENDEDOR_SECUNDARIO_COL, CONTACTO_COL, ETAPA_COL,
] as const;

/** El viewer ve este item por estar como "Vendedor secundario" ahí, no por ser
 * el dueño (deal_owner) ni por su zona — worker/lib/zonas.ts amplía lectura por
 * AMBAS columnas (shared/boards.ts authzCols), así que a un vendedor le puede
 * aparecer una oportunidad ajena sin más contexto que este. false si el viewer
 * aún no cargó (useMe) — nunca marcamos de más mientras tanto. */
function isSecondaryFor(item: ItemDTO, viewerNombre: string | undefined): boolean {
  if (!viewerNombre) return false;
  const owner = item.cols[VENDEDOR_COL]?.text?.trim();
  if (owner === viewerNombre) return false;
  const secundarios = (item.cols[VENDEDOR_SECUNDARIO_COL]?.text || '').split(',').map((s) => s.trim());
  return secundarios.includes(viewerNombre);
}

/** ¿El Vendedor o Vendedor secundario del item es uno de estos nombres? Usado
 * por 'zona_efrain' (config.vendedorNames) — mismo criterio de "dueño" que
 * shared/boards.ts authzCols/dal.ts vendedor_ids (ambas columnas cuentan). */
function vendedorNamesMatch(item: ItemDTO, names: string[]): boolean {
  const wanted = names.map((n) => n.toUpperCase());
  const owner = item.cols[VENDEDOR_COL]?.text?.trim().toUpperCase();
  if (owner && wanted.includes(owner)) return true;
  const secundarios = (item.cols[VENDEDOR_SECUNDARIO_COL]?.text || '').split(',').map((s) => s.trim().toUpperCase());
  return secundarios.some((s) => wanted.includes(s));
}

/** Distinct, sorted option list for a filter select, built from the text of
 * one column across the loaded items (skips blanks). */
function optionsFromCol(items: ItemDTO[], colId: string): FilterOption[] {
  const seen = new Set<string>();
  for (const it of items) {
    const text = it.cols[colId]?.text?.trim();
    if (text) seen.add(text);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, 'es')).map((v) => ({ value: v, label: v }));
}

/** Como optionsFromCol, pero para Vendedor: marca "(secundario)" cuando TODOS
 * los items de ese dueño le llegan al viewer solo por estar tageado como
 * Vendedor secundario ahí (isSecondaryFor) — nunca por ser suyo ni de su
 * zona. El value sigue siendo el nombre limpio: no debe romper el filtrado
 * por texto exacto contra item.cols[VENDEDOR_COL]. */
function vendedorOptionsFromItems(items: ItemDTO[], viewerNombre: string | undefined): FilterOption[] {
  const allSecondary = new Map<string, boolean>();
  for (const it of items) {
    const text = it.cols[VENDEDOR_COL]?.text?.trim();
    if (!text) continue;
    const secondary = isSecondaryFor(it, viewerNombre);
    const prev = allSecondary.get(text);
    allSecondary.set(text, prev === undefined ? secondary : prev && secondary);
  }
  return Array.from(allSecondary.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'es'))
    .map(([value, secondary]) => ({ value, label: secondary ? `${value} (secundario)` : value }));
}

/** Etapa options, restricted to stages actually present in the loaded items
 * and ordered per the real pipeline (DEAL_STAGE_ORDER). */
function stageOptionsFromItems(items: ItemDTO[]): FilterOption[] {
  const present = new Set(items.map((it) => statusIndex(it.cols[ETAPA_COL])));
  return DEAL_STAGE_ORDER.filter((k) => present.has(k)).map((k) => ({ value: k, label: DEAL_STAGE_LABELS[k] ?? k }));
}

interface Props {
  config: StageBoardConfig;
  groupColId?: string;
  q: string;
  onSearch: (q: string) => void;
  onOpen: (id: string) => void;
  /** Se llama UNA vez, cuando la lista ya pintó datos. Lo usan los wrappers
   * para precargar el drawer sin estorbarle a la carga inicial. */
  onReady?: () => void;
  /** Botón/acción a la derecha del buscador (p.ej. "Nueva oportunidad"). */
  headerAction?: React.ReactNode;
}

export function StageBoardList({ config, groupColId = 'deal_stage', q, onSearch, onOpen, onReady, headerAction }: Props) {
  const isMobile = useIsMobile();
  const viewerNombre = useMe()?.nombre;
  const { boards } = useBoards();
  const cols = colForBoard(boards, 'oportunidades');
  const groupCol = cols.find((c) => c.id === groupColId);
  const etapaCosteoCol = cols.find((c) => c.id === ETAPA_COSTEO_COL);
  // groupColId es configurable por board (StageBoardConfig): si agrupa por una
  // columna fuera de LIST_COLS hay que pedirla también, o el group card se
  // quedaría sin etiqueta.
  const pollCols = useMemo(
    () => (LIST_COLS.includes(groupColId as typeof LIST_COLS[number]) ? LIST_COLS : [...LIST_COLS, groupColId]),
    [groupColId],
  );
  const { status, data } = usePoll('oportunidades', q, pollCols);

  // Avisa UNA vez que ya hay datos en pantalla. El wrapper lo usa para
  // precargar el drawer: antes de esto la lista no compite con nada.
  const avisado = useRef(false);
  useEffect(() => {
    if (avisado.current || status !== 'ready') return;
    avisado.current = true;
    onReady?.();
  }, [status, onReady]);
  // Memoizado sobre data.items: el poll de 5 s re-renderiza este componente y
  // antes esta cadena de filtros corría de nuevo sobre los 628 items en CADA
  // render, devolviendo siempre un array nuevo. Eso además rompía los useMemo
  // de abajo (los tenían como dependencia, así que nunca acertaban) y forzaba
  // a re-renderizar los 628 renglones. Cuando el poll contesta 304, usePoll no
  // toca el estado, así que `data.items` conserva identidad y aquí no se
  // recalcula nada.
  const stageItems = useMemo(() => {
    const all = data?.items ?? [];
    return all
      .filter((it) => !config.stages || config.stages.includes(statusIndex(it.cols.deal_stage)))
      .filter((it) => !config.excludeStages || !config.excludeStages.includes(statusIndex(it.cols.deal_stage)))
      .filter((it) => !config.namePrefix || it.name.trim().toUpperCase().startsWith(config.namePrefix.toUpperCase()))
      .filter((it) => !config.vendedorNames || vendedorNamesMatch(it, config.vendedorNames));
  }, [data?.items, config]);
  const sync = useMemo(() => lastMondayUpdateFromItems(stageItems), [stageItems]);

  // Filter + collapsed-etapa state lives here, not in the wrapper — these
  // three selects only narrow what's already loaded, they never touch the
  // server request. Persisted per viewer (useSavedView) so it's still there
  // next time they open this board.
  const { filters, setFilters, collapsedGroups, toggleGroup, clearFilters: clearSavedFilters } = useSavedView(config.key);
  const vendedorFilter = filters.vendedor;
  const comprasFilter = filters.compras;
  const etapaFilter = filters.etapa;
  const setVendedorFilter = (v: string) => setFilters((f) => ({ ...f, vendedor: v }));
  const setComprasFilter = (v: string) => setFilters((f) => ({ ...f, compras: v }));
  const setEtapaFilter = (v: string) => setFilters((f) => ({ ...f, etapa: v }));
  const showEtapaFilter = !config.stages || config.stages.length > 1;

  const vendedorOptions = useMemo(() => vendedorOptionsFromItems(stageItems, viewerNombre), [stageItems, viewerNombre]);
  const comprasOptions = useMemo(() => optionsFromCol(stageItems, COMPRAS_COL), [stageItems]);
  const etapaOptions = useMemo(() => stageOptionsFromItems(stageItems), [stageItems]);

  // Instant client-side narrowing on top of whatever the server already
  // returned for `q` — covers columns the server search doesn't (yet) hit,
  // and doesn't wait for the next 5s poll.
  const items = useMemo(() => stageItems.filter((it) => {
    if (vendedorFilter !== ALL_VALUE && (it.cols[VENDEDOR_COL]?.text || '') !== vendedorFilter) return false;
    if (comprasFilter !== ALL_VALUE && (it.cols[COMPRAS_COL]?.text || '') !== comprasFilter) return false;
    if (etapaFilter !== ALL_VALUE && statusIndex(it.cols[ETAPA_COL]) !== etapaFilter) return false;
    if (!q.trim()) return true;
    const haystack = [
      it.name,
      it.cols[INSTITUCION_COL]?.text,
      it.cols[FOLIO_COL]?.text,
      it.cols[VENDEDOR_COL]?.text,
      it.cols[COMPRAS_COL]?.text,
      it.cols[CONTACTO_COL]?.text,
    ].filter(Boolean).join(' ');
    return textIncludes(haystack, q);
  }), [stageItems, vendedorFilter, comprasFilter, etapaFilter, q]);

  const hasActiveFilters = vendedorFilter !== ALL_VALUE || comprasFilter !== ALL_VALUE || etapaFilter !== ALL_VALUE;
  const clearFilters = clearSavedFilters;

  const groups = useMemo(() => {
    const order = groupColId === 'deal_stage' ? DEAL_STAGE_ORDER : undefined;
    return groupByColumn(items, groupCol, undefined, undefined, order);
  }, [items, groupCol, groupColId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: isMobile ? '14px 14px 12px' : '26px 32px 16px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ font: 'var(--text-title)', color: 'var(--ink)' }}>{config.title}</div>
          {headerAction}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>
            {items.length} activas{config.subtitleSuffix}
          </div>
          <SyncIndicator syncedAt={sync.updatedAt} pending={sync.pending} label="actualizado" />
        </div>
        <div style={{ marginTop: isMobile ? 10 : 14, display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 10, flexWrap: 'wrap' }}>
          <SearchInput
            value={q}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Buscar cliente, vendedor o compras…"
            style={isMobile ? { maxWidth: '100%', flexBasis: '100%' } : undefined}
          />
          <FilterBar
            vendedor={vendedorFilter} onVendedorChange={setVendedorFilter} vendedorOptions={vendedorOptions}
            compras={comprasFilter} onComprasChange={setComprasFilter} comprasOptions={comprasOptions}
            etapa={showEtapaFilter ? etapaFilter : undefined}
            onEtapaChange={showEtapaFilter ? setEtapaFilter : undefined}
            etapaOptions={showEtapaFilter ? etapaOptions : undefined}
            active={hasActiveFilters}
            onClear={clearFilters}
          />
        </div>
      </div>

      <div style={{ overflowY: 'auto', padding: isMobile ? '12px 0 16px' : '16px 0 24px', flex: 1 }}>
        <BoardStatus status={status}>
          {groups.length === 0 && (
            <div style={{ padding: 24, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin oportunidades.</div>
          )}
          {groups.map((g) => (
            <GroupCard
              key={g.key} label={g.label} color={g.color} tint={g.color + '22'} count={g.items.length}
              collapsed={!!collapsedGroups[g.key]} onToggleCollapsed={() => toggleGroup(g.key)}
            >
              {g.items.map((item) => (
                // onOpen (no una arrow nueva por renglón): Row está memoizado y
                // una closure distinta en cada render le rompería la memo.
                <Row key={item.id} item={item} etapaCosteoCol={etapaCosteoCol} viewerNombre={viewerNombre} onOpen={onOpen} />
              ))}
            </GroupCard>
          ))}
        </BoardStatus>
      </div>
    </div>
  );
}

/** memo: la lista puede traer cientos de renglones y el poll de 5 s vuelve a
 * renderizar el board completo. Sin esto, cada refresco re-renderizaba los 628
 * renglones aunque no hubiera cambiado ninguno — el costo que más se nota en
 * las máquinas lentas. Con `items` memoizado arriba, los objetos `item`
 * conservan identidad entre polls y esta comparación por props corta el
 * re-render de raíz. */
const Row = memo(function Row({ item, etapaCosteoCol, viewerNombre, onOpen }: {
  item: ItemDTO; etapaCosteoCol?: ReturnType<typeof colForBoard>[number]; viewerNombre: string | undefined; onOpen: (id: string) => void;
}) {
  const isMobile = useIsMobile();
  const onClick = () => onOpen(item.id);
  const institucion = item.cols[INSTITUCION_COL]?.text || '—';
  const folio = item.cols[FOLIO_COL]?.text || '—';
  const etapaCosteoVal = etapaCosteoCol ? item.cols[etapaCosteoCol.id] : undefined;
  const vendedor = item.cols[VENDEDOR_COL]?.text || undefined;
  const compras = item.cols[COMPRAS_COL]?.text || undefined;
  const vendedorSecondary = isSecondaryFor(item, viewerNombre);

  // En cel el renglón se apila: nombre+folio arriba, institución debajo y los
  // chips en su propia línea — nada se corta ni exige scroll horizontal.
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
          <MonoTag>{folio}</MonoTag>
        </div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>{institucion}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
          <PersonPair vendedor={vendedor} compras={compras} vendedorSecondary={vendedorSecondary} />
          {etapaCosteoVal?.text && (() => {
            const { color, tint } = chipFor(etapaCosteoCol!, etapaCosteoVal);
            return <StatusBadge label={dedupeMirrorText(etapaCosteoVal.text)} color={color} tint={tint} />;
          })()}
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)', marginLeft: 'auto' }}>
            {item.mondayUpdatedAt ? fmtSyncAgo(item.mondayUpdatedAt) : '—'}
          </div>
        </div>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{item.name}</div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>{institucion}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 'none' }}>
        <PersonPair vendedor={vendedor} compras={compras} vendedorSecondary={vendedorSecondary} />
        {etapaCosteoVal?.text && (() => {
          const { color, tint } = chipFor(etapaCosteoCol!, etapaCosteoVal);
          return <StatusBadge label={dedupeMirrorText(etapaCosteoVal.text)} color={color} tint={tint} />;
        })()}
        <MonoTag>{folio}</MonoTag>
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)', width: 70, textAlign: 'right' }}>
          {item.mondayUpdatedAt ? fmtSyncAgo(item.mondayUpdatedAt) : '—'}
        </div>
      </div>
    </div>
  );
});
