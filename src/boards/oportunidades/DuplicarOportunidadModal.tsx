// "Duplicar" (Efraín, 2026-08-14: "duplicar pregunta a que estado se manda")
// — antes el clon nacía siempre en "Nueva oportunidad" sin preguntar; quien
// duplica ahora elige la etapa de arranque. Fuera de "Nueva oportunidad" es
// SOLO la etiqueta: el clon no genera el Proyecto de "Ganada" ni los PDFs de
// costeo/validación — el aviso de abajo lo deja explícito para no repetir el
// mismo susto que OPP-0899 (clon con costeo en blanco antes de este fix).
import { useState } from 'react';
import { Button } from '../../components/core/Button';
import { Modal } from '../../components/core/Modal';
import { DEAL_STAGE_LABELS, DUPLICAR_ETAPAS_VALIDAS } from '../../lib/dealStages';

const fieldInputStyle: React.CSSProperties = {
  width: '100%', font: 'var(--text-label)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
  padding: '7px 9px', boxSizing: 'border-box',
};

export function DuplicarOportunidadModal({
  onClose, onConfirm, duplicating,
}: {
  onClose: () => void;
  onConfirm: (etapa: string) => void;
  duplicating: boolean;
}) {
  const [etapa, setEtapa] = useState('4'); // Nueva oportunidad

  return (
    <Modal
      title="Duplicar oportunidad"
      onClose={duplicating ? () => {} : onClose}
      width={420}
      footer={(
        <>
          <Button variant="secondary" onClick={duplicating ? undefined : onClose}>Cancelar</Button>
          <Button variant={duplicating ? 'disabled' : 'primary'} onClick={duplicating ? undefined : () => onConfirm(etapa)}>
            {duplicating ? 'Duplicando…' : 'Duplicar'}
          </Button>
        </>
      )}
    >
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 16 }}>
        Crea una oportunidad nueva con los mismos productos, colores, cantidades y costeo vigentes —
        sin versiones de cotización, PDFs ni otros documentos.
      </div>

      <div style={{
        font: '700 10px \'Inter\', sans-serif', color: 'var(--ink-tertiary)',
        textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 4,
      }}>
        ¿A qué etapa se manda?
      </div>
      <select value={etapa} onChange={(e) => setEtapa(e.target.value)} style={fieldInputStyle} disabled={duplicating}>
        {DUPLICAR_ETAPAS_VALIDAS.map((key) => (
          <option key={key} value={key}>{DEAL_STAGE_LABELS[key]}</option>
        ))}
      </select>

      {etapa !== '4' && (
        <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)', marginTop: 10 }}>
          Solo se copia la etiqueta de la etapa — el duplicado NO genera el Proyecto de
          "Ganada" ni los PDFs de costeo/validación que esa etapa normalmente implica.
        </div>
      )}
    </Modal>
  );
}
