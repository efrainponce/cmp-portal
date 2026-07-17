import { useState } from 'react';
import { ProyectoBoardList } from './ProyectoBoardList';
import { ProyectoDrawer } from './ProyectoDrawer';
import { PROJECT_BOARDS, type ProjectBoardKey } from '../../lib/projectStages';

interface Props {
  boardKey: ProjectBoardKey;
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  /** El id abierto es del board Proyectos — abrir la Oportunidad ligada navega
   * a su propio board/drawer (misma lógica que un link cruzado). */
  onOpenOportunidad: (id: string) => void;
}

/** Vista genérica de los 3 accesos de Proyectos (Documentación y Tallas,
 * Órdenes de Compra, Logística): lista por project_status + drawer nativo del
 * Proyecto. Mismo patrón que StageBoard, pero sobre el board Proyectos en vez
 * de Oportunidades filtrada por etapa (Efraín, 2026-07-17). */
export function ProyectoBoard({ boardKey, openId, onOpenChange, onOpenOportunidad }: Props) {
  const config = PROJECT_BOARDS[boardKey];
  const [q, setQ] = useState('');

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {!openId && <ProyectoBoardList config={config} q={q} onSearch={setQ} onOpen={onOpenChange} />}
      {openId && (
        <ProyectoDrawer
          id={openId}
          backLabel={`Volver a ${config.title}`}
          defaultTab={config.defaultTab}
          onBack={() => onOpenChange(null)}
          onOpenOportunidad={onOpenOportunidad}
        />
      )}
    </div>
  );
}
