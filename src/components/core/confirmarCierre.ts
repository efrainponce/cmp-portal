// Cierre con confirmación de los formularios largos (Efraín, 2026-09-22: "no
// puedes cerrar la modal haciendo click en otro lado… pide confirmación").
// Va junto con `closeOnBackdrop={false}` en el <Modal>: el `cerrar` que regresa
// se usa para la ✕/Escape (onClose del Modal) Y para el botón Cancelar.
export function confirmarCierre(
  onClose: () => void,
  { saving = false, pedir = true, mensaje = '¿Cerrar sin guardar? Se pierde lo que capturaste.' }: {
    /** A medio guardar no se cierra. */
    saving?: boolean;
    /** false = cierra sin preguntar (ej. un form de edición sin cambios). */
    pedir?: boolean;
    mensaje?: string;
  } = {},
): () => void {
  return () => {
    if (saving) return;
    if (pedir && !window.confirm(mensaje)) return;
    onClose();
  };
}
