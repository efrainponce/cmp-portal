// worker/lib/nativeSeq.ts — contador del siguiente item_id sintético para items
// nativos (shared/nativeId.ts NATIVE_ID_FLOOR). Mismo patrón lazy-table + INSERT
// ON CONFLICT que oc_folios/costeo_folios/cotizacion_folios/tallas_folios.
import type { Env } from '../env';
import { NATIVE_ID_FLOOR } from '../../shared/nativeId';

let tableReady = false;

export async function reserveNativeId(env: Env): Promise<number> {
  if (!tableReady) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS native_seq (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL DEFAULT 0)`).run();
    tableReady = true;
  }
  await env.DB.prepare(`INSERT INTO native_seq (id, seq) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET seq = seq + 1`).run();
  const row = await env.DB.prepare(`SELECT seq FROM native_seq WHERE id = 1`).first<{ seq: number }>();
  return NATIVE_ID_FLOOR + (row?.seq ?? 1);
}
