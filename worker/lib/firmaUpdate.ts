// worker/lib/firmaUpdate.ts — cómo firma el portal una actualización (comentario)
// que sube a Monday: "— <quién> vía Portal CMP".
//
// Cuando el autor tiene cuenta real de Monday, la firma va como @mention de
// verdad (Monday la pinta como link y le avisa). Pero un monday_user_id puede
// ser PRESTADO ("Actuar en Monday como", worker/routes/admin.ts): Rodrigo y
// Paola (Efraín, 2026-09-15: "Paola ya no tiene Monday, lo que suba usa mi
// identidad como Rodrigo; si hace una actualización ponle Paola") escriben con
// el id de Efraín. Ahí el mention sería un link a OTRA persona con el nombre
// de la autora encima, y además le notificaría a Efraín cada comentario. Así
// que el mention solo sale cuando el usuario de Monday con ese id ES el autor
// (mismo nombre o mismo correo); si no, texto plano con el nombre del portal.
import type { Identity } from '../../shared/types';
import type { MentionInput } from '../../shared/dto';

export interface UsuarioMondayMin { id: string | number; name: string; email?: string | null }

export interface FirmaAutor {
  /** Texto de la firma, ya con el "— " y el "vía Portal CMP". */
  firma: string;
  /** Mention a anexar al update (null = firma en texto plano). */
  mention: MentionInput | null;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** ¿El usuario de Monday con este id es la misma persona que el viewer? */
export function idMondayEsPropio(
  viewer: Pick<Identity, 'email' | 'nombre' | 'monday_user_id'>,
  usuario: UsuarioMondayMin | undefined,
): boolean {
  if (!usuario || String(usuario.id) !== String(viewer.monday_user_id)) return false;
  return (!!viewer.nombre && norm(usuario.name) === norm(viewer.nombre))
    || (!!usuario.email && norm(usuario.email) === norm(viewer.email));
}

export function firmaAutor(
  viewer: Pick<Identity, 'email' | 'nombre' | 'monday_user_id'>,
  usuario: UsuarioMondayMin | undefined,
  opts: { itemNativo: boolean },
): FirmaAutor {
  const nombre = viewer.nombre ?? viewer.email;
  // Nativos (id sintético <= 0) no tienen a quién apuntar el mention. Un ITEM
  // nativo (Zona Efrain) tampoco: su feed vive en D1 y ahí el HTML de la
  // mención se vería como HTML crudo.
  const conMention = !opts.itemNativo && viewer.monday_user_id > 0 && !!viewer.nombre
    && idMondayEsPropio(viewer, usuario);
  if (conMention) {
    return { firma: `— @${viewer.nombre} vía Portal CMP`, mention: { id: viewer.monday_user_id, nombre: viewer.nombre! } };
  }
  return { firma: `— ${nombre} vía Portal CMP`, mention: null };
}
