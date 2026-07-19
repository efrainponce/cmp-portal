// Shared list view for every stage-filtered Oportunidades destination
// (Oportunidades, Costeo, Validación Costeo, Documentación y Tallas, Órdenes
// de Compra, Logística) — same row template as Board Costeo/Validacion in the
// design, just a different deal_stage filter + grouping column per board.
import { useMemo } from 'react';
import { useBoards, usePoll, colForBoard, type ItemDTO } from '../../lib/api';
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
const CONTACTO_COL = 'deal_contact';
const ETAPA_COL = 'deal_stage';

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
  /** Botón/acción a la derecha del buscador (p.ej. "Nueva oportunidad"). */
  headerAction?: React.ReactNode;
}

export function StageBoardList({ config, groupColId = 'deal_stage', q, onSearch, onOpen, headerAction }: Props) {
  const isMobile = useIsMobile();
  const { boards } = useBoards();
  const cols = colForBoard(boards, 'oportunidades');
  const groupCol = cols.find((c) => c.id === groupColId);
  const etapaCosteoCol = cols.find((c) => c.id === ETAPA_COSTEO_COL);
  const { status, data } = usePoll('oportunidades', q);
  const allItems = data?.items ?? [];
  const stageItems = allItems
    .filter((it) => !config.stages || config.stages.includes(statusIndex(it.cols.deal_stage)))
    .filter((it) => !config.namePrefix || it.name.trim().toUpperCase().startsWith(config.namePrefix.toUpperCase()));
  const sync = lastMondayUpdateFromItems(stageItems);

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

  const vendedorOptions = useMemo(() => optionsFromCol(stageItems, VENDEDOR_COL), [stageItems]);
  const comprasOptions = useMemo(() => optionsFromCol(stageItems, COMPRAS_COL), [stageItems]);
  const etapaOptions = useMemo(() => stageOptionsFromItems(stageItems), [stageItems]);

  // Instant client-side narrowing on top of whatever the server already
  // returned for `q` — covers columns the server search doesn't (yet) hit,
  // and doesn't wait for the next 5s poll.
  const items = stageItems.filter((it) => {
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
  });

  const hasActiveFilters = vendedorFilter !== ALL_VALUE || comprasFilter !== ALL_VALUE || etapaFilter !== ALL_VALUE;
  const clearFilters = clearSavedFilters;

  const order = groupColId === 'deal_stage' ? DEAL_STAGE_ORDER : undefined;
  const groups = groupByColumn(items, groupCol, undefined, undefined, order);

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
                <Row key={item.id} item={item} etapaCosteoCol={etapaCosteoCol} onClick={() => onOpen(item.id)} />
              ))}
            </GroupCard>
          ))}
        </BoardStatus>
      </div>
    </div>
  );
}

function Row({ item, etapaCosteoCol, onClick }: { item: ItemDTO; etapaCosteoCol?: ReturnType<typeof colForBoard>[number]; onClick: () => void }) {
  const isMobile = useIsMobile();
  const institucion = item.cols[INSTITUCION_COL]?.text || '—';
  const folio = item.cols[FOLIO_COL]?.text || '—';
  const etapaCosteoVal = etapaCosteoCol ? item.cols[etapaCosteoCol.id] : undefined;
  const vendedor = item.cols[VENDEDOR_COL]?.text || undefined;
  const compras = item.cols[COMPRAS_COL]?.text || undefined;

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
          <PersonPair vendedor={vendedor} compras={compras} />
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
        padding: '11px 18px', background: '#fff', borderTop: '1px solid var(--border-subtle)', cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{item.name}</div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>{institucion}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 'none' }}>
        <PersonPair vendedor={vendedor} compras={compras} />
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
}
