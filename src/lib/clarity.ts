// Microsoft Clarity (snippet en index.html). Aquí solo se le pasa QUIÉN es la
// sesión, para poder filtrar grabaciones por persona en el dashboard de Clarity.
// Con "ver como" activo se manda el correo del ADMIN real (impersonatedBy), no
// el del suplantado: la sesión la está viviendo el admin.
// Clarity hashea el id antes de mandarlo; el correo en claro no sale del navegador.
import type { MeDTO } from './api';

type ClarityFn = (cmd: string, ...args: unknown[]) => void;

export function identificarEnClarity(me: MeDTO) {
  const clarity = (window as unknown as { clarity?: ClarityFn }).clarity;
  if (typeof clarity !== 'function') return;
  try {
    const email = me.impersonatedBy?.email ?? me.email;
    clarity('identify', email, undefined, undefined, me.impersonatedBy?.nombre ?? me.nombre);
    clarity('set', 'rol', me.role);
    if (me.impersonatedBy) clarity('set', 'ver_como', me.email);
  } catch { /* telemetría: nunca tumbar la app */ }
}
