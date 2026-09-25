// worker/lib/updatesLineas.ts — El feed de Actualizaciones junta TODO lo que se
// escribió sobre la oportunidad/proyecto, no solo lo del item (Elisa, 2026-09-23:
// "algunos vendedores siguen dejando comentarios por producto y ya no aparecen
// en la plataforma nueva" — OPP-1100: Juan Carlos le escribió sobre la línea del
// botiquín y el portal mostraba el feed vacío).
//
// Tres fuentes que en Monday viven aparte y aquí salen en un solo feed:
//  - Updates de cada LÍNEA (subitem): etiquetados con "Producto · Color".
//  - En el Proyecto, los updates de su Oportunidad ligada y de sus líneas: al
//    ganarse, el drawer muestra el feed del Proyecto (Efraín, 2026-07-17) y la
//    conversación de venta desaparecía. Solo si el viewer puede leer esa
//    oportunidad por su cuenta (zona privada, board negado → no sale).
//  - "Comentarios Ventas" (`long_text_mm1hyszv`) de cada línea de la
//    Oportunidad: notas por producto que el portal nunca pintaba (693 líneas
//    en 252 oportunidades al 2026-09-23) — van como `tipo: 'nota'`.
//
// Se arma al LEER, desde Monday en vivo: el historial completo aparece sin
// copiar nada (nada de "backfill" que duplique updates en Monday) y lo que se
// escriba mañana sobre una línea, en Monday o donde sea, sale igual.
import type { Env } from '../env';
import type { Identity, MirrorItem } from '../../shared/types';
import type { UpdateDTO } from '../../shared/dto';
import type { BoardSlug } from '../../shared/boards';
import { BOARDS } from '../../shared/boards';
import { isNativeId } from '../../shared/nativeId';
import { canRead, canReadBoard } from '../../shared/visibility';
import { childrenOf, childSlugOf, getItem } from './dal';
import { fetchSubitemUpdates, type MondayUpdate } from './monday';
import { listUpdates } from './nativeUpdates';
import { seenByFor } from './updateSeen';
import { resolveOportunidadId } from './proyectoTallas';
import { folioDe } from './oportunidadLigada';
import { colTexts, etiquetaLinea } from './lineaEtiqueta';
import { separarFirma } from '../../shared/firmaPortal';

export { etiquetaLinea };

/** Comentarios Ventas de la línea de Oportunidad. */
export const COMENTARIOS_VENTAS_COL = 'long_text_mm1hyszv';

/** Las notas "Comentarios Ventas" de las líneas, una por texto distinto por
 * producto (una versión duplicada repite la misma nota en su línea nueva). */
export function notasDeLineas(rows: Pick<MirrorItem, 'item_id' | 'name' | 'columns'>[]): { id: string; etiqueta: string; texto: string }[] {
  const vistas = new Set<string>();
  const out: { id: string; etiqueta: string; texto: string }[] = [];
  for (const row of rows) {
    const texto = colTexts(row).get(COMENTARIOS_VENTAS_COL);
    if (!texto) continue;
    const etiqueta = etiquetaLinea('oportunidades_sub', row);
    const llave = `${etiqueta}\n${texto}`;
    if (vistas.has(llave)) continue;
    vistas.add(llave);
    out.push({ id: String(row.item_id), etiqueta, texto });
  }
  return out;
}

interface Fuente { slug: BoardSlug; itemId: number; origen?: string }
/** `dueno`: el item de Monday donde vive DE VERDAD el comentario — el de la
 * fuente, o la línea (subitem) si se escribió sobre un producto. Es a donde
 * hay que mandar una respuesta. */
interface Crudo { u: MondayUpdate; origen?: string; fuente: Fuente; dueno: { boardId: number; itemId: number } }

const alTiempo = (u: MondayUpdate) => new Date(u.created_at).getTime();

/** Ids de todo lo que va a pintar el feed — comentarios Y sus respuestas —
 * para pedir su "visto" de una vez. */
