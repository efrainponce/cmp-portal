// Suplantar o cambiar el teléfono de otra cuenta permite actuar con SU correo.
// Las excepciones por correo deben seguir limitadas por la persona autenticada.
// Reusa las whitelists existentes; no agrega ni quita personas de ellas.
import { puedeVerUtilidades, puedeConsultarDireccion } from '../../shared/visibility';
import { isZonaPrivadaAdminPermitido } from './zonas';

export function puedeAdministrarIdentidad(actorEmail: string, targetEmail: string): boolean {
  return [puedeVerUtilidades, puedeConsultarDireccion, isZonaPrivadaAdminPermitido]
    .every(permiso => !permiso(targetEmail) || permiso(actorEmail));
}
