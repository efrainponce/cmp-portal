import { lazy, Suspense, useState } from 'react';
import { StageBoardList } from './StageBoardList';
import { OpportunityDrawer } from './OpportunityDrawer';
import { STAGE_BOARDS } from '../../lib/dealStages';
import { Button } from '../../components/core/Button';
import { IconPlus } from '../../components/icons';

const CONFIG = STAGE_BOARDS.oportunidades;

// El modal solo pesa cuando alguien lo abre.
const CreateOportunidadModal = lazy(() => import('./CreateOportunidadModal'));

export function OportunidadesBoard() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {!openId && (
        <StageBoardList
          config={CONFIG}
          q={q}
          onSearch={setQ}
          onOpen={setOpenId}
          headerAction={
            <Button variant="primary" onClick={() => setCreating(true)}>
              <IconPlus /> Nueva oportunidad
            </Button>
          }
        />
      )}
      {openId && (
        <OpportunityDrawer
          id={openId}
          backLabel={`Volver a ${CONFIG.title}`}
          defaultTab={CONFIG.defaultTab}
          onBack={() => setOpenId(null)}
          boardKey={CONFIG.key}
        />
      )}
      {creating && (
        <Suspense fallback={null}>
          <CreateOportunidadModal onClose={() => setCreating(false)} onCreated={() => setCreating(false)} />
        </Suspense>
      )}
    </div>
  );
}
