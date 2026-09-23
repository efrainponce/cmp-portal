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
import { isNativeId } from '../../shared/nativeId';
import { canRead, canReadBoard } from '../../shared/visibility';
import { childrenOf, childSlugOf, getItem } from './dal';
import { fetchSubitemUpdates, type MondayUpdate } from './monday';
import { listUpdates } from './nativeUpdates';
import { seenByFor } from './updateSeen';
import { resolveOportunidadId } from './proyectoTallas';
import { folioDe } from './oportunidadLigada';

/** Comentarios Ventas de la línea de Oportunidad. */
export const COMENTARIOS_VENTAS_COL = 'long_text_mm1hyszv';

// Qué columnas nombran la línea en cada board de subitems: el `name` del
// subitem es un número ("1") en Oportunidades, no sirve de etiqueta.
const ETIQUETA_COLS: Partial<Record<BoardSlug, { producto: string[]; extra: string[] }>> = {
  oportunidades_sub: { producto: ['text_mm0bkm1j', 'lookup_mm0x4kda'], extra: ['text_mm07s2mg'] },
  proyectos_sub: { producto: ['text_mm0hs17x'], extra: ['text_mm0h4a1c', 'text_mm1antcb'] },
};

function colTexts(row: Pick<MirrorItem, 'columns'>): Map<string, string> {
  const out = new Map<string, string>();
  try {
    for (const c of JSON.parse(row.columns || '[]') as { id: string; text?: string | null }[]) {
      const t = (c.text ?? '').trim();
      if (t) out.set(c.id, t);
    }
  } catch { /* columnas corruptas → sin etiqueta, cae al name */ }
  return out;
}

/** "Botiquín IFAK-002M · Negro" — producto (texto, o el espejo del catálogo)
 * más color/talla. Sin producto, el name del subitem. */
export function etiquetaLinea(childSlug: BoardSlug, row: Pick<MirrorItem, 'name' | 'columns'>): string {
  const cfg = ETIQUETA_COLS[childSlug];
  const texts = colTexts(row);
  const producto = cfg?.producto.map(id => texts.get(id)).find(Boolean) ?? row.name;
  const extra = (cfg?.extra ?? []).map(id => texts.get(id)).filter(Boolean);
  return [producto, ...extra].join(' · ');
}

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
interface Crudo { u: MondayUpdate; origen?: string; fuente: Fuente }

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
  const crudos: Crudo[] = propios.map(u => ({ u, origen: f.origen, fuente: f }));
  for (const sub of subUpdates) {
    if (!sub.updates?.length) continue;
    const row = porId.get(String(sub.id));
    const producto = childSlug ? etiquetaLinea(childSlug, row ?? { name: sub.name, columns: '[]' }) : sub.name;
    const origen = f.origen ? `${f.origen} · ${producto}` : producto;
    for (const u of sub.updates) crudos.push({ u, origen, fuente: f });
  }
  return { crudos, lineas };
}

/** El feed completo de Actualizaciones de un item ya autorizado (`row`). */
export async function feedActualizaciones(
  env: Env, slug: BoardSlug, row: MirrorItem, viewer: Identity,
): Promise<UpdateDTO[]> {
  const fuentes: Fuente[] = [{ slug, itemId: row.item_id }];
  if (slug === 'proyectos' && canReadBoard('oportunidades', viewer.role)) {
    const oppId = await resolveOportunidadId(env, viewer, row.item_id).catch(() => null);
    // Mismo scope que abrir la oportunidad directo: si no la puede ver, no sale.
    const opp = oppId ? await getItem(env, 'oportunidades', oppId, viewer) : null;
    if (opp) fuentes.push({ slug: 'oportunidades', itemId: opp.item_id, origen: folioDe(opp) || 'Oportunidad' });
  }

  const partes = await Promise.all(fuentes.map(f => updatesDe(env, f, viewer)));

  // Monday anida las replies bajo su update; el feed no tiene hilos, así que
  // se aplanan heredando el origen del padre.
  const planos = partes.flatMap(p => p.crudos)
    .flatMap(c => [c, ...(c.u.replies ?? []).map(r => ({ ...c, u: r }))])
    .sort((a, b) => new Date(b.u.created_at).getTime() - new Date(a.u.created_at).getTime());

  // "Ojitos": Monday's own `viewers` solo se llena por vistas dentro de
  // Monday.com; se fusiona con lo que el portal registró en D1 (updateSeen.ts)
  // para que el indicador cubra ambas superficies. Dedupe case-insensitive.
  const portalSeenBy = await seenByFor(env, planos.map(c => c.u.id));
  const feed: UpdateDTO[] = planos.map(({ u, origen, fuente }) => {
    const names = new Map<string, string>();
    for (const n of portalSeenBy.get(u.id) ?? []) names.set(n.toLowerCase(), n);
    for (const v of u.viewers ?? []) if (v.user?.name) names.set(v.user.name.toLowerCase(), v.user.name);
    const dto: UpdateDTO = {
      id: u.id, body: u.text_body ?? '', author: u.creator?.name ?? 'Monday', createdAt: u.created_at,
      attachments: (u.assets ?? []).map(a => ({ id: a.id, name: a.name, ext: a.file_extension.replace(/^\./, '').toLowerCase() })),
      seenBy: [...names.values()].sort((a, b) => a.localeCompare(b)),
    };
    if (origen) dto.origen = origen;
    if (fuente.itemId !== row.item_id) dto.fuente = { slug: fuente.slug, itemId: String(fuente.itemId) };
    return dto;
  });

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
