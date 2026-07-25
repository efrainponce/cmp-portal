// Documentos del portal + firma electrónica (2026-07-25). Ver shared/documents.ts
// para el contrato y worker/lib/pdf/* para el render.
//
// Reglas que sostienen la firma:
//  · El documento GUARDA su snapshot de datos (`data`) al crearse. El PDF firmado
//    se re-renderiza de ese snapshot, nunca de una lectura fresca del mirror —
//    si no, el contenido firmado cambiaría bajo los pies del firmante.
//  · `sha256` es la huella del PDF base tal como quedó en R2. Antes de asentar
//    una firma se re-lee y se re-hashea: si no coincide, la firma se RECHAZA.
//  · Un PDF ajeno (cotización generada por cmp-tallas) se copia a R2 al sellarlo,
//    para que el original firmado sea inmutable aunque Monday cambie después.
//
// Las tablas se crean lazy (mismo patrón que api_cache/rosterCache) para que la
// feature funcione sin aplicar el schema a mano en remoto.
import type { Env } from '../env';
import type { Identity } from '../../shared/types';
import type { RawCol } from './serialize';
import {
  DOC_TEMPLATES, SIGN_INTENT, documentFilename,
  type DocTemplateId, type DocumentDTO, type SignatureDTO,
} from '../../shared/documents';
import { renderTemplate, type DocData, type RenderedSignature } from './pdf/templates';
import { jpegInfo } from './pdf/writer';
import { getItem, childrenOf } from './dal';
import { canRead } from '../../shared/visibility';
import { getBoardAccess } from './boardAccess';
import { readPortalFile, normalizeFileKey } from './portalFiles';
import { BOARDS } from '../../shared/boards';
import { emitNotification } from './notify';

export class DocumentError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_SIGNATURE_BYTES = 400 * 1024;   // trazo del canvas; 400KB es holgado
const MAX_SEALED_BYTES = 12 * 1024 * 1024; // PDF ajeno que se copia a R2

// ── Tablas (lazy) ─────────────────────────────────────────────────────────────
let tablesReady = false;

export async function ensureDocumentTables(env: Env): Promise<void> {
  if (tablesReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS documents (
      id           TEXT PRIMARY KEY,
      template_id  TEXT NOT NULL,
      title        TEXT NOT NULL,
      source_kind  TEXT NOT NULL,
      source_id    TEXT NOT NULL,
      board_key    TEXT,
      folio        TEXT,
      data         TEXT NOT NULL,
      sha256       TEXT NOT NULL,
      bytes        INTEGER NOT NULL DEFAULT 0,
      created_by   TEXT NOT NULL,
      created_at   TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_kind, source_id)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS document_signatures (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id  TEXT NOT NULL,
      signer_email TEXT NOT NULL,
      signer_name  TEXT NOT NULL,
      signer_role  TEXT NOT NULL,
      label        TEXT NOT NULL,
      intent       TEXT NOT NULL,
      sha256       TEXT NOT NULL,
      image_key    TEXT,
      ip           TEXT,
      user_agent   TEXT,
      signed_at    TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_docsig_once ON document_signatures(document_id, signer_email)'),
  ]);
  tablesReady = true;
}

// ── Filas ─────────────────────────────────────────────────────────────────────
interface DocRow {
  id: string;
  template_id: string;
  title: string;
  source_kind: string;
  source_id: string;
  board_key: string | null;
  folio: string | null;
  data: string;
  sha256: string;
  bytes: number;
  created_by: string;
  created_at: string;
}

interface SigRow {
  id: number;
  document_id: string;
  signer_email: string;
  signer_name: string;
  signer_role: string;
  label: string;
  intent: string;
  sha256: string;
  image_key: string | null;
  ip: string | null;
  user_agent: string | null;
  signed_at: string;
}

const baseKey = (docId: string): string => `documentos/${docId}/base.pdf`;
const signedKey = (docId: string): string => `documentos/${docId}/firmado.pdf`;
const signatureKey = (docId: string, n: number): string => `documentos/${docId}/firma-${n}.jpg`;

/** Etiquetas de las cajas de firma, en orden. La plantilla define el rol de cada
 * firma: en una remisión la primera entrega y la segunda recibe. */
