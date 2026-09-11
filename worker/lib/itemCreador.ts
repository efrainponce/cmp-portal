// worker/lib/itemCreador.ts — Quién CREÓ un item desde el portal, por correo
// (Efraín, 2026-09-11: "quiero que le llegue el aviso solo a Rodrigo, es su
// herramienta de trabajo").
//
// Por qué existe: un vendedor sin asiento en Monday se da de alta con "Actuar en
// Monday como" y PRESTA el monday_user_id de alguien más (dal.createNativeIdentity).
// El Vendedor de sus oportunidades en Monday es entonces el dueño del id, y el
// selector 'owner' de las notificaciones (worker/lib/notify.ts) resolvía ese id
// a la PRIMERA identidad que lo tuviera: todos los avisos de Rodrigo (costeo
// confirmado, cotización lista, con WhatsApp) le llegaban a Efraín y Rodrigo
// nunca recibió ninguno. El item no dice quién de los dos lo hizo; esto sí.
//
// Solo desempata: se consulta cuando el id del Vendedor lo comparten varias
// identidades. Con un id de una sola persona nada cambia. Best-effort de punta a
// punta — un fallo aquí nunca tumba un create ni deja a nadie sin aviso (sin
// dato se cae a la regla de antes).
import type { Env } from '../env';
import type { MirrorItem } from '../../shared/types';
import { BOARDS } from '../../shared/boards';
import { linkedItemId, PROYECTO_OPP_REL } from './dal';

/** Se llama justo después de crear/duplicar. INSERT OR IGNORE: el primero gana. */
export async function registrarCreador(env: Env, itemId: number, email: string): Promise<void> {
  try {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO item_creador (item_id, email, created_at) VALUES (?, ?, ?)',
    ).bind(itemId, email, new Date().toISOString()).run();
  } catch (err) {
    console.warn(`[itemCreador] no se pudo registrar el creador de ${itemId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Correo de quien creó el item. Un Proyecto no lo crea el vendedor (nace de
 * "Ganar"), así que se busca el de su Oportunidad ligada. null si no se sabe. */
export async function creadorDeItem(env: Env, itemId: number): Promise<string | null> {
  try {
    const propio = await env.DB.prepare('SELECT email FROM item_creador WHERE item_id = ?')
      .bind(itemId).first<{ email: string }>();
    if (propio) return propio.email;
    const proyecto = await env.DB.prepare('SELECT * FROM items WHERE board_id = ? AND item_id = ?')
      .bind(BOARDS.proyectos.id, itemId).first<MirrorItem>();
    const oppId = proyecto ? linkedItemId(proyecto, PROYECTO_OPP_REL) : null;
    if (oppId == null) return null;
    const deOpp = await env.DB.prepare('SELECT email FROM item_creador WHERE item_id = ?')
      .bind(oppId).first<{ email: string }>();
    return deOpp?.email ?? null;
  } catch {
    return null;
  }
}

/** A quién le toca el aviso de "dueño" entre las identidades que comparten el
 * id del Vendedor (en el orden de siempre). Al creador, si es una de ellas; si
 * no se sabe quién lo creó, la primera — exactamente lo de antes. */
export function elegirDueno(candidatos: string[], creador: string | null): string | null {
  if (creador && candidatos.includes(creador)) return creador;
  return candidatos[0] ?? null;
}
