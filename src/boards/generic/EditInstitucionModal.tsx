// Lets a vendedor relink a Contacto's Institución (contact_account) — the one
// board_relation column writable from the portal today. No generic board_relation
// picker exists yet, so this is purpose-built rather than routed through FormField.
import { useState } from 'react';
import { Modal } from '../../components/core/Modal';
import { SearchInput } from '../../components/forms/SearchInput';
import { usePoll, patchItem, type ItemDTO } from '../../lib/api';

interface Props {
  contact: ItemDTO;
  onClose: () => void;
  onSaved: () => void;
}

export function EditInstitucionModal({ contact, onClose, onSaved }: Props) {
  const [q, setQ] = useState('');
  const { data } = usePoll('instituciones', q);
  const options = data?.items ?? [];
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = contact.cols['contact_account']?.text || '—';

  const select = async (institucion: ItemDTO) => {
    setSaving(true);
    setError(null);
    try {
      await patchItem('contactos', contact.id, { contact_account: institucion.id });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
      setSaving(false);
    }
  };

  return (
    <Modal title={`Institución — ${contact.name}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>
          Actual: <span style={{ color: 'var(--ink)' }}>{current}</span>
        </div>
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar institución…" style={{ maxWidth: 'none' }} />
        <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
          {options.length === 0 ? (
            <div style={{ padding: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin resultados.</div>
          ) : options.map((inst) => (
            <div
              key={inst.id}
              className="row-hover"
              onClick={saving ? undefined : () => select(inst)}
              style={{
                padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)',
                font: 'var(--text-label)', color: 'var(--ink)',
                cursor: saving ? 'default' : 'pointer',
              }}
            >
              {inst.name}
            </div>
          ))}
        </div>
        {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
        {saving && <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>Guardando…</div>}
      </div>
    </Modal>
  );
}
