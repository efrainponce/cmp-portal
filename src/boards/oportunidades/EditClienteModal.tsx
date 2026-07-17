// Lets a vendedor relink an Oportunidad's Cliente (deal_contact → Contactos).
// Institución (lookup_mm1bs976) is a mirror of this relation, so this is also
// the only way to fix a wrong Institución on an already-created oportunidad
// (mismo patrón que EditInstitucionModal, pero sobre `oportunidades`).
import { useState } from 'react';
import { Modal } from '../../components/core/Modal';
import { SearchInput } from '../../components/forms/SearchInput';
import { usePoll, patchItem, type ItemDTO } from '../../lib/api';

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const select = async (contacto: ItemDTO) => {
    setSaving(true);
    setError(null);
    try {
      await patchItem('oportunidades', oppId, { deal_contact: contacto.id });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
      setSaving(false);
    }
  };

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
            <div
              key={c.id}
              className="row-hover"
              onClick={saving ? undefined : () => select(c)}
              style={{
                padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)',
                font: 'var(--text-label)', color: 'var(--ink)',
                cursor: saving ? 'default' : 'pointer',
              }}
            >
              {c.name}
            </div>
          ))}
        </div>
        {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
        {saving && <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>Guardando…</div>}
      </div>
    </Modal>
  );
}
