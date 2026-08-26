import { lazy, Suspense, useState } from 'react';
import { ProyectoBoardList } from './ProyectoBoardList';
import { usePrefetchOnIdle } from '../../lib/lazyPrefetch';
import { PROJECT_BOARDS, type ProjectBoardKey } from '../../lib/projectStages';

// Mismo criterio que en los boards de Oportunidades: el drawer se precarga
// cuando el navegador está ocioso, no compitiendo con la carga de la lista.
const cargarDrawer = () => import('./ProyectoDrawer').then((m) => ({ default: m.ProyectoDrawer }));
const ProyectoDrawer = lazy(cargarDrawer);

interface Props {
  boardKey: ProjectBoardKey;
  openId: string | null;
  /** Pestaña pedida por la URL (/<board>/<id>/<tab>) y su reflejo de vuelta. */
  openTab?: string | null;
  onTabChange?: (tab: string) => void;
  onOpenChange: (id: string | null) => void;
  /** El id abierto es del board Proyectos — abrir la Oportunidad ligada navega
   * a su propio board/drawer (misma lógica que un link cruzado). */
  onOpenOportunidad: (id: string) => void;
}

/** Vista genérica de los 3 accesos de Proyectos (Documentación y Tallas,
 * Órdenes de Compra, Logística): lista por project_status + drawer nativo del
 * Proyecto. Mismo patrón que StageBoard, pero sobre el board Proyectos en vez
 * de Oportunidades filtrada por etapa (Efraín, 2026-07-17). */
export function ProyectoBoard({ boardKey, openId, openTab, onTabChange, onOpenChange, onOpenOportunidad }: Props) {
  const config = PROJECT_BOARDS[boardKey];
  const [q, setQ] = useState('');
  // El drawer se precarga SOLO cuando la lista ya pintó: si no, el idle
  // callback dispara mientras se espera /items (el hilo está libre esperando
  // la red) y le roba ancho de banda justo al request que importa.
  const [listaLista, setListaLista] = useState(false);
  usePrefetchOnIdle(cargarDrawer, listaLista);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {!openId && <ProyectoBoardList config={config} q={q} onSearch={setQ} onOpen={onOpenChange} onReady={() => setListaLista(true)} />}
      {openId && (
        <Suspense fallback={<div style={{ padding: 32 }}>Cargando…</div>}>
        <ProyectoDrawer
          id={openId}
          boardKey={boardKey}
          backLabel={`Volver a ${config.title}`}
          defaultTab={config.defaultTab}
          openTab={openTab}
          onTabChange={onTabChange}
          onBack={() => onOpenChange(null)}
          onOpenOportunidad={onOpenOportunidad}
        />
        </Suspense>
      )}
    </div>
  );
}
