// worker/lib/embellecimientoImagenes.ts — per-zona reference images for
// embellecimiento. oportunidades_sub has ONE file column (file_mm5akjy5) for
// all 8 zones, not one per zone, so the zone is encoded as a
// "<Zona>__<nombre original>" filename prefix rather than needing 8 columns.
import type { ExecutionContext } from 'hono';
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import { getItem } from './dal';
import { canWrite } from '../../shared/visibility';
import { addFileToColumn, fetchAssetPublicUrls } from './monday';
import { refetchItem } from '../sync';
import { BOARDS } from '../../shared/boards';
import { EMBELL_TEMPLATE_KEYS, type EmbellZoneKey } from '../../shared/embellecimiento';
import type { RawCol } from './serialize';

const COL = 'file_mm5akjy5';
const SEP = '__';

export class EmbellImageError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface FileEntry { name: string; assetId: number }

function parseFiles(columnsJson: string): FileEntry[] {
  try {
    const cols: RawCol[] = JSON.parse(columnsJson || '[]');
    const col = cols.find(c => c.id === COL);
    if (!col?.value) return [];
    return (JSON.parse(col.value) as { files?: FileEntry[] }).files ?? [];
  } catch {
    return [];
  }
}

function splitZone(name: string): { zone: string; original: string } | null {
  const idx = name.indexOf(SEP);
  if (idx === -1) return null;
  return { zone: name.slice(0, idx), original: name.slice(idx + SEP.length) };
}

const isZoneKey = (z: string): z is EmbellZoneKey => (EMBELL_TEMPLATE_KEYS as readonly string[]).includes(z);

/** Zone -> fresh (short-lived signed) image URL, for a line the viewer can see. */
export async function listZoneImages(env: Env, itemId: number, viewer: Identity): Promise<Record<string, string>> {
  const row = await getItem(env, 'oportunidades_sub', itemId, viewer);
  if (!row) throw new EmbellImageError(404, 'not found');

  const entries = parseFiles(row.columns)
    .map(f => ({ ...f, split: splitZone(f.name) }))
    .filter((f): f is FileEntry & { split: { zone: string; original: string } } => !!f.split && isZoneKey(f.split.zone));
  if (entries.length === 0) return {};

  const urls = await fetchAssetPublicUrls(env, entries.map(f => String(f.assetId)));
  const out: Record<string, string> = {};
  // Files are appended in upload order — a later upload for the same zone
  // overwrites the earlier URL here, matching "last upload wins" visually.
  for (const f of entries) {
    const url = urls.get(String(f.assetId));
    if (url) out[f.split.zone] = url;
  }
  return out;
}

/** Uploads a reference image for one embellecimiento zone. */
export async function uploadZoneImage(
  env: Env, ctx: ExecutionContext, itemId: number, viewer: Identity, zone: string, file: Blob, filename: string,
): Promise<{ zone: string; url: string }> {
  if (!isZoneKey(zone)) throw new EmbellImageError(400, 'zona inválida');
  if (!canWrite('oportunidades_sub', COL, viewer.role)) throw new EmbellImageError(403, 'forbidden');

  const row = await getItem(env, 'oportunidades_sub', itemId, viewer);
  if (!row) throw new EmbellImageError(404, 'not found');

  const asset = await addFileToColumn(env, itemId, COL, file, `${zone}${SEP}${filename}`);
  ctx.waitUntil(refetchItem(env, BOARDS.oportunidades_sub.id, itemId));
  return { zone, url: asset.publicUrl };
}