export function signatureLabels(templateId: DocTemplateId): string[] {
  switch (templateId) {
    case 'remision-inventario': return ['Entrega', 'Recibe'];
    case 'resumen-oportunidad': return ['Elaboró', 'Autorizó'];
    case 'constancia-firma': return ['Firma electrónica', 'Segunda firma'];
  }
}

export async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as ArrayBuffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Lectura de datos fuente ───────────────────────────────────────────────────
function colMap(columnsJson: string): Map<string, RawCol> {
  try {
    const cols: RawCol[] = JSON.parse(columnsJson || '[]');
    return new Map(cols.map(c => [c.id, c]));
  } catch {
    return new Map();
  }
}

// Oportunidades (docs/monday-column-map.md) — solo columnas ya mapeadas.
const OPP_FOLIO = 'pulse_id_mm0qcq0m';
const OPP_ETAPA = 'deal_stage';
const OPP_VENDEDOR = 'deal_owner';
const OPP_CONTACTO = 'deal_contact';
const OPP_INSTITUCION = 'lookup_mm1bs976';
const OPP_ZONA = 'dropdown_mm03g067';
const OPP_FECHA_LIMITE = 'deal_expected_close_date';
const OPP_FECHA_COTIZACION = 'date_mm09mv5b';
const OPP_VIGENCIA = 'text_mm0gje0';
const OPP_ENTREGA = 'text_mm0gjrrd';
const OPP_COMENTARIOS = 'long_text_mm1m416j';
// Subitems (líneas) — mismos ids que worker/lib/quoteVersions.ts.
const SUB_PRODUCTO_NOMBRE = 'lookup_mm0x4kda';
const SUB_PRODUCTO_TXT = 'text_mm0bkm1j';
const SUB_SKU = 'lookup_mkzn7x9a';
const SUB_COLOR = 'text_mm07s2mg';
const SUB_CANTIDAD = 'numeric_mkzm6399';
const SUB_PRECIO = 'numeric_mkzneg3d';
const SUB_EMB_STATUS = 'color_mm1b34bg';

const num = (text?: string | null): number => Number((text ?? '').replace(/,/g, '')) || 0;

async function resumenData(env: Env, oppId: number, viewer: Identity): Promise<DocData> {
  const row = await getItem(env, 'oportunidades', oppId, viewer);
  if (!row) throw new DocumentError(404, 'oportunidad no encontrada');

  // Se lee el mirror CRUDO (dal), no el DTO ya filtrado por el serializer, así
  // que la whitelist se aplica aquí a mano: un documento nunca debe imprimir
  // una columna que el firmante no podría ver en pantalla.
  const cols = colMap(row.columns);
  const text = (id: string): string | undefined =>
    canRead('oportunidades', id, viewer.role) ? cols.get(id)?.text?.trim() || undefined : undefined;
  const verPrecio = canRead('oportunidades_sub', SUB_PRECIO, viewer.role);

  const lineas = (await childrenOf(env, 'oportunidades', oppId, viewer)).map(child => {
    const c = colMap(child.columns);
    return {
      producto: (c.get(SUB_PRODUCTO_NOMBRE)?.text || c.get(SUB_PRODUCTO_TXT)?.text || child.name).trim(),
      sku: c.get(SUB_SKU)?.text?.trim() || undefined,
      color: c.get(SUB_COLOR)?.text?.trim() || undefined,
      cantidad: num(c.get(SUB_CANTIDAD)?.text),
      precioUnitario: verPrecio ? num(c.get(SUB_PRECIO)?.text) || undefined : undefined,
      embellecimiento: (c.get(SUB_EMB_STATUS)?.text ?? '').trim() === 'Con Embellecimiento',
    };
  });

  return {
    kind: 'resumen-oportunidad',
    nombre: row.name,
    folio: text(OPP_FOLIO) ?? String(oppId),
    etapa: text(OPP_ETAPA),
    vendedor: text(OPP_VENDEDOR),
    cliente: text(OPP_CONTACTO),
    institucion: text(OPP_INSTITUCION),
    zona: text(OPP_ZONA),
    fechaLimite: text(OPP_FECHA_LIMITE),
    fechaCotizacion: text(OPP_FECHA_COTIZACION),
    vigencia: text(OPP_VIGENCIA),
    tiempoEntrega: text(OPP_ENTREGA),
    comentarios: text(OPP_COMENTARIOS),
    lineas,
  };
}