export function idsDelFeed(crudos: Pick<Crudo, 'u'>[]): string[] {
  return crudos.flatMap(c => [c.u.id, ...(c.u.replies ?? []).map(r => r.id)]);
}

/** Comentarios con su hilo, como los guarda Monday (Jorge, 2026-09-25: tarjeta
 * por comentario y respuestas adentro, estilo Slack). Antes el feed aplanaba
 * las respuestas en la misma lista y no se sabía a qué contestaban.
 *  - Comentarios: el más reciente arriba. Respuestas: en orden de conversación.
 *  - `author`: quien firmó si lo escribió el portal (Monday lo atribuye al
 *    dueño del token — shared/firmaPortal.ts); si no, el creador de Monday.
 *  - La respuesta hereda `fuente` del comentario (vive en el mismo item), pero
 *    no `origen`: el chip de producto ya va en la tarjeta. */
export function armarHilos(
  crudos: Omit<Crudo, 'dueno'>[], seenBy: Map<string, string[]>, itemIdPedido: number,
): UpdateDTO[] {
  const aDto = (u: MondayUpdate, fuente: Fuente, origen?: string): UpdateDTO => {
    const names = new Map<string, string>();
    for (const n of seenBy.get(u.id) ?? []) names.set(n.toLowerCase(), n);
    for (const v of u.viewers ?? []) if (v.user?.name) names.set(v.user.name.toLowerCase(), v.user.name);
    const body = u.text_body ?? '';
    const dto: UpdateDTO = {
      id: u.id, body, author: separarFirma(body).autor ?? u.creator?.name ?? 'Monday', createdAt: u.created_at,
      attachments: (u.assets ?? []).map(a => ({ id: a.id, name: a.name, ext: a.file_extension.replace(/^\./, '').toLowerCase() })),
      seenBy: [...names.values()].sort((a, b) => a.localeCompare(b)),
    };
    if (origen) dto.origen = origen;
    if (fuente.itemId !== itemIdPedido) dto.fuente = { slug: fuente.slug, itemId: String(fuente.itemId) };
    return dto;
  };
  return [...crudos]
    .sort((a, b) => alTiempo(b.u) - alTiempo(a.u))
    .map(({ u, origen, fuente }) => {
      const dto = aDto(u, fuente, origen);
      const replies = [...(u.replies ?? [])].sort((a, b) => alTiempo(a) - alTiempo(b)).map(r => aDto(r, fuente));
      if (replies.length) dto.replies = replies;
      return dto;
    });
}

/** Updates del item + los de sus líneas (etiquetados). Las líneas son
 * best-effort: si Monday falla ahí, el feed del item sale igual. */
async function updatesDe(env: Env, f: Fuente, viewer: Identity): Promise<{ crudos: Crudo[]; lineas: MirrorItem[] }> {
  const childSlug = childSlugOf(f.slug);
  const [propios, lineas, subUpdates] = await Promise.all([
    listUpdates(env, f.itemId),
    childSlug ? childrenOf(env, f.slug, f.itemId, viewer) : Promise.resolve([] as MirrorItem[]),
    // Un item nativo no tiene subitems en Monday — sus líneas no llevan feed.
    childSlug && !isNativeId(f.itemId)
      ? fetchSubitemUpdates(env, f.itemId).catch(() => [])
      : Promise.resolve([]),
  ]);
  const porId = new Map(lineas.map(l => [String(l.item_id), l]));
  const duenoPropio = { boardId: BOARDS[f.slug].id, itemId: f.itemId };
  const crudos: Crudo[] = propios.map(u => ({ u, origen: f.origen, fuente: f, dueno: duenoPropio }));
  for (const sub of subUpdates) {
    if (!sub.updates?.length) continue;
    const row = porId.get(String(sub.id));
    const producto = childSlug ? etiquetaLinea(childSlug, row ?? { name: sub.name, columns: '[]' }) : sub.name;
    const origen = f.origen ? `${f.origen} · ${producto}` : producto;
    const dueno = { boardId: childSlug ? BOARDS[childSlug].id : BOARDS[f.slug].id, itemId: Number(sub.id) };
    for (const u of sub.updates) crudos.push({ u, origen, fuente: f, dueno });
  }
  return { crudos, lineas };
}

