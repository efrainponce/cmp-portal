// Lets a vendedor relink a Contacto's Institución (contact_account, board_relation)
// and reassign Vendedor (multiple_person_mm03vqwx, people) — the two columns
// writable from the portal on Contactos today. Each picker is a searchable list
// that saves on click (no separate save button), matching the rest of the portal's
// inline-edit pattern; the modal stays open so both fields can be changed in one go.
import { useEffect, useState } from 'react';
import { Modal } from '../../components/core/Modal';
import { SearchInput } from '../../components/forms/SearchInput';
import { usePoll, patchItem, getVendedores, type ItemDTO, type VendedorDTO } from '../../lib/api';

interface Props {
  contact: ItemDTO;
  onClose: () => void;
  onSaved: () => void;
}

const VENDEDOR_COL = 'multiple_person_mm03vqwx';

export function EditContactoModal({ contact, onClose, onSaved }: Props) {
  const [instQ, setInstQ] = useState('');
  const { data: instData } = usePoll('instituciones', instQ);
  const institucionOptions = instData?.items ?? [];
  const [currentInstitucion, setCurrentInstitucion] = useState(contact.cols['contact_account']?.text || '—');

  const [vendedores, setVendedores] = useState<VendedorDTO[]>([]);
  const [vendQ, setVendQ] = useState('');
  const [currentVendedor, setCurrentVendedor] = useState(contact.cols[VENDEDOR_COL]?.text || '—');

  const [savingCol, setSavingCol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getVendedores().then(setVendedores); }, []);

  const vendedorOptions = vendedores.filter((v) => v.nombre.toLowerCase().includes(vendQ.trim().toLowerCase()));

  const save = async (colId: string, value: string, applyLocal: () => void) => {
    setSavingCol(colId);
    setError(null);
    try {
      await patchItem('contactos', contact.id, { [colId]: value });
      applyLocal();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setSavingCol(null);
    }
  };

  return (
    <Modal title={contact.name} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink-secondary)' }}>
            Institución <span style={{ fontWeight: 400, color: 'var(--ink-tertiary)' }}>— actual: {currentInstitucion}</span>
          </div>
          <SearchInput value={instQ} onChange={(e) => setInstQ(e.target.value)} placeholder="Buscar institución…" style={{ maxWidth: 'none' }} />
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
            {institucionOptions.length === 0 ? (
              <div style={{ padding: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin resultados.</div>
            ) : institucionOptions.map((inst) => (
              <div
                key={inst.id}
                className="row-hover"
                onClick={savingCol ? undefined : () => save('contact_account', inst.id, () => setCurrentInstitucion(inst.name))}
                style={{
                  padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)',
                  font: 'var(--text-label)', color: 'var(--ink)',
                  cursor: savingCol ? 'default' : 'pointer',
                }}
              >
                {inst.name}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink-secondary)' }}>
            Vendedor <span style={{ fontWeight: 400, color: 'var(--ink-tertiary)' }}>— actual: {currentVendedor}</span>
          </div>
          <SearchInput value={vendQ} onChange={(e) => setVendQ(e.target.value)} placeholder="Buscar vendedor…" style={{ maxWidth: 'none' }} />
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
            {vendedorOptions.length === 0 ? (
              <div style={{ padding: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin resultados.</div>
            ) : vendedorOptions.map((v) => (
              <div
                key={v.id}
                className="row-hover"
                onClick={savingCol ? undefined : () => save(VENDEDOR_COL, String(v.id), () => setCurrentVendedor(v.nombre))}
                style={{
                  padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)',
                  font: 'var(--text-label)', color: 'var(--ink)',
                  cursor: savingCol ? 'default' : 'pointer',
                }}
              >
                {v.nombre}
              </div>
            ))}
          </div>
        </div>

        {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
        {savingCol && <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>Guardando…</div>}
      </div>
    </Modal>
  );
}
