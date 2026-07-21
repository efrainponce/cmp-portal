// Lets a vendedor relink a Contacto's Institución (contact_account, board_relation)
// and reassign Vendedor (multiple_person_mm03vqwx, people) — the two columns
// writable from the portal on Contactos today. Each picker is a searchable list
// that saves on click (no separate save button), matching the rest of the portal's
// inline-edit pattern; the modal stays open so both fields can be changed in one go.
import { useEffect, useState } from 'react';
import { Modal } from '../../components/core/Modal';
import { SearchInput } from '../../components/forms/SearchInput';
import { PickerRow } from '../../components/forms/PickerRow';
import { usePoll, patchItem, getVendedores, type ItemDTO, type VendedorDTO } from '../../lib/api';
import { useSaveState } from '../../lib/useSaveState';

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

  // `saving` guarda el colId que se está escribiendo (no solo un booleano) —
  // no se usa para distinguir la fila en pantalla (ambas listas se deshabilitan
  // igual mientras cualquiera de las dos guarda, mismo comportamiento que antes),
  // pero queda disponible por si hace falta más adelante.
  const { saving: savingCol, error, run } = useSaveState<string>();

  useEffect(() => { getVendedores().then(setVendedores); }, []);

  const vendedorOptions = vendedores.filter((v) => v.nombre.toLowerCase().includes(vendQ.trim().toLowerCase()));

  const save = (colId: string, value: string, applyLocal: () => void) => run(async () => {
    await patchItem('contactos', contact.id, { [colId]: value });
    applyLocal();
    onSaved();
  }, colId);

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
              <PickerRow key={inst.id} onClick={() => save('contact_account', inst.id, () => setCurrentInstitucion(inst.name))} disabled={!!savingCol}>
                {inst.name}
              </PickerRow>
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
              <PickerRow key={v.id} onClick={() => save(VENDEDOR_COL, String(v.id), () => setCurrentVendedor(v.nombre))} disabled={!!savingCol}>
                {v.nombre}
              </PickerRow>
            ))}
          </div>
        </div>

        {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
        {savingCol && <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>Guardando…</div>}
      </div>
    </Modal>
  );
}
