import { useState } from 'react';
import { StageBoardList } from '../oportunidades/StageBoardList';
import { OpportunityDrawer } from '../oportunidades/OpportunityDrawer';
import { STAGE_BOARDS } from '../../lib/dealStages';

const CONFIG = STAGE_BOARDS.doctallas;

interface Props {
  openId: string | null;
  onOpenChange: (id: string | null) => void;
}

export function DocTallasBoard({ openId, onOpenChange }: Props) {
  const [q, setQ] = useState('');

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {!openId && <StageBoardList config={CONFIG} q={q} onSearch={setQ} onOpen={onOpenChange} />}
      {openId && (
        <OpportunityDrawer
          id={openId}
          backLabel={`Volver a ${CONFIG.title}`}
          defaultTab={CONFIG.defaultTab}
          onBack={() => onOpenChange(null)}
          boardKey={CONFIG.key}
        />
      )}
    </div>
  );
}
