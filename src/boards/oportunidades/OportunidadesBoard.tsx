import { lazy, Suspense, useState } from 'react';
import { StageBoardList } from './StageBoardList';
import { usePrefetchOnIdle } from '../../lib/lazyPrefetch';
import { STAGE_BOARDS } from '../../lib/dealStages';
import { Button } from '../../components/core/Button';
import { IconPlus } from '../../components/icons';

const CONFIG = STAGE_BOARDS.oportunidades;

// El modal solo pesa cuando alguien lo abre.
const CreateOportunidadModal = lazy(() => import('./CreateOportunidadModal'));

// Igual que en StageBoard: el drawer se precarga en idle, no en la ruta.
const cargarDrawer = () => import('./OpportunityDrawer').then((m) => ({ default: m.OpportunityDrawer }));
const OpportunityDrawer = lazy(cargarDrawer);

interface Props {
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  /** Llamado con el id de la oportunidad nueva tras "Duplicar" en el drawer. */
  onDuplicated: (newId: string) => void;
}

export function OportunidadesBoard({ openId, onOpenChange, onDuplicated }: Props) {
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  // El drawer se precarga SOLO cuando la lista ya pintó: si no, el idle
  // callback dispara mientras se espera /items (el hilo está libre esperando
  // la red) y le roba ancho de banda justo al request que importa.
  const [listaLista, setListaLista] = useState(false);
  usePrefetchOnIdle(cargarDrawer, listaLista);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {!openId && (
        <StageBoardList
          config={CONFIG}
          onReady={() => setListaLista(true)}
          q={q}
          onSearch={setQ}
          onOpen={onOpenChange}
          headerAction={
            <Button variant="primary" onClick={() => setCreating(true)}>
              <IconPlus /> Nueva oportunidad
            </Button>
          }
        />
      )}
      {openId && (
        <Suspense fallback={<div style={{ padding: 32 }}>Cargando…</div>}>
        <OpportunityDrawer
          id={openId}
          backLabel={`Volver a ${CONFIG.title}`}
          defaultTab={CONFIG.defaultTab}
          onBack={() => onOpenChange(null)}
          boardKey={CONFIG.key}
          onDuplicated={onDuplicated}
        />
        </Suspense>
      )}
      {creating && (
        <Suspense fallback={null}>
          <CreateOportunidadModal
            onClose={() => setCreating(false)}
            onCreated={(itemId) => {
              setCreating(false);
              onOpenChange(String(itemId)); // Abrir drawer automáticamente
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
