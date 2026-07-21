// Lets a vendedor relink an Oportunidad's Cliente (deal_contact → Contactos).
// Institución (lookup_mm1bs976) is a mirror of this relation, so this is also
// the only way to fix a wrong Institución on an already-created oportunidad
// (mismo patrón que EditInstitucionModal, pero sobre `oportunidades`).
import { useState } from 'react';
import { Modal } from '../../components/core/Modal';
import { SearchInput } from '../../components/forms/SearchInput';
import { PickerRow } from '../../components/forms/PickerRow';
import { usePoll, patchItem, type ItemDTO } from '../../lib/api';
import { useSaveState } from '../../lib/useSaveState';

interface Props {
  oppId: string;
  oppName: string;
  currentCliente: string;
  onClose: () => void;
  onSaved: () => void;
}

export function EditClienteModal({ oppId, oppName, currentCliente, onClose, onSaved }: Props) {
  const [q, setQ] = useState('');
  const { data } = usePoll('contactos', q);
  const options = data?.items ?? [];
  const { saving, error, run } = useSaveState();

  const select = (contacto: ItemDTO) => run(async () => {
    await patchItem('oportunidades', oppId, { deal_contact: contacto.id });
    onSaved();
    onClose();
  });

  return (
    <Modal title={`Cliente — ${oppName}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>
          Actual: <span style={{ color: 'var(--ink)' }}>{currentCliente || '—'}</span>
        </div>
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>
          La Institución se actualiza sola al cambiar el Cliente (viene del Contacto vinculado).
        </div>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contacto…" style={{ maxWidth: 'none' }} />
        <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
          {options.length === 0 ? (
            <div style={{ padding: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin resultados.</div>
          ) : options.map((c) => (
            <PickerRow key={c.id} onClick={() => select(c)} disabled={!!saving}>
              {c.name}
            </PickerRow>
          ))}
        </div>
        {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
        {saving && <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>Guardando…</div>}
      </div>
    </Modal>
  );
}
