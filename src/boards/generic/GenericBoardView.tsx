// Full-board table with search — powers Productos, Instituciones, Contactos.
import { useState } from 'react';
import { useBoards, usePoll, colForBoard, type BoardSlug } from '../../lib/api';
import { BoardTable } from '../../components/board/BoardTable';
import { BoardStatus } from '../../components/board/BoardStatus';
import { SearchInput } from '../../components/forms/SearchInput';
import { SyncIndicator } from '../../components/board/SyncIndicator';
import { Button } from '../../components/core/Button';
import { IconPlus } from '../../components/icons';
import { lastMondayUpdateFromItems } from '../../lib/syncStatus';
import { CreateRecordModal } from './CreateRecordModal';
import { EditInstitucionModal } from './EditInstitucionModal';
import { useIsMobile } from '../../lib/useIsMobile';
import type { ItemDTO } from '../../lib/api';

interface Props {
  slug: BoardSlug;
  title: string;
}

const CREATE_LABEL: Record<string, string> = { instituciones: 'Nueva institución', contactos: 'Nuevo contacto' };

export function GenericBoardView({ slug, title }: Props) {
  const isMobile = useIsMobile();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingContact, setEditingContact] = useState<ItemDTO | null>(null);
  const { boards } = useBoards();
  const cols = colForBoard(boards, slug);
  const { status, data, refetch } = usePoll(slug, q);
  const items = data?.items ?? [];
  const sync = lastMondayUpdateFromItems(items);
  // Oportunidades también es creatable, pero tiene su propio modal en su board —
  // aquí solo aplican los dos catálogos genéricos.
  const createSlug = slug === 'instituciones' || slug === 'contactos' ? slug : null;
  const creatable = createSlug !== null;
  const canEditInstitucion = slug === 'contactos' && !!cols.find((c) => c.id === 'contact_account')?.w;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: isMobile ? '14px 14px 12px' : '26px 32px 16px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ font: 'var(--text-title)', color: 'var(--ink)' }}>{title}</div>
          {creatable && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <IconPlus /> {CREATE_LABEL[slug]}
            </Button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>{data?.total ?? items.length} registros</div>
          <SyncIndicator syncedAt={sync.updatedAt} pending={sync.pending} label="actualizado" />
        </div>
        <div style={{ marginTop: isMobile ? 10 : 14, display: 'flex', gap: 10 }}>
          <SearchInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Buscar en ${title.toLowerCase()}…`}
            style={isMobile ? { maxWidth: '100%' } : undefined}
          />
        </div>
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        <BoardStatus status={status}>
          <BoardTable cols={cols} items={items} onRowClick={canEditInstitucion ? setEditingContact : undefined} />
        </BoardStatus>
      </div>

      {creating && createSlug && (
        <CreateRecordModal
          slug={createSlug}
          title={CREATE_LABEL[createSlug]}
          onClose={() => setCreating(false)}
          onCreated={refetch}
        />
      )}

      {editingContact && (
        <EditInstitucionModal
          contact={editingContact}
          onClose={() => setEditingContact(null)}
          onSaved={refetch}
        />
      )}
    </div>
  );
}
