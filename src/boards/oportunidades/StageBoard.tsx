import { lazy, Suspense, useState } from 'react';
import { StageBoardList } from './StageBoardList';
import { usePrefetchOnIdle } from '../../lib/lazyPrefetch';
import { getCatalogoProductos } from '../../lib/apiClient';
import { STAGE_BOARDS, type StageBoardKey } from '../../lib/dealStages';
import { Button } from '../../components/core/Button';
import { IconPlus } from '../../components/icons';

// El modal solo pesa cuando alguien lo abre.
const CreateOportunidadModal = lazy(() => import('./CreateOportunidadModal'));

// El drawer no se necesita para VER la lista: se precarga en cuanto el hilo
// principal se desocupa, así no le pelea ancho de banda a /items (ver
// lazyPrefetch) y el clic en un renglón sigue siendo instantáneo.
const cargarDrawer = () => import('./OpportunityDrawer').then((m) => ({ default: m.OpportunityDrawer }));
const OpportunityDrawer = lazy(cargarDrawer);

interface Props {
  boardKey: StageBoardKey;
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  /** Llamado con el id de la oportunidad nueva tras "Duplicar" en el drawer —
   * siempre nace en etapa "Nueva oportunidad", así que navega al board Oportunidades. */
  onDuplicated: (newId: string) => void;
}

/** Vista genérica de board de pipeline (Costeo, Validación, Doc/Tallas, OC,
 * Logística): lista por etapa + drawer. Toda la variación por board vive en
 * STAGE_BOARDS (src/lib/dealStages.ts) y en el `boardKey` que el drawer usa
 * para su modo (p. ej. solo lectura en Costeo). Oportunidades tiene su propio
 * wrapper (OportunidadesBoard) con el botón/modal "Nueva oportunidad" — Costeo
 * lo repite aquí (Efraín, 2026-08-10: Compras perdió el board Oportunidades
 * del sidebar pero sigue pudiendo crear oportunidades y elegir cualquier
 * vendedor, mismo modal sin restricción). El resto de los boards de etapa no
 * lo necesitan: solo llegan ahí oportunidades que ya avanzaron. 'zona_efrain'
 * también lo necesita — es como llega Elisa crea una oportunidad para el CEO
 * sin salir de esa pestaña (Efraín, 2026-08-12). */
export function StageBoard({ boardKey, openId, onOpenChange, onDuplicated }: Props) {
  const config = STAGE_BOARDS[boardKey];
  const [q, setQ] = useState('');
  // El drawer se precarga SOLO cuando la lista ya pintó: si no, el idle
  // callback dispara mientras se espera /items (el hilo está libre esperando
  // la red) y le roba ancho de banda justo al request que importa.
  const [listaLista, setListaLista] = useState(false);
  const [creating, setCreating] = useState(false);
  const canCreate = boardKey === 'costeo' || boardKey === 'zona_efrain';
  usePrefetchOnIdle(cargarDrawer, listaLista);

  // En Costeo y Validación el drawer SIEMPRE carga el catálogo de Productos
  // (CotizacionTab con variant='costeo'), y medido en producción ese request no
  // arranca hasta 0.5 s DESPUÉS del clic, porque antes tiene que montar el
  // drawer: son 89 KB en el camino de abrir cada oportunidad. Aquí se pide
  // mientras la persona todavía está viendo la lista, así el primer clic ya lo
  // encuentra en memoria (getCatalogoProductos cachea por sesión).
  //
  // Sólo en estos dos boards: son donde el catálogo se carga sí o sí y donde se
  // abren oportunidades todo el día. En el resto se seguiría bajando 89 KB que
  // quizá nadie use.
  const usaCatalogo = boardKey === 'costeo' || boardKey === 'validacion';
  usePrefetchOnIdle(getCatalogoProductos, listaLista && usaCatalogo);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {!openId && (
        <StageBoardList
          config={config}
          onReady={() => setListaLista(true)}
          q={q}
          onSearch={setQ}
          onOpen={onOpenChange}
          headerAction={canCreate ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <IconPlus /> Nueva oportunidad
            </Button>
          ) : undefined}
        />
      )}
      {openId && (
        <Suspense fallback={<div style={{ padding: 32 }}>Cargando…</div>}>
        <OpportunityDrawer
          id={openId}
          backLabel={`Volver a ${config.title}`}
          defaultTab={config.defaultTab}
          onBack={() => onOpenChange(null)}
          boardKey={config.key}
          onDuplicated={onDuplicated}
        />
        </Suspense>
      )}
      {canCreate && creating && (
        <Suspense fallback={null}>
          <CreateOportunidadModal
            onClose={() => setCreating(false)}
            onCreated={(itemId) => {
              setCreating(false);
              onOpenChange(String(itemId)); // Abrir drawer automáticamente
            }}
            native={boardKey === 'zona_efrain'}
          />
        </Suspense>
      )}
    </div>
  );
}
