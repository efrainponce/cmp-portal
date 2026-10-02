// Agrupa las notificaciones por oportunidad/proyecto (2026-10-01). Antes iban
// sueltas: en una semana salieron 659 avisos sobre 298 oportunidades y solo se
// leyó el 7% — una persona tenía 31 "Nuevo comentario" del mismo OPP, uno
// debajo del otro, y lo único que se usaba era "Marcar todo como leído". Puro.
import type { NotificationDTO } from '../../../shared/dto';

export interface GrupoNotif {
  key: string;
  /** null = aviso suelto (sin item, o con link externo a Airtable). */
  itemId: string | null;
  boardKey: string | null;
  nombre: string;
  /** De la más nueva a la más vieja. */
  notifs: NotificationDTO[];
  unread: number;
}

const DE_COMENTARIO = new Set(['mention', 'update_comment']);

/** `list` viene ordenada de la más nueva a la más vieja; los grupos salen en el
 * orden de su aviso más reciente. */
export function agruparNotificaciones(list: NotificationDTO[]): GrupoNotif[] {
  const grupos: GrupoNotif[] = [];
  const porItem = new Map<string, GrupoNotif>();
  for (const n of list) {
    if (!n.itemId || n.link) {
      grupos.push({ key: `n:${n.id}`, itemId: null, boardKey: n.boardKey, nombre: n.title, notifs: [n], unread: n.read ? 0 : 1 });
      continue;
    }
    let g = porItem.get(n.itemId);
    if (!g) {
      g = { key: `i:${n.itemId}`, itemId: n.itemId, boardKey: n.boardKey, nombre: n.itemName?.trim() || n.title, notifs: [], unread: 0 };
      porItem.set(n.itemId, g);
      grupos.push(g);
    }
    g.notifs.push(n);
    if (!n.read) g.unread++;
  }
  return grupos;
}

/** Pestaña del drawer a la que debe llevar el clic: si lo pendiente es un
 * comentario o una mención, directo a Actualizaciones. */
export function tabDeGrupo(g: GrupoNotif): string | null {
  const pendientes = g.notifs.filter((n) => !n.read);
  const ref = pendientes.length > 0 ? pendientes : g.notifs.slice(0, 1);
  return ref.some((n) => DE_COMENTARIO.has(n.kind)) ? 'actualizaciones' : null;
}

/** El aviso en una línea, sin repetir el nombre del item (ya va de encabezado
 * del grupo): "Nuevo comentario en OPP-1 - X" → "Ricardo: texto…";
 * "OPP-1 - X pasó a Cotización" → "Pasó a Cotización". */
export function resumenNotif(n: NotificationDTO, nombre: string): string {
  let t = n.title;
  if (nombre && t.includes(nombre)) {
    t = t.replace(nombre, '').replace(/\s+en\s*$/i, '').replace(/^\s*[-–:]\s*/, '').trim();
  }
  if (!t) t = n.title;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  const cuerpo = (n.body ?? '').replace(/\s+/g, ' ').trim();
  if (DE_COMENTARIO.has(n.kind) && cuerpo) {
    const quien = n.kind === 'mention' ? `${n.actor ?? 'Alguien'} te mencionó` : (n.actor ?? 'Comentario');
    return `${quien}: ${cuerpo}`;
  }
  return cuerpo ? `${t} — ${cuerpo}` : t;
}
