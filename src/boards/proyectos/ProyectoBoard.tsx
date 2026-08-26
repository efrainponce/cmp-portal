import { lazy, Suspense, useState } from 'react';
import { ProyectoBoardList } from './ProyectoBoardList';
import { usePrefetchOnIdle } from '../../lib/lazyPrefetch';
import { PROJECT_BOARDS, type ProjectBoardKey } from '../../lib/projectStages';
import { Button } from '../../components/core/Button';
import { IconPlus } from '../../components/icons';

// El modal solo pesa cuando alguien lo abre (igual que "Nueva oportunidad").
const CrearProyectoModal = lazy(() => import('./CrearProyectoModal'));

// Un proyecto nuevo nace en "Desglose de tallas" (shared/createFields.ts
// CREATE_DEFAULTS), así que el botón solo va en los accesos que muestran esa
// etapa — si no, el proyecto recién creado desaparecería de la lista donde se
// creó. Eso deja fuera a "Logística", que solo lista "Proyecto Terminado".
// "Reporte de Proyectos" sí entra (Efraín, 2026-08-26): no filtra por etapa,
// así que el proyecto nuevo aparece ahí mismo — y es la vista donde se ve el
// post-venta completo. "Zona Efrain" queda fuera: ahí los items son NATIVOS
// (viven solo en D1) y esto crea en Monday — mezclarlos filtraría la zona
// privada.
const CREAR_EN: ProjectBoardKey[] = ['doctallas', 'ordenescompra', 'ejecucion'];

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
  const [creating, setCreating] = useState(false);
  usePrefetchOnIdle(cargarDrawer, listaLista);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {!openId && (
        <ProyectoBoardList
          config={config} q={q} onSearch={setQ} onOpen={onOpenChange} onReady={() => setListaLista(true)}
          headerAction={CREAR_EN.includes(boardKey) ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <IconPlus /> Nuevo proyecto
            </Button>
          ) : undefined}
        />
      )}
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
      {creating && (
        <Suspense fallback={null}>
          <CrearProyectoModal
            onClose={() => setCreating(false)}
            onCreated={(itemId) => {
              setCreating(false);
              onOpenChange(String(itemId)); // Abrir el drawer del proyecto nuevo
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
