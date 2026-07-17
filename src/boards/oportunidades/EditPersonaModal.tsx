// Reasigna Vendedor (deal_owner) o Comprador (multiple_person_mm03qyw9) de una
// oportunidad ya creada — mismo patrón que EditClienteModal, mismas listas que
// alimentan el Select de CreateOportunidadModal.
import { useEffect, useState } from 'react';
import { Modal } from '../../components/core/Modal';
import { Button } from '../../components/core/Button';
import { Select } from '../../components/forms/Select';
import { getVendedores, patchItem, type VendedorDTO } from '../../lib/api';

interface Props {
  oppId: string;
  oppName: string;
  colId: string;
  role: 'vendedor' | 'compras';
  label: string;
  currentName: string;
  onClose: () => void;
  onSaved: () => void;
}

export function EditPersonaModal({ oppId, oppName, colId, role, label, currentName, onClose, onSaved }: Props) {
  const [options, setOptions] = useState<VendedorDTO[]>([]);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getVendedores(role).then(setOptions); }, [role]);

  const save = async () => {
    if (!value) { setError(`Falta elegir ${label.toLowerCase()}.`); return; }
    setSaving(true);
    setError(null);
    try {
      await patchItem('oportunidades', oppId, { [colId]: value });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`${label} — ${oppName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={saving ? undefined : save}>{saving ? 'Guardando…' : 'Guardar'}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>
          Actual: <span style={{ color: 'var(--ink)' }}>{currentName || '—'}</span>
        </div>
        <Select
          value={value} onChange={setValue}
          options={options.map((v) => ({ value: String(v.id), label: v.nombre }))}
          placeholder={`Elegir ${label.toLowerCase()}…`}
        />
        {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
      </div>
    </Modal>
  );
}
