import { useState } from 'react';
import { StageBoardList } from './StageBoardList';
import { OpportunityDrawer } from './OpportunityDrawer';
import { STAGE_BOARDS, type StageBoardKey } from '../../lib/dealStages';

interface Props {
  boardKey: StageBoardKey;
  openId: string | null;
  onOpenChange: (id: string | null) => void;
}

/** Vista genérica de board de pipeline (Costeo, Validación, Doc/Tallas, OC,
 * Logística): lista por etapa + drawer. Toda la variación por board vive en
 * STAGE_BOARDS (src/lib/dealStages.ts) y en el `boardKey` que el drawer usa
 * para su modo (p. ej. solo lectura en Costeo). Oportunidades tiene su propio
 * wrapper (OportunidadesBoard) por el botón/modal "Nueva oportunidad". */
export function StageBoard({ boardKey, openId, onOpenChange }: Props) {
  const config = STAGE_BOARDS[boardKey];
  const [q, setQ] = useState('');

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {!openId && <StageBoardList config={config} q={q} onSearch={setQ} onOpen={onOpenChange} />}
      {openId && (
        <OpportunityDrawer
          id={openId}
          backLabel={`Volver a ${config.title}`}
          defaultTab={config.defaultTab}
          onBack={() => onOpenChange(null)}
          boardKey={config.key}
        />
      )}
    </div>
  );
}
