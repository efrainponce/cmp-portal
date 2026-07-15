import { useState } from 'react';
import { StageBoardList } from './StageBoardList';
import { OpportunityDrawer } from './OpportunityDrawer';
import { STAGE_BOARDS } from '../../lib/dealStages';

const CONFIG = STAGE_BOARDS.oportunidades;

export function OportunidadesBoard() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState('');

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {!openId && <StageBoardList config={CONFIG} q={q} onSearch={setQ} onOpen={setOpenId} />}
      {openId && (
        <OpportunityDrawer
          id={openId}
          backLabel={`Volver a ${CONFIG.title}`}
          defaultTab={CONFIG.defaultTab}
          onBack={() => setOpenId(null)}
          boardKey={CONFIG.key}
        />
      )}
    </div>
  );
}