interface MovementJoinRow {
  id: number; type: string; product_name: string; quantity: number;
  origen: string | null; destino: string | null;
  captured_by: string; folio: string | null; notes: string | null; created_at: string;
}

async function remisionData(env: Env, movementId: number, viewer: Identity): Promise<DocData> {
  const access = await getBoardAccess(env, viewer.role);
  if (!access.includes('inventario')) throw new DocumentError(403, 'sin acceso a inventario');

  const row = await env.DB.prepare(
    `SELECT m.id, m.type, m.product_name, m.quantity, m.captured_by, m.folio, m.notes, m.created_at,
            o.name AS origen, d.name AS destino
       FROM movements m
       LEFT JOIN warehouses o ON o.id = m.origin_id
       LEFT JOIN warehouses d ON d.id = m.destination_id
      WHERE m.id = ?`,
  ).bind(movementId).first<MovementJoinRow>();
  if (!row) throw new DocumentError(404, 'movimiento no encontrado');

  return {
    kind: 'remision-inventario',
    movimientoId: row.id,
    tipo: row.type,
    producto: row.product_name,
    cantidad: row.quantity,
    origen: row.origen ?? undefined,
    destino: row.destino ?? undefined,
    capturadoPor: row.captured_by,
    folio: row.folio ?? undefined,
    notas: row.notes ?? undefined,
    fecha: row.created_at,
  };
}

// ── Crear ─────────────────────────────────────────────────────────────────────
export interface CreateInput {
  templateId: DocTemplateId;
  sourceId: string;
  sourceLabel?: string;
}

export async function createDocument(env: Env, viewer: Identity, input: CreateInput): Promise<DocumentDTO> {
  await ensureDocumentTables(env);
  const template = DOC_TEMPLATES[input.templateId];
  if (!template) throw new DocumentError(400, 'plantilla desconocida');
  if (!template.create.includes(viewer.role)) throw new DocumentError(403, 'tu rol no puede generar este documento');

  const createdAt = new Date().toISOString();
  // `archivo` guarda el key normalizado (ver normalizeFileKey); las demás
  // fuentes, el id tal cual.
  const sourceId = template.source === 'archivo' ? normalizeFileKey(input.sourceId) : input.sourceId;

  // Volver a generar la misma plantilla sobre la misma fuente REEMPLAZA el
  // documento que aún no tiene firmas, en vez de acumular copias (el caso normal
  // es "lo generé, corregí un dato, lo vuelvo a generar"). En cuanto tiene una
  // firma ya no se toca: ahí nace un documento nuevo, porque el anterior es
  // evidencia de algo que alguien firmó. El id se decide ANTES de renderizar
  // porque va impreso en el pie del PDF y es lo que sella el hash.
  const reusable = await env.DB.prepare(
    `SELECT d.id FROM documents d
      WHERE d.template_id = ? AND d.source_kind = ? AND d.source_id = ?
        AND NOT EXISTS (SELECT 1 FROM document_signatures s WHERE s.document_id = d.id)
      ORDER BY d.created_at LIMIT 1`,
  ).bind(template.id, template.source, sourceId).first<{ id: string }>();
  const docId = reusable?.id ?? crypto.randomUUID();

  let data: DocData;
  let boardKey: string | null = null;
  let baseBytes: Uint8Array;

  if (template.source === 'oportunidad') {
    const oppId = Number(input.sourceId);
    if (!Number.isFinite(oppId)) throw new DocumentError(400, 'sourceId inválido');
    data = await resumenData(env, oppId, viewer);
    boardKey = 'oportunidades';
    baseBytes = renderTemplate({ docId, data, generatedAt: createdAt, signatures: [] });
  } else if (template.source === 'movimiento') {
    const movementId = Number(input.sourceId);
    if (!Number.isFinite(movementId)) throw new DocumentError(400, 'sourceId inválido');
    data = await remisionData(env, movementId, viewer);
    boardKey = 'inventario';
    baseBytes = renderTemplate({ docId, data, generatedAt: createdAt, signatures: [] });
  } else {
    // `archivo`: el PDF ya existe (cmp-tallas lo subió a Monday). Se copia a R2
    // para que lo sellado sea inmutable; el PDF que se genera es la constancia.
    const key = normalizeFileKey(input.sourceId);
    if (!key.startsWith('oportunidades/')) throw new DocumentError(400, 'referencia de archivo inválida');
    const file = await readPortalFile(env, key, viewer);
    if (!file) throw new DocumentError(404, 'archivo no encontrado');
    if (file.bytes.length > MAX_SEALED_BYTES) throw new DocumentError(413, 'el archivo es demasiado grande para sellarlo');
    const oppId = Number(key.split('/')[1]);
    data = {
      kind: 'constancia-firma',
      archivo: input.sourceLabel || (key.split('/').pop() ?? key),
      referencia: key,
      contexto: Number.isFinite(oppId) ? `Oportunidad ${oppId}` : undefined,
    };
    boardKey = 'oportunidades';
    baseBytes = file.bytes;
  }

  const sha256 = await sha256Hex(baseBytes);
  await env.FILES.put(baseKey(docId), baseBytes, { httpMetadata: { contentType: 'application/pdf' } });
  // El PDF firmado que hubiera quedado en caché ya no corresponde a este base.
  if (reusable) await env.FILES.delete(signedKey(docId));

  const folio = data.kind === 'resumen-oportunidad' ? data.folio ?? null
    : data.kind === 'remision-inventario' ? data.folio ?? `MOV-${data.movimientoId}`
    : null;

  if (reusable) {
    await env.DB.prepare(
      `UPDATE documents SET data = ?, sha256 = ?, bytes = ?, folio = ?, created_by = ?, created_at = ? WHERE id = ?`,
    ).bind(JSON.stringify(data), sha256, baseBytes.length, folio, viewer.email, createdAt, docId).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO documents (id, template_id, title, source_kind, source_id, board_key, folio, data, sha256, bytes, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      docId, template.id, template.label, template.source, sourceId, boardKey, folio,
      JSON.stringify(data), sha256, baseBytes.length, viewer.email, createdAt,
    ).run();
  }

  const doc = await loadDocument(env, docId, viewer);
  if (!doc) throw new DocumentError(500, 'no se pudo leer el documento recién generado');
  return doc;
}

