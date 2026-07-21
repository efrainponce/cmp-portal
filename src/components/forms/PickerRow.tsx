import type { ReactNode } from 'react';

interface PickerRowProps {
  onClick: () => void;
  /** true mientras hay un guardado en curso — la fila deja de responder a
   * click para no disparar dos writes encimados (mismo criterio que antes:
   * bloquea toda la lista, no solo la fila que se está guardando). */
  disabled?: boolean;
  children: ReactNode;
}

/** Fila clicable de una lista de resultados de búsqueda — usada por los
 * modales de edición inline (EditCliente/EditContacto) que guardan al hacer
 * click en vez de tener un botón "Guardar" aparte. */
export function PickerRow({ onClick, disabled, children }: PickerRowProps) {
  return (
    <div
      className="row-hover"
      onClick={disabled ? undefined : onClick}
      style={{
        padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)',
        font: 'var(--text-label)', color: 'var(--ink)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </div>
  );
}
