// Botón "Exportar a Excel" de las listas (Productos, Instituciones, Contactos,
// Proveedores, etapas de Oportunidades, Proyectos, Lista de OC). Baja lo que la
// persona está viendo: los renglones ya filtrados y las columnas de la lista —
// ver src/lib/exportXlsx.ts para el porqué de no pedirle nada al server.
import { useState } from 'react';
import { Button } from '../core/Button';
import { IconDescargar } from '../icons';
import { useIsMobile } from '../../lib/useIsMobile';
import { exportarXlsx, type ColumnaExport } from '../../lib/exportXlsx';

interface Props<T> {
  /** Título del board: nombre de la hoja y del archivo (`<título>-<fecha>.xlsx`). */
  titulo: string;
  columnas: ColumnaExport<T>[];
  filas: T[];
}

export function ExportExcelButton<T>({ titulo, columnas, filas }: Props<T>) {
  const isMobile = useIsMobile();
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState(false);
  const vacio = filas.length === 0;

  const exportar = () => {
    if (trabajando) return;
    setTrabajando(true);
    setError(false);
    exportarXlsx(titulo, columnas, filas)
      .catch(() => setError(true))
      .finally(() => setTrabajando(false));
  };

  return (
    <Button
      variant={vacio ? 'disabled' : 'secondary'}
      onClick={exportar}
      title={error ? 'No se pudo generar el Excel — inténtalo de nuevo' : vacio ? 'No hay renglones que exportar' : `Exportar a Excel los ${filas.length} renglones de la lista`}
      // Mismo alto que el buscador y los filtros (36), y empujado a la derecha
      // del renglón. En cel solo el ícono: ahí el renglón ya va lleno de filtros.
      style={{ flex: 'none', height: 36, marginLeft: 'auto', padding: isMobile ? '0 10px' : '0 14px', opacity: trabajando ? 0.6 : 1, ...(error ? { borderColor: 'var(--status-perdida)' } : null) }}
    >
      <IconDescargar />
      {!isMobile && (trabajando ? 'Exportando…' : 'Exportar a Excel')}
    </Button>
  );
}
