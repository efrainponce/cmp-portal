// shared/reacciones.ts — reacciones con emoji a los comentarios del feed de
// Actualizaciones (Jorge, 2026-09-25, fase 3; los 6 del selector de Monday).
//
// Viven SOLO en el portal (D1, worker/lib/reacciones.ts), con el nombre real de
// quien reacciona. No se mandan a Monday a propósito: todo lo que escribe el
// portal le aparece a Monday como del dueño del token (Efraín), y Monday deja
// un solo like por persona — cinco personas reaccionando desde el portal
// saldrían allá como UN like de Efraín.
//
// Los likes que alguien da DENTRO de Monday sí se muestran, de solo lectura.
// Casi no se usan (5 en 772 comentarios, 2026-09-25) y todos son 👍
// (`reaction_type` "+1", o null en el "me gusta" clásico).

export interface TipoReaccion { tipo: string; emoji: string; nombre: string }

/** En el orden del selector de Monday. `tipo` es lo que se guarda: una clave
 * estable en vez del emoji, que según el teclado llega con o sin selector de
 * variación (❤ vs ❤️). "+1" es el mismo valor que usa Monday. */
export const REACCIONES: readonly TipoReaccion[] = [
  { tipo: '+1', emoji: '👍', nombre: 'Me gusta' },
  { tipo: 'clap', emoji: '👏', nombre: 'Aplausos' },
  { tipo: 'pray', emoji: '🙏', nombre: 'Gracias' },
  { tipo: 'heart', emoji: '❤️', nombre: 'Me encanta' },
  { tipo: 'smile', emoji: '😃', nombre: 'Me alegra' },
  { tipo: 'check', emoji: '✅', nombre: 'Hecho' },
];

const POR_TIPO = new Map(REACCIONES.map(r => [r.tipo, r]));

export function esTipoReaccion(tipo: unknown): tipo is string {
  return typeof tipo === 'string' && POR_TIPO.has(tipo);
}

export function emojiDe(tipo: string): string {
  return POR_TIPO.get(tipo)?.emoji ?? '👍';
}

/** Un like de Monday al tipo del portal. null/"+1"/cualquier cosa que no
 * conozcamos → 👍: un like desconocido sigue siendo un like. */
export function tipoDeMonday(reactionType: string | null | undefined): string {
  return reactionType && POR_TIPO.has(reactionType) ? reactionType : '+1';
}

/** Lo que el feed pinta por comentario: una píldora por tipo con su conteo. */
export interface ReaccionDTO {
  tipo: string;
  count: number;
  /** Quiénes reaccionaron, para el tooltip. */
  nombres: string[];
  /** ¿El viewer tiene puesta esta reacción desde el portal? (un like dado en
   * Monday no se puede quitar desde aquí). */
  mia: boolean;
}

export interface ReaccionPortal { email: string; nombre: string; tipo: string }

/** Junta las reacciones del portal con los likes de Monday. Si la misma
 * persona reaccionó igual en los dos lados, cuenta una vez. */
export function agregarReacciones(
  portal: ReaccionPortal[],
  monday: { reactionType: string | null; nombre: string | null }[],
  viewerEmail: string,
): ReaccionDTO[] {
  const porTipo = new Map<string, { nombres: Map<string, string>; mia: boolean }>();
  const slot = (tipo: string) => {
    let s = porTipo.get(tipo);
    if (!s) { s = { nombres: new Map(), mia: false }; porTipo.set(tipo, s); }
    return s;
  };
  const yo = viewerEmail.trim().toLowerCase();
  for (const r of portal) {
    if (!esTipoReaccion(r.tipo)) continue;
    const s = slot(r.tipo);
    s.nombres.set(r.nombre.toLowerCase(), r.nombre);
    if (r.email.trim().toLowerCase() === yo) s.mia = true;
  }
  for (const l of monday) {
    const s = slot(tipoDeMonday(l.reactionType));
    const nombre = l.nombre ?? 'Alguien en Monday';
    s.nombres.set(nombre.toLowerCase(), nombre);
  }
  return REACCIONES.filter(r => porTipo.has(r.tipo)).map(r => {
    const s = porTipo.get(r.tipo)!;
    const nombres = [...s.nombres.values()];
    return { tipo: r.tipo, count: nombres.length, nombres, mia: s.mia };
  });
}

/** El cambio optimista en pantalla al poner/quitar la reacción propia, antes
 * de que responda el server. */
export function alternarReaccion(
  lista: ReaccionDTO[], tipo: string, activa: boolean, miNombre: string,
): ReaccionDTO[] {
  const actual = lista.find(r => r.tipo === tipo);
  if (activa) {
    if (actual?.mia) return lista;
    const yaListado = actual?.nombres.some(n => n.toLowerCase() === miNombre.toLowerCase()) ?? false;
    const nueva: ReaccionDTO = actual
      ? { ...actual, mia: true, nombres: yaListado ? actual.nombres : [...actual.nombres, miNombre], count: yaListado ? actual.count : actual.count + 1 }
      : { tipo, count: 1, nombres: [miNombre], mia: true };
    const resto = lista.filter(r => r.tipo !== tipo);
    return REACCIONES.map(r => (r.tipo === tipo ? nueva : resto.find(x => x.tipo === r.tipo)))
      .filter((r): r is ReaccionDTO => !!r);
  }
  if (!actual?.mia) return lista;
  const nombres = actual.nombres.filter(n => n.toLowerCase() !== miNombre.toLowerCase());
  return nombres.length === 0
    ? lista.filter(r => r.tipo !== tipo)
    : lista.map(r => (r.tipo === tipo ? { ...r, mia: false, nombres, count: nombres.length } : r));
}