// ── Lectura ───────────────────────────────────────────────────────────────────
/** Verifica que el viewer pueda ver la fuente del documento. Lanza 404 si no
 * (nunca 403: igual que dal.getItem, la existencia no se filtra). */
async function assertSourceVisible(env: Env, row: DocRow, viewer: Identity): Promise<void> {
  if (row.source_kind === 'movimiento') {
    const access = await getBoardAccess(env, viewer.role);
    if (!access.includes('inventario')) throw new DocumentError(404, 'not found');
    return;
  }
  const oppId = row.source_kind === 'oportunidad' ? Number(row.source_id) : Number(row.source_id.split('/')[1]);
  if (!Number.isFinite(oppId)) throw new DocumentError(404, 'not found');
  const opp = await getItem(env, 'oportunidades', oppId, viewer);
  if (!opp) throw new DocumentError(404, 'not found');
}

async function signaturesOf(env: Env, docId: string): Promise<SigRow[]> {
  const res = await env.DB.prepare(
    'SELECT * FROM document_signatures WHERE document_id = ? ORDER BY id',
  ).bind(docId).all<SigRow>();
  return res.results ?? [];
}

function toDTO(row: DocRow, sigs: SigRow[]): DocumentDTO {
  const templateId = row.template_id as DocTemplateId;
  const template = DOC_TEMPLATES[templateId];
  const signatures: SignatureDTO[] = sigs.map(s => ({
    id: s.id,
    signerEmail: s.signer_email,
    signerName: s.signer_name,
    signerRole: s.signer_role,
    signedAt: s.signed_at,
    sha256: s.sha256,
    imageUrl: s.image_key ? `/api/documents/${row.id}/firmas/${s.id}` : null,
    ip: s.ip,
  }));
  return {
    id: row.id,
    templateId,
    title: row.title,
    sourceKind: row.source_kind as DocumentDTO['sourceKind'],
    sourceId: row.source_id,
    boardKey: row.board_key,
    folio: row.folio,
    sha256: row.sha256,
    bytes: row.bytes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    signatures,
    complete: signatures.length >= (template?.maxSignatures ?? 1),
  };
}

async function rowOf(env: Env, docId: string, viewer: Identity): Promise<DocRow> {
  await ensureDocumentTables(env);
  const row = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(docId).first<DocRow>();
  if (!row) throw new DocumentError(404, 'not found');
  await assertSourceVisible(env, row, viewer);
  return row;
}