/** De dónde sale el feed de un item: él mismo y, en el Proyecto, su
 * Oportunidad ligada si el viewer la puede leer por su cuenta. */
async function fuentesDe(env: Env, slug: BoardSlug, row: MirrorItem, viewer: Identity): Promise<Fuente[]> {
  const fuentes: Fuente[] = [{ slug, itemId: row.item_id }];
  if (slug === 'proyectos' && canReadBoard('oportunidades', viewer.role)) {
    const oppId = await resolveOportunidadId(env, viewer, row.item_id).catch(() => null);
    // Mismo scope que abrir la oportunidad directo: si no la puede ver, no sale.
    const opp = oppId ? await getItem(env, 'oportunidades', oppId, viewer) : null;
    if (opp) fuentes.push({ slug: 'oportunidades', itemId: opp.item_id, origen: folioDe(opp) || 'Oportunidad' });
  }
  return fuentes;
}

/** ¿Dónde vive el comentario `updateId` al que se quiere RESPONDER? Solo se
 * busca entre los comentarios de primer nivel del MISMO feed que este viewer ya
 * puede ver (Jorge, 2026-09-25): sin esto, cualquier id de update de todo
 * Monday recibiría la respuesta — mismo hueco que cerró el adjunto
 * (worker/routes/boards.ts). Una respuesta a una respuesta no existe en Monday
 * (los hilos son de un nivel), así que un id de respuesta tampoco se encuentra.
 * null = no está en su feed → la ruta responde 404. */
export async function ubicarComentario(
  env: Env, slug: BoardSlug, row: MirrorItem, viewer: Identity, updateId: string,
): Promise<{ boardId: number; itemId: number } | null> {
  const fuentes = await fuentesDe(env, slug, row, viewer);
  const partes = await Promise.all(fuentes.map(f => updatesDe(env, f, viewer)));
  return partes.flatMap(p => p.crudos).find(c => c.u.id === updateId)?.dueno ?? null;
}

/** El feed completo de Actualizaciones de un item ya autorizado (`row`). */
export async function feedActualizaciones(
  env: Env, slug: BoardSlug, row: MirrorItem, viewer: Identity,
): Promise<UpdateDTO[]> {
  const fuentes = await fuentesDe(env, slug, row, viewer);
  const partes = await Promise.all(fuentes.map(f => updatesDe(env, f, viewer)));

  // "Ojitos": Monday's own `viewers` solo se llena por vistas dentro de
  // Monday.com; se fusiona con lo que el portal registró en D1 (updateSeen.ts)
  // para que el indicador cubra ambas superficies. Dedupe case-insensitive.
  const crudos = partes.flatMap(p => p.crudos);
  const portalSeenBy = await seenByFor(env, idsDelFeed(crudos));
  const feed = armarHilos(crudos, portalSeenBy, row.item_id);

  // Notas "Comentarios Ventas" de las líneas de la Oportunidad (la propia o la
  // ligada al Proyecto), si el rol puede leer esa columna.
  if (!canRead('oportunidades_sub', COMENTARIOS_VENTAS_COL, viewer.role, viewer.email)) return feed;
  const notas: UpdateDTO[] = [];
  fuentes.forEach((f, i) => {
    if (f.slug !== 'oportunidades') return;
    for (const n of notasDeLineas(partes[i].lineas)) {
      notas.push({
        id: `nota-${n.id}`, body: n.texto, author: '', createdAt: '', attachments: [], seenBy: [],
        origen: f.origen ? `${f.origen} · ${n.etiqueta}` : n.etiqueta, tipo: 'nota',
      });
    }
  });
  return [...notas, ...feed];
}
