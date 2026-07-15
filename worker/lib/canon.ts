// Canonicalization + hashing for Monday column values (Module A owns; B calls).
// See docs/dev-contracts.md "Hash / echo contract". Sync on purpose (no Workers
// WebCrypto MD5, and a sync contract keeps write-hash == echo-hash trivial to
// compare across modules without an await). Verified against node:crypto MD5.

/** Public-domain MD5, hand-rolled for the Workers runtime. Non-secret use only
 * (change detection / echo suppression) — collision resistance is irrelevant here. */
export function md5(input: string): string {
  const rotl = (x: number, c: number) => (x << c) | (x >>> (32 - c));
  const toHexLE = (n: number) => {
    let s = '';
    for (let i = 0; i < 4; i++) s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
    return s;
  };
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const padLen = ((bytes.length + 8) >>> 6) * 64 + 64;
  const buf = new Uint8Array(padLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(padLen - 8, bitLen >>> 0, true);
  dv.setUint32(padLen - 4, Math.floor(bitLen / 2 ** 32) >>> 0, true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let chunk = 0; chunk < padLen; chunk += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(chunk + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  return toHexLE(a0) + toHexLE(b0) + toHexLE(c0) + toHexLE(d0);
}

/** Read shape from Monday's column_values ({text,value} incl. mirror/formula's
 * display_value mapped into text by monday.ts). */
export interface ReadColVal {
  text: string | null;
  value: string | null;
}

const NUMERIC_TYPES = new Set(['numeric', 'numbers', 'rating']);

// Port of _scalar from sync_producto.py: flatten any JSON-ish shape to a string.
function scalar(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(scalar).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('value' in o) return scalar(o.value);
    if ('text' in o) return scalar(o.text);
    if ('name' in o) return scalar(o.name);
    return '';
  }
  return String(v);
}

// Port of _num_str: strip thousand separators, drop spurious ".0".
function numStr(v: unknown): string {
  const raw = scalar(v).replace(/,/g, '').trim();
  if (raw === '') return '';
  const f = Number(raw);
  if (Number.isNaN(f)) return raw;
  return Number.isInteger(f) ? String(f) : String(f);
}

function tryParseJSON(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return raw; }
}

/**
 * Normalize a column value to a canonical string, for BOTH shapes:
 *  - write shape: the raw string we're about to send to Monday
 *  - read shape: Monday's {text, value} (mirror/formula already mapped text=display_value)
 * so that writeHash(write-shape) === writeHash(read-shape) once Monday echoes it back.
 */
export function canonValue(type: string, colVal: ReadColVal | string): string {
  const numeric = NUMERIC_TYPES.has(type);
  if (typeof colVal === 'string') {
    // board_relation's write shape is a bare linked-item id (see columnEncode.ts) —
    // compare against the read shape's linked_item_ids below, not display text.
    if (type === 'board_relation') return colVal.trim();
    return numeric ? numStr(colVal) : scalar(colVal).trim();
  }
  if (numeric) {
    const raw = colVal.value ?? colVal.text ?? '';
    return numStr(raw ? tryParseJSON(raw) : raw);
  }
  if (type === 'board_relation') {
    const parsed = colVal.value ? tryParseJSON(colVal.value) : null;
    const ids = (parsed as { linked_item_ids?: string[] } | null)?.linked_item_ids ?? [];
    return [...ids].sort().join(',');
  }
  return scalar(colVal.text ?? '').trim();
}

export type ColRawValue = ReadColVal | string;

/** md5 over JSON {colId: canonValue(type, colVal)} with sorted keys. */
export function writeHash(cols: Record<string, ColRawValue>, types: Record<string, string>): string {
  const canon: Record<string, string> = {};
  for (const id of Object.keys(cols).sort()) {
    canon[id] = canonValue(types[id] ?? 'text', cols[id]);
  }
  return md5(JSON.stringify(canon));
}

export interface RawColumn { id: string; type: string; text: string | null; value: string | null }

/** md5 of the raw columns array (as returned by Monday), sorted by column id.
 * Used for items.content_hash — reconcile-skip + ETag input. */
export function rawHash(columns: RawColumn[]): string {
  const sorted = [...columns].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return md5(JSON.stringify(sorted));
}
