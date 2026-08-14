// Lista de Proyectos (post-venta) para los 3 accesos del sidebar (Documentación
// y Tallas / Órdenes de Compra / Logística) — agrupada por project_status,
// filtrada por config.statuses. Fuente: board Proyectos directo, nunca vía el
// board_relation hacia la Oportunidad (Efraín, 2026-07-17 — ver dal.ts).
import { useEffect, useRef } from 'react';
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

const FOLIO_COL = 'pulse_id_mm1a12gy';
const INSTITUCION_COL = 'lookup_mm1dwn6';
const FECHA_ENTREGA_COL = 'date_mm0m1vfv';
const VENDEDOR_COL = 'multiple_person_mm0hrnqq';
const ESTADO_PRODUCTOS_COL = 'lookup_mm20g4n6';
const STATUS_COL = 'project_status';
const ZONA_COL = 'dropdown_mm0hnyv';

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
}

export function ProyectoBoardList({ config, q, onSearch, onOpen, onReady }: Props) {
  const isMobile = useIsMobile();
  const { boards } = useBoards();
  const cols = colForBoard(boards, 'proyectos');
  const statusCol = cols.find((c) => c.id === STATUS_COL);
  const estadoProductosCol = cols.find((c) => c.id === ESTADO_PRODUCTOS_COL);
  const { status, data } = usePoll('proyectos', q);

  // Igual que StageBoardList: avisa una sola vez que ya hay datos pintados,
  // para que el wrapper precargue el drawer sin estorbarle a esta carga.
  const avisado = useRef(false);
  useEffect(() => {
    if (avisado.current || status !== 'ready') return;
    avisado.current = true;
    onReady?.();
  }, [status, onReady]);
  const allItems = data?.items ?? [];
  const statusItems = allItems.filter((it) => config.statuses.includes(statusIndex(it.cols[STATUS_COL])));
  const sync = lastMondayUpdateFromItems(statusItems);

  const { collapsedGroups, toggleGroup } = useSavedView(config.key);

  const items = statusItems.filter((it) => {
    if (!q.trim()) return true;
    const haystack = [
      it.name,
      it.cols[INSTITUCION_COL]?.text,
      it.cols[FOLIO_COL]?.text,
      it.cols[VENDEDOR_COL]?.text,
    ].filter(Boolean).join(' ');
    return textIncludes(haystack, q);
  });

  const groups = config.key === 'ejecucion'
    ? groupByZona(items)
    : groupByColumn(items, statusCol, undefined, undefined, PROJECT_STATUS_ORDER);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: isMobile ? '14px 14px 12px' : '26px 32px 16px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ font: 'var(--text-title)', color: 'var(--ink)' }}>{config.title}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>{items.length} proyectos</div>
          <SyncIndicator syncedAt={sync.updatedAt} pending={sync.pending} label="actualizado" />
        </div>
        <div style={{ marginTop: isMobile ? 10 : 14, display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 10, flexWrap: 'wrap' }}>
          <SearchInput
            value={q}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Buscar proyecto, folio o institución…"
            style={isMobile ? { maxWidth: '100%', flexBasis: '100%' } : undefined}
          />
        </div>
      </div>

      <div style={{ overflowY: 'auto', padding: isMobile ? '12px 0 16px' : '16px 0 24px', flex: 1 }}>
        <BoardStatus status={status}>
          {groups.length === 0 && (
            <div style={{ padding: 24, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin proyectos.</div>
          )}
          {groups.map((g) => (
            <GroupCard
              key={g.key} label={g.label} color={g.color} tint={g.color + '22'} count={g.items.length}
              collapsed={!!collapsedGroups[g.key]} onToggleCollapsed={() => toggleGroup(g.key)}
            >
              {g.items.map((item) => (
                <Row
                  key={item.id} item={item} estadoProductosCol={estadoProductosCol}
                  showBattery={config.key === 'ejecucion'} onClick={() => onOpen(item.id)}
                />
              ))}
            </GroupCard>
          ))}
        </BoardStatus>
      </div>
    </div>
  );
}

function Row({ item, estadoProductosCol, showBattery, onClick }: {
  item: ItemDTO; estadoProductosCol?: ReturnType<typeof colForBoard>[number]; showBattery: boolean; onClick: () => void;
}) {
  const isMobile = useIsMobile();
  const institucion = item.cols[INSTITUCION_COL]?.text || '—';
  const folio = item.cols[FOLIO_COL]?.text || '—';
  const fechaEntrega = item.cols[FECHA_ENTREGA_COL]?.text;
  const vendedor = item.cols[VENDEDOR_COL]?.text || undefined;
  const estadoVal = estadoProductosCol ? item.cols[estadoProductosCol.id] : undefined;
  const battery = showBattery ? batteryFromMirrorText(estadoVal?.text) : null;

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: battery ? 1 : 'none' }}>
        <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{item.name}</div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>{institucion}</div>
      </div>
      {battery && <div style={{ width: 160, flex: 'none' }}><ProgressBattery data={battery} /></div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 'none' }}>
        <PersonPair vendedor={vendedor} />
        {!battery && estadoVal?.text && (() => {
          const { color, tint } = chipFor(estadoProductosCol!, estadoVal);
          return <StatusBadge label={dedupeMirrorText(estadoVal.text)} color={color} tint={tint} />;
        })()}
        {fechaEntrega && <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>Entrega {fechaEntrega}</div>}
        <MonoTag>{folio}</MonoTag>
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)', width: 70, textAlign: 'right' }}>
          {item.mondayUpdatedAt ? fmtSyncAgo(item.mondayUpdatedAt) : '—'}
        </div>
      </div>
    </div>
  );
}