export async function loadDocument(env: Env, docId: string, viewer: Identity): Promise<DocumentDTO | null> {
  try {
    const row = await rowOf(env, docId, viewer);
    return toDTO(row, await signaturesOf(env, docId));
  } catch (err) {
    if (err instanceof DocumentError && err.status === 404) return null;
    throw err;
  }
}

/** Documentos de una fuente (oportunidad / movimiento / archivo sellado). */
export async function listDocuments(
  env: Env, viewer: Identity, sourceKind: string, rawSourceId: string,
): Promise<DocumentDTO[]> {
  await ensureDocumentTables(env);
  const sourceId = sourceKind === 'archivo' ? normalizeFileKey(rawSourceId) : rawSourceId;
  // Para una oportunidad interesan también las constancias de sus archivos, cuyo
  // source_id es el key `oportunidades/{oppId}/…` — de ahí el LIKE del segundo bind.
  const res = sourceKind === 'oportunidad'
    ? await env.DB.prepare(
        `SELECT * FROM documents
          WHERE (source_kind = 'oportunidad' AND source_id = ?)
             OR (source_kind = 'archivo' AND source_id LIKE ?)
          ORDER BY created_at DESC`,
      ).bind(sourceId, `oportunidades/${sourceId}/%`).all<DocRow>()
    : await env.DB.prepare(
        'SELECT * FROM documents WHERE source_kind = ? AND source_id = ? ORDER BY created_at DESC',
      ).bind(sourceKind, sourceId).all<DocRow>();

  const rows = res.results ?? [];
  if (rows.length === 0) return [];
  await assertSourceVisible(env, rows[0], viewer);

  const out: DocumentDTO[] = [];
  for (const row of rows) out.push(toDTO(row, await signaturesOf(env, row.id)));
  return out;
}

/** Bytes del PDF a descargar. `signed` devuelve el documento con las cajas de
 * firma llenas (o la constancia, si la fuente era un archivo ajeno). */
export async function documentPdf(
  env: Env, docId: string, viewer: Identity, signed: boolean,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const row = await rowOf(env, docId, viewer);
  const templateId = row.template_id as DocTemplateId;
  const filename = documentFilename({ templateId, folio: row.folio, id: row.id }, signed);

  if (!signed) {
    const object = await env.FILES.get(baseKey(docId));
    if (!object) throw new DocumentError(404, 'not found');
    return { bytes: new Uint8Array(await object.arrayBuffer()), filename };
  }

  const sigs = await signaturesOf(env, docId);
  if (sigs.length === 0) throw new DocumentError(409, 'el documento no tiene firmas');

  const cached = await env.FILES.get(signedKey(docId));
  if (cached) return { bytes: new Uint8Array(await cached.arrayBuffer()), filename };

  const bytes = await renderSigned(env, row, sigs);
  return { bytes, filename };
}

/** Trazo de una firma (JPEG) — scoped igual que el documento. */
export async function signatureImage(env: Env, docId: string, sigId: number, viewer: Identity): Promise<Uint8Array | null> {
  await rowOf(env, docId, viewer);
  const sig = await env.DB.prepare(
    'SELECT image_key FROM document_signatures WHERE id = ? AND document_id = ?',
  ).bind(sigId, docId).first<{ image_key: string | null }>();
  if (!sig?.image_key) return null;
  const object = await env.FILES.get(sig.image_key);
  return object ? new Uint8Array(await object.arrayBuffer()) : null;
}

// ── Render del PDF firmado ────────────────────────────────────────────────────
async function renderSigned(env: Env, row: DocRow, sigs: SigRow[]): Promise<Uint8Array> {
  const data = JSON.parse(row.data) as DocData;
  const signatures: RenderedSignature[] = [];
  for (const s of sigs) {
    let image: Uint8Array | undefined;
    if (s.image_key) {
      const object = await env.FILES.get(s.image_key);
      if (object) image = new Uint8Array(await object.arrayBuffer());
    }
    signatures.push({
      label: s.label,
      name: s.signer_name,
      role: s.signer_role,
      email: s.signer_email,
      signedAt: s.signed_at,
      sha256: s.sha256,
      ip: s.ip,
      image,
    });
  }

  const bytes = renderTemplate({
    docId: row.id,
    data,
    generatedAt: row.created_at,
    signatures,
    baseSha256: row.sha256,
  });
  await env.FILES.put(signedKey(row.id), bytes, { httpMetadata: { contentType: 'application/pdf' } });
  return bytes;
}

