import { useState } from 'react';
import { StageBoardList } from '../oportunidades/StageBoardList';
import { OpportunityDrawer } from '../oportunidades/OpportunityDrawer';
import { STAGE_BOARDS } from '../../lib/dealStages';

const CONFIG = STAGE_BOARDS.costeo;

export function CosteoBoard() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState('');

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {!openId && <StageBoardList config={CONFIG} groupColId="lookup_mm087at6" q={q} onSearch={setQ} onOpen={setOpenId} />}
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
