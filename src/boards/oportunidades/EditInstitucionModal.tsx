// Elegir la Institución de una Oportunidad (Efraín, 2026-08-18). La columna
// Institución de la oportunidad (`lookup_mm1bs976`) es un ESPEJO del Contacto
// ligado: lo que de verdad se escribe es `contact_account` DEL CONTACTO, y el
// worker lo baja al espejo de todas sus oportunidades
// (POST /api/oportunidades/:id/institucion). Por eso el aviso de abajo: elegir
// aquí también corrige el contacto en el CRM, no solo esta oportunidad.
import { useState } from 'react';
import { Modal } from '../../components/core/Modal';
import { SearchInput } from '../../components/forms/SearchInput';
import { PickerRow } from '../../components/forms/PickerRow';
import { usePoll, setInstitucionOportunidad, SOLO_NOMBRE, type ItemDTO } from '../../lib/api';
import { useSaveState } from '../../lib/useSaveState';

interface Props {
  oppId: string;
  oppName: string;
  currentInstitucion: string;
  /** Cliente (contacto) ligado — sin él no hay dónde guardar la institución. */
  currentCliente: string;
  onClose: () => void;
  /** Nombre de la institución ya guardada, para pintarla sin esperar al espejo. */
  onSaved: (institucion: string) => void;
}

export function EditInstitucionModal({ oppId, oppName, currentInstitucion, currentCliente, onClose, onSaved }: Props) {
  const [q, setQ] = useState('');
  const { data } = usePoll('instituciones', q, SOLO_NOMBRE);
  const options = data?.items ?? [];
  const { saving, error, run } = useSaveState();
  const [rechazo, setRechazo] = useState<string | null>(null);

  const select = (inst: ItemDTO) => run(async () => {
    const res = await setInstitucionOportunidad(oppId, inst.id);
    if (!res.ok) { setRechazo(res.error ?? 'No se pudo guardar la institución.'); return; }
    onSaved(res.institucion || inst.name);
    onClose();
  });

  return (
    <Modal title={`Institución — ${oppName}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>
          Actual: <span style={{ color: 'var(--ink)' }}>{currentInstitucion || '—'}</span>
        </div>
        {currentCliente ? (
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>
            La Institución se guarda en el contacto <span style={{ color: 'var(--ink-tertiary)' }}>{currentCliente}</span> —
            queda ligada a él y aparece en todas sus oportunidades.
          </div>
        ) : (
          <div style={{ font: 'var(--text-label)', color: 'var(--status-esperando)' }}>
            ⚠ Esta oportunidad no tiene Cliente todavía. Asígnalo con «Cambiar cliente» y luego elige la institución
            (se guarda en el contacto).
          </div>
        )}
        {currentCliente && (
          <>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar institución…" style={{ maxWidth: 'none' }} />
            <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
              {options.length === 0 ? (
                <div style={{ padding: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin resultados.</div>
              ) : options.map((inst) => (
                <PickerRow key={inst.id} onClick={() => select(inst)} disabled={!!saving}>
                  {inst.name}
                </PickerRow>
              ))}
            </div>
          </>
        )}
        {(rechazo || error) && (
          <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{rechazo ?? error}</div>
        )}
        {saving && <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>Guardando…</div>}
      </div>
    </Modal>
  );
}