// ── Firmar ────────────────────────────────────────────────────────────────────
export interface SignInput {
  signatureJpeg?: string;   // data URL
  typedName?: string;
  intent: string;
  ip?: string | null;
  userAgent?: string | null;
}

/** data URL de JPEG → bytes validados. Rechaza cualquier cosa que no sea un
 * JPEG real (el writer solo sabe embeber DCTDecode) o que exceda el límite. */
export function decodeSignatureJpeg(dataUrl: string): Uint8Array {
  const match = /^data:image\/jpe?g;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!match) throw new DocumentError(400, 'la firma debe venir como data URL image/jpeg');
  const binary = atob(match[1].replace(/\s+/g, ''));
  if (binary.length > MAX_SIGNATURE_BYTES) throw new DocumentError(413, 'el trazo de la firma es demasiado grande');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (!jpegInfo(bytes)) throw new DocumentError(400, 'el trazo de la firma no es un JPEG válido');
  return bytes;
}

export async function signDocument(
  env: Env, docId: string, viewer: Identity, input: SignInput,
): Promise<DocumentDTO> {
  const row = await rowOf(env, docId, viewer);
  const templateId = row.template_id as DocTemplateId;
  const template = DOC_TEMPLATES[templateId];

  if (!template.sign.includes(viewer.role)) throw new DocumentError(403, 'tu rol no puede firmar este documento');
  if (input.intent !== SIGN_INTENT) throw new DocumentError(400, 'falta aceptar el consentimiento de firma');

  const existing = await signaturesOf(env, docId);
  if (existing.some(s => s.signer_email === viewer.email)) throw new DocumentError(409, 'ya firmaste este documento');
  if (existing.length >= template.maxSignatures) throw new DocumentError(409, 'el documento ya tiene todas sus firmas');

  // Portón de integridad: se firma el PDF que está en R2, no una idea de él.
  const object = await env.FILES.get(baseKey(docId));
  if (!object) throw new DocumentError(404, 'el PDF del documento no está disponible');
  const currentHash = await sha256Hex(new Uint8Array(await object.arrayBuffer()));
  if (currentHash !== row.sha256) throw new DocumentError(409, 'el documento cambió desde que se generó — vuelve a generarlo');

  let imageKey: string | null = null;
  if (input.signatureJpeg) {
    const bytes = decodeSignatureJpeg(input.signatureJpeg);
    imageKey = signatureKey(docId, existing.length + 1);
    await env.FILES.put(imageKey, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  }

  const label = signatureLabels(templateId)[existing.length] ?? 'Firma';
  const signerName = (input.typedName || viewer.nombre || viewer.email).trim().slice(0, 120);

  await env.DB.prepare(
    `INSERT INTO document_signatures
       (document_id, signer_email, signer_name, signer_role, label, intent, sha256, image_key, ip, user_agent, signed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    docId, viewer.email, signerName, viewer.role, label, input.intent, row.sha256,
    imageKey, input.ip ?? null, (input.userAgent ?? '').slice(0, 300) || null, new Date().toISOString(),
  ).run();

  const sigs = await signaturesOf(env, docId);
  await renderSigned(env, row, sigs);

  // Aviso al que generó el documento cuando lo firma alguien más (best-effort).
  if (row.created_by !== viewer.email) {
    const itemId = row.board_key === 'oportunidades'
      ? Number(row.source_kind === 'oportunidad' ? row.source_id : row.source_id.split('/')[1])
      : undefined;
    await emitNotification(env, {
      recipientEmail: row.created_by,
      severity: 'importante',
      kind: 'documento_firmado',
      title: `${signerName} firmó: ${row.title}`,
      body: row.folio ? `Folio ${row.folio}` : null,
      boardKey: row.board_key ?? undefined,
      boardId: row.board_key === 'oportunidades' ? BOARDS.oportunidades.id : undefined,
      itemId: Number.isFinite(itemId) ? itemId : undefined,
      actor: signerName,
      dedupeKey: `docsig:${docId}:${viewer.email}`,
    });
  }

  return toDTO(row, sigs);
}
