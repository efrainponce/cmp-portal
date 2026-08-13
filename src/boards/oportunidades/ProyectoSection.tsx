// Sección "Proyecto" compartida por las pestañas Tallas y Órdenes de compra:
// los flujos de tallas/OC de cmp-tallas viven en el item Proyecto ligado a la
// oportunidad (Proyectos board_relation_mm0hf0y3), no en la Oportunidad.
// Botones espejo de los de Monday, gated por rol; las tallas importadas se
// muestran desde el mirror (proyectos_sub) — el objetivo es que dejen de vivir
// solo en el Excel.
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { getProyecto, proyectoAction, type ItemDetailDTO, type ItemDTO, type ProyectoAction, type EstadoHistorialEntryDTO } from '../../lib/api';
import { patchItem, reportarTallasIncorrectas, getEstadoHistorial, getProductoResumen, patchProductoResumen, getCotizacionVirtual, type QuoteLineSnapshot } from '../../lib/apiClient';
import { useMe } from '../../lib/useMe';
import { ConfirmButton } from '../../components/core/ConfirmButton';
import { Button } from '../../components/core/Button';
import { MonoTag, StatusBadge } from '../../components/core/Badges';
import { Modal } from '../../components/core/Modal';
import { fmtMoney } from '../../lib/format';
import { ProgressBattery } from '../../components/board/ProgressBattery';
import { batteryFromSubitems, ESTADO_PRODUCTO_ORDER } from '../../lib/estadoProductoBuckets';
import { PdfIcon } from './tabs/cotizacion/CotizacionPdfRow';

const PdfCanvasPreview = lazy(() =>
  import('../../components/core/PdfCanvasPreview').then((m) => ({ default: m.PdfCanvasPreview })),
);

// Proyectos (18395657594)
export const P_SHEET_LINK = 'link_mm1amwz8';     // Google Sheet de tallas
const P_DRIVE_LINK = 'link_mm462saa';     // Carpeta Drive (visible Compras)
const P_TALLAS_PDF = 'file_mm0hcrtz';     // PDFs relación de tallas (visible Compras)
const P_OC_PDF = 'file_mm0hj9pn';         // PDFs órdenes de compra (visible Compras)
export const P_OC_CLIENTE = 'file_mm0hayh4'; // OC/cotización/contrato firmado por el cliente (vendedor sube)
const P_METODO_PAGO = 'text_mm4cct6a';    // Método de pago (default del Proyecto, prellenado por tarjeta)
const P_COND_PAGO = 'text_mm4cdyjb';      // Condiciones de pago (default del Proyecto, prellenado por tarjeta)

// Subelementos de Proyectos (18395657609)
const S_PRODUCTO = 'text_mm0hs17x';
const S_SKU = 'text_mm0hyrfs';
const S_COLOR = 'text_mm0h4a1c';
const S_TALLA = 'text_mm1antcb';
const S_CANTIDAD = 'numeric_mm0hj2q4';
// Proveedor de la línea — visible solo compras/admin (shared/visibility.ts, grupo AC).
const S_PROVEEDOR = 'board_relation_mm1cfgv5';
const S_PROVEEDOR_RAZON = 'lookup_mm1d2y9b';
const S_PROVEEDOR_CORREO = 'lookup_mm2145g';
const S_ESTADO = 'color_mm0hqf79';
const S_COSTO = 'numeric_mm1dj4fp';
const S_DESCUENTO = 'numeric_mm1dmsaz';
const S_MONEDA = 'text_mm1gdsvg';
const S_ENTREGA_PROV = 'date_mm20xdtm';

// Estado del producto (color_mm0hqf79) — hex reales de shared/column-meta.gen.ts, no inventados.
export const ESTADO_PRODUCTO_COLORS: Record<string, string> = {
  'Con vendedor para entrega cliente': '#9d50dd',
  'En CMP para embellecer': '#74afcc',
  'En embellecimiento': '#5559df',
  'En CMP para entrega cliente': '#784bd1',
  'En produccion': '#a1e3f6',
  'OC Proveedor lista': '#c4c4c4',
  'Entregado': '#037f4c',
  'Incidencia/Retraso': '#df2f4a',
  'OC Proveedor enviada': '#a9bee8',
  'Pendiente OC al Prov': '#e484bd',
};

export interface ProyectoState {
  loading: boolean;
  proyecto: ItemDetailDTO | null;
  reload: () => void;
}

/** Carga el Proyecto ligado a la oportunidad (null si aún no existe). */
export function useProyecto(oppId: string, enabled: boolean): ProyectoState {
  const [proyecto, setProyecto] = useState<ItemDetailDTO | null>(null);
  const [loading, setLoading] = useState(enabled);

  const reload = useCallback(() => {
    if (!enabled) return;
    setLoading(true);
    getProyecto(oppId)
      .then(setProyecto)
      .catch(() => setProyecto(null))
      .finally(() => setLoading(false));
  }, [oppId, enabled]);

  useEffect(reload, [reload]);
  return { loading, proyecto, reload };
}

// Link columns llegan del serializer solo como texto "Etiqueta - https://…"
// (no están en PARSE_VALUE_TYPES) — se extrae la URL del texto.
export function linkUrl(item: ItemDetailDTO, colId: string): string {
  const col = item.cols[colId];
  if (!col) return '';
  const v = col.value;
  if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') {
    return (v as { url: string }).url;
  }
  const m = (col.text ?? '').match(/https?:\/\/\S+/);
  return m ? m[0] : '';
}

function parseFiles(text?: string): { url: string; name: string }[] {
  if (!text) return [];
  return text.split(',').map(s => s.trim()).filter(Boolean).map(url => ({
    url,
    name: decodeURIComponent(url.split('/').pop() || url),
  }));
}

/** Reconstruye el key de R2 igual que DocumentacionTab.toR2Files — tallas/OC
 * viven en el Proyecto, así que el oppId no es directo (viene del lookup
 * inverso getProyectoOportunidad y puede tardar en resolver o venir null).
 * Sin oppId se deja la URL firmada de Monday que ya trae el mirror. */
function toR2Files(files: { url: string; name: string }[], oppId: string | null, categoria: string): { url: string; name: string }[] {
  if (!oppId) return files;
  return files.map(f => ({ ...f, url: `/api/files/oportunidades/${oppId}/${categoria}/${encodeURIComponent(f.name)}` }));
}

interface ActionOutcome { kind: 'ok' | 'warn' | 'error'; text: string }

function describeResult(action: ProyectoAction, res: Record<string, unknown>): ActionOutcome {
  if (res.ok === true) {
    switch (action) {
      case 'tallas-regenerar': return { kind: 'ok', text: 'Archivo de tallas generado. El link aparece en unos segundos (Actualizar).' };
      case 'tallas-confirmar': return { kind: 'ok', text: `Tallas validadas (${String(res.validation ?? 'TODO CUADRA')}). PDF ${String(res.pdf_filename ?? '')} enviado a firma del vendedor.` };
      case 'tallas-importar': return { kind: 'ok', text: `Tallas importadas a Monday: ${String(res.talla_subitems ?? '?')} líneas + ${String(res.embell_subitems ?? 0)} embellecimientos.` };
      case 'generar-oc': {
        const ordenes = Array.isArray(res.ordenes) ? res.ordenes as Record<string, unknown>[] : [];
        const folios = ordenes.map(o => String(o.folio_orden ?? '')).filter(Boolean).join(', ');
        return { kind: 'ok', text: `Órdenes generadas y enviadas a firma${folios ? `: ${folios}` : ''}.` };
      }
    }
  }
  if (res.skipped) return { kind: 'warn', text: String(res.reason ?? 'No había nada que procesar.') };
  if (action === 'tallas-confirmar' && res.validation) {
    return { kind: 'warn', text: `El desglose no cuadra (${String(res.validation)}). Revisa el archivo de tallas y vuelve a intentar.` };
  }
  return { kind: 'error', text: String(res.reason ?? res.error ?? 'La acción no se pudo completar. Revisa el update en Monday.') };
}

const OUTCOME_COLOR: Record<ActionOutcome['kind'], string> = {
  ok: 'var(--status-ganada)', warn: 'var(--status-esperando)', error: 'var(--status-perdida)',
};

/** Barra de acciones + resultado. `actions` decide qué botones mostrar. */
function ProyectoActionBar({ proyecto, reload, actions }: {
  proyecto: ItemDetailDTO; reload: () => void; actions: ProyectoAction[];
}) {
  const me = useMe();
  const role = me?.role ?? 'vendedor';
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);

  const run = (action: ProyectoAction) => async () => {
    setOutcome(null);
    try {
      const res = await proyectoAction(proyecto.id, action);
      setOutcome(describeResult(action, res));
      reload();
    } catch {
      setOutcome({ kind: 'error', text: 'No se pudo ejecutar la acción. Verifica tu conexión.' });
    }
  };

  const sheetUrl = linkUrl(proyecto, P_SHEET_LINK);
  const ocCliente = !!proyecto.cols[P_OC_CLIENTE]?.text;
  const canVendedor = role === 'vendedor' || role === 'admin';
  const canCompras = role === 'compras' || role === 'admin';

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {actions.includes('tallas-regenerar') && (
          <ConfirmButton
            label={sheetUrl ? 'Regenerar archivo de tallas' : 'Crear archivo de tallas'}
            confirmLabel="¿Regenerar? (conserva cantidades)"
            busyLabel="Generando archivo…"
            variant="secondary"
            onConfirm={run('tallas-regenerar')}
          />
        )}
        {actions.includes('tallas-confirmar') && (
          <ConfirmButton
            label="Validar tallas (vendedor)"
            confirmLabel="¿Validar y mandar a firma?"
            busyLabel="Validando… puede tardar unos minutos, no cierres esta pantalla"
            disabled={!canVendedor || !sheetUrl || !ocCliente}
            title={!canVendedor ? 'Solo el vendedor valida las tallas' : !ocCliente ? 'Falta subir la orden de compra / cotización firmada / contrato del cliente (pestaña Documentación)' : !sheetUrl ? 'Primero crea el archivo de tallas' : 'Valida el desglose y genera el PDF a firma'}
            onConfirm={run('tallas-confirmar')}
          />
        )}
        {actions.includes('tallas-importar') && (
          <ConfirmButton
            label="Importar tallas a Monday (compras)"
            confirmLabel="¿Importar? Reemplaza las líneas del proyecto"
            busyLabel="Importando…"
            variant="secondary"
            disabled={!canCompras || !sheetUrl}
            title={!canCompras ? 'Solo Compras importa las tallas' : !sheetUrl ? 'Primero crea el archivo de tallas' : 'Borra y recrea los subitems del proyecto desde el archivo'}
            onConfirm={run('tallas-importar')}
          />
        )}
        {actions.includes('generar-oc') && (
          <ConfirmButton
            label="Generar todas las OC pendientes"
            confirmLabel="¿Generar? Se manda a firmas"
            busyLabel="Generando órdenes… puede tardar unos minutos, no cierres esta pantalla"
            variant="secondary"
            disabled={!canCompras}
            title={!canCompras ? 'Solo Compras genera órdenes de compra' : 'Una OC por proveedor + firmas Elaborado→Revisado→Autorizado'}
            onConfirm={run('generar-oc')}
          />
        )}
      </div>
      {outcome && (
        <div style={{
          marginTop: 10, padding: '10px 14px', borderRadius: 'var(--radius-lg)',
          border: `1px solid ${OUTCOME_COLOR[outcome.kind]}`, background: 'var(--bg-raised)',
          font: 'var(--text-label)', color: 'var(--ink-secondary)',
        }}>
          {outcome.text}
        </div>
      )}
    </div>
  );
}

function ProyectoLinks({ proyecto }: { proyecto: ItemDetailDTO }) {
  const sheetUrl = linkUrl(proyecto, P_SHEET_LINK);
  const driveUrl = linkUrl(proyecto, P_DRIVE_LINK);
  if (!sheetUrl && !driveUrl) return null;
  const style = { font: 'var(--text-label-strong)', color: 'var(--accent)', textDecoration: 'none' } as const;
  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
      {sheetUrl && <a href={sheetUrl} target="_blank" rel="noreferrer" style={style}>Abrir archivo de tallas ↗</a>}
      {driveUrl && <a href={driveUrl} target="_blank" rel="noreferrer" style={style}>Carpeta Drive ↗</a>}
    </div>
  );
}

function FileList({ label, files }: { label: string; files: { url: string; name: string }[] }) {
  if (files.length === 0) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
        {files.map((f, i) => (
          <a key={i} href={f.url} target="_blank" rel="noreferrer"
            style={{ padding: '10px 12px', borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', background: '#fff', textDecoration: 'none', font: 'var(--text-body-strong)', color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {f.name}
          </a>
        ))}
      </div>
    </div>
  );
}

interface CantidadEdit { draft?: string; saving?: boolean; error?: string }

function norm(s: string): string {
  return s.trim().toLowerCase();
}

interface CotizadoMaps {
  byProductoColor: Map<string, number>;
  bySkuColor: Map<string, number>;
}

/** Dos índices sobre las líneas cotizadas: producto+color (nombre del subitem,
 * como lo captura TallaBoxesCapture) y sku+color de respaldo — el "Importar
 * tallas" de cmp-tallas puede reescribir el nombre del producto al copiarlo al
 * Proyecto, y ahí el SKU (más estable) es lo único que sigue cruzando.
 *
 * Lee de la cotización VIRTUAL del Proyecto (getCotizacionVirtual), no de los
 * subitems crudos de la Oportunidad: un "Editar/Dividir" hecho ya en el
 * Proyecto (post-venta) solo vive en `proyecto_cotizacion_ajustes` — nunca
 * toca Monday — así que leer los subitems reales dejaba el "Cotizado" de las
 * tallas pegado a la línea de antes de dividir (bug reportado por Pam,
 * 2026-08-11: dividió 150 multicam en 75+75 y el color nuevo salía "sin línea
 * de cotización para comparar"). Mientras nadie ajusta nada la vista virtual
 * es idéntica a la real, así que esto no cambia nada para el caso común. */
function cotizadoMapsFrom(lineas: QuoteLineSnapshot[]): CotizadoMaps {
  const byProductoColor = new Map<string, number>();
  const bySkuColor = new Map<string, number>();
  for (const l of lineas) {
    const color = norm(l.color || '');
    const cantidad = l.cantidad || 0;
    const pKey = `${norm(l.producto)}|${color}`;
    byProductoColor.set(pKey, (byProductoColor.get(pKey) ?? 0) + cantidad);
    if (l.sku?.trim()) {
      const sKey = `${norm(l.sku)}|${color}`;
      bySkuColor.set(sKey, (bySkuColor.get(sKey) ?? 0) + cantidad);
    }
  }
  return { byProductoColor, bySkuColor };
}

/** Cotizado de un grupo del Proyecto: primero por producto+color, con
 * respaldo por sku+color si el nombre no cruza. */
function lookupCotizado(group: TallaGroup, maps: CotizadoMaps): number | null {
  const color = norm(group.color);
  const byProducto = maps.byProductoColor.get(`${norm(group.producto)}|${color}`);
  if (byProducto !== undefined) return byProducto;
  if (group.sku) {
    const bySku = maps.bySkuColor.get(`${norm(group.sku)}|${color}`);
    if (bySku !== undefined) return bySku;
  }
  return null;
}

interface TallaGroup { producto: string; sku?: string; color: string; rows: ItemDTO[] }

// Orden canónico de tallas alfabéticas — las numéricas (pantalón, etc.) y
// cualquier talla no reconocida se van al final, en orden alfabético.
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL', 'XXXXXL'];

function sizeRank(raw: string): number {
  const s = raw.trim().toUpperCase();
  const idx = SIZE_ORDER.indexOf(s);
  if (idx !== -1) return idx;
  const nxl = s.match(/^(\d+)\s*X\s*L$/); // "2XL" == XXL, "3XL" == XXXL, ...
  if (nxl) return SIZE_ORDER.indexOf('XL') + Number(nxl[1]) - 1;
  return Infinity;
}

function sortByTalla(rows: ItemDTO[]): ItemDTO[] {
  return [...rows].sort((a, b) => {
    const ta = a.cols[S_TALLA]?.text || '';
    const tb = b.cols[S_TALLA]?.text || '';
    const ra = sizeRank(ta);
    const rb = sizeRank(tb);
    if (ra !== rb) return ra - rb;
    return ta.localeCompare(tb, 'es', { numeric: true });
  });
}

/** Una tarjeta por producto+color (no solo producto): dos colores del mismo
 * producto son dos tarjetas, cada una con sus propias tallas — mismo criterio
 * de agrupado que TallaBoxesCapture (TallasTab.tsx), donde cada card ya es un
 * subitem de cotización = un producto+color específico. */
function groupByProductoColor(lineas: ItemDTO[]): TallaGroup[] {
  const groups = new Map<string, TallaGroup>();
  for (const l of lineas) {
    const producto = l.cols[S_PRODUCTO]?.text || l.name;
    const color = l.cols[S_COLOR]?.text || '';
    const key = `${norm(producto)}|${norm(color)}`;
    if (!groups.has(key)) groups.set(key, { producto, sku: l.cols[S_SKU]?.text || undefined, color, rows: [] });
    groups.get(key)!.rows.push(l);
  }
  return [...groups.values()].map(g => ({ ...g, rows: sortByTalla(g.rows) }));
}

const boxInputStyle = {
  width: 52, textAlign: 'center' as const, font: 'var(--text-label-strong)', color: 'var(--ink)',
  padding: '6px 4px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: '#fff',
} as const;

type CardTone = 'empty' | 'unknown' | 'ok' | 'mismatch';

/** empty = nada capturado todavía (gris); unknown = sin línea de cotización
 * contra qué comparar (neutro); ok/mismatch = cuadra o no contra lo cotizado
 * (verde claro / rojo — Efraín, 2026-08-06). */
const CARD_TONE_STYLE: Record<CardTone, { border: string; background: string; text: string }> = {
  empty: { border: 'var(--border)', background: 'var(--bg-sunken)', text: 'var(--ink-tertiary)' },
  unknown: { border: 'var(--border)', background: '#fff', text: 'var(--ink-tertiary)' },
  ok: { border: 'var(--status-ganada)', background: 'var(--status-ganada-tint)', text: 'var(--status-ganada)' },
  mismatch: { border: 'var(--status-perdida)', background: 'var(--status-perdida-tint)', text: 'var(--status-perdida)' },
};

/** Tarjeta de un producto+color: una cajita editable por talla + "Cotizado" vs
 * lo ya asignado. Cantidad se guarda inline contra la línea del Proyecto en
 * Monday (sin tocar el Sheet, así que "Importar tallas a Monday" la vuelve a
 * pisar); "Reportar tallas incorrectas" avisa a Compras (Monday + WhatsApp,
 * worker/lib/proyectoTallas.ts) cuando el desglose no cuadra. */
function TallaBoxCard({ group, cotizado, canEditCantidad, canReport, proyectoId, reload }: {
  group: TallaGroup; cotizado: number | null; canEditCantidad: boolean; canReport: boolean;
  proyectoId: string; reload: () => void;
}) {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, CantidadEdit>>({});
  const [reportOutcome, setReportOutcome] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const cantidadOf = (r: ItemDTO) => overrides[r.id] ?? r.cols[S_CANTIDAD]?.text ?? '0';

  const commit = async (row: ItemDTO) => {
    const draft = edits[row.id]?.draft;
    if (draft == null) return;
    const trimmed = draft.trim();
    const current = cantidadOf(row);
    if (trimmed === '' || trimmed === current) {
      setEdits(p => ({ ...p, [row.id]: { ...p[row.id], draft: undefined, error: undefined } }));
      return;
    }
    const n = Number(trimmed.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) {
      setEdits(p => ({ ...p, [row.id]: { ...p[row.id], error: 'Cantidad inválida' } }));
      return;
    }
    setEdits(p => ({ ...p, [row.id]: { ...p[row.id], saving: true, error: undefined } }));
    try {
      await patchItem('proyectos_sub', row.id, { [S_CANTIDAD]: String(n) });
      setOverrides(p => ({ ...p, [row.id]: String(n) }));
      setEdits(p => ({ ...p, [row.id]: { draft: undefined, saving: false } }));
      reload();
    } catch {
      setEdits(p => ({ ...p, [row.id]: { ...p[row.id], saving: false, error: 'No se pudo guardar' } }));
    }
  };

  const asignadas = group.rows.reduce((s, r) => s + (Number(cantidadOf(r).replace(/,/g, '')) || 0), 0);
  const cuadra = cotizado !== null && asignadas === cotizado;
  let progresoTexto: string;
  if (cotizado === null) {
    progresoTexto = `${asignadas} asignadas (sin línea de cotización para comparar)`;
  } else if (cuadra) {
    progresoTexto = `${asignadas} asignadas — cuadra con lo cotizado`;
  } else if (asignadas < cotizado) {
    progresoTexto = `Faltan ${cotizado - asignadas} de ${cotizado} (${asignadas} asignadas)`;
  } else {
    progresoTexto = `Sobran ${asignadas - cotizado} sobre los ${cotizado} cotizados (${asignadas} asignadas)`;
  }
  const cardTone: CardTone = asignadas === 0 ? 'empty' : cotizado === null ? 'unknown' : cuadra ? 'ok' : 'mismatch';
  const tone = CARD_TONE_STYLE[cardTone];

  const reportar = async () => {
    setReportOutcome(null);
    const res = await reportarTallasIncorrectas(proyectoId, group.producto, group.color || undefined);
    setReportOutcome(res.ok
      ? { kind: 'ok', text: 'Compras notificado (Monday + WhatsApp).' }
      : { kind: 'error', text: res.error ?? 'No se pudo reportar.' });
  };

  return (
    <div style={{ border: `1px solid ${tone.border}`, borderRadius: 'var(--radius-xl)', padding: 14, background: tone.background }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{group.producto}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
            {group.sku && <MonoTag>{group.sku}</MonoTag>}
            {group.color && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>{group.color}</span>}
            {cotizado !== null && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>· Cotizado: {cotizado}</span>}
          </div>
        </div>
        {canReport && (
          <ConfirmButton
            label="Reportar tallas incorrectas"
            confirmLabel="¿Avisar a Compras que este desglose no cuadra?"
            busyLabel="Avisando…"
            variant="secondary"
            onConfirm={reportar}
          />
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {group.rows.map(r => {
          const st = edits[r.id];
          return (
            <label key={r.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>{r.cols[S_TALLA]?.text || '—'}</span>
              {canEditCantidad ? (
                <input
                  type="number" min={0} inputMode="numeric"
                  value={st?.draft ?? cantidadOf(r)}
                  onChange={e => setEdits(p => ({ ...p, [r.id]: { ...p[r.id], draft: e.target.value } }))}
                  onBlur={() => commit(r)}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  disabled={st?.saving}
                  style={{ ...boxInputStyle, border: `1px solid ${st?.error ? 'var(--status-perdida)' : 'var(--border)'}` }}
                />
              ) : (
                <div style={boxInputStyle}>{cantidadOf(r)}</div>
              )}
            </label>
          );
        })}
      </div>
      <div style={{ marginTop: 10, font: 'var(--text-caption-strong)', color: tone.text }}>{progresoTexto}</div>
      {reportOutcome && (
        <div style={{ marginTop: 6, font: 'var(--text-caption)', color: reportOutcome.kind === 'ok' ? 'var(--status-ganada)' : 'var(--status-perdida)' }}>
          {reportOutcome.text}
        </div>
      )}
    </div>
  );
}

/** Grid de tallas importadas (subitems del Proyecto): una tarjeta por
 * producto+color con una cajita editable por talla — mismo estilo que la
 * captura de tallas del vendedor (TallasTab.tsx), en vez de la lista de pills
 * anidados de antes. */
function TallasGrid({ lineas, cotizadoMaps, canEditCantidad, canReport, proyectoId, reload }: {
  lineas: ItemDTO[]; cotizadoMaps: CotizadoMaps; canEditCantidad: boolean; canReport: boolean;
  proyectoId: string; reload: () => void;
}) {
  if (lineas.length === 0) {
    return (
      <div style={{ marginTop: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
        Aún no hay tallas importadas en Monday — captura el desglose en el archivo de tallas y pide a Compras importarlo.
      </div>
    );
  }

  const grupos = groupByProductoColor(lineas);

  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {grupos.map(g => (
        <TallaBoxCard
          key={`${g.producto}|${g.color}`}
          group={g}
          cotizado={lookupCotizado(g, cotizadoMaps)}
          canEditCantidad={canEditCantidad}
          canReport={canReport}
          proyectoId={proyectoId}
          reload={reload}
        />
      ))}
    </div>
  );
}

const EMPTY_COTIZADO_MAPS: CotizadoMaps = { byProductoColor: new Map(), bySkuColor: new Map() };

export function ProyectoTallasSection({ state, oppId }: { state: ProyectoState; oppId: string | null }) {
  const me = useMe();
  const canEditCantidad = me?.role === 'vendedor' || me?.role === 'compras' || me?.role === 'admin';
  const [cotizadoMaps, setCotizadoMaps] = useState<CotizadoMaps>(EMPTY_COTIZADO_MAPS);
  const proyectoId = state.proyecto?.id ?? null;

  // Lo cotizado por producto+color viene de la cotización VIRTUAL del
  // Proyecto (un solo GET, 100% D1) para que un "Editar/Dividir" post-venta
  // ya hecho ahí se refleje aquí también — ver cotizadoMapsFrom.
  useEffect(() => {
    if (!proyectoId) { setCotizadoMaps(EMPTY_COTIZADO_MAPS); return; }
    getCotizacionVirtual(proyectoId)
      .then(d => setCotizadoMaps(cotizadoMapsFrom(d.lines ?? [])))
      .catch(() => setCotizadoMaps(EMPTY_COTIZADO_MAPS));
  }, [proyectoId]);

  if (state.loading) return <Shell hint="Buscando el proyecto ligado…" />;
  if (!state.proyecto) {
    return <Shell hint="Esta oportunidad aún no tiene Proyecto en Monday — se crea cuando se GANA la oportunidad, y ahí vive el desglose de tallas." />;
  }
  const p = state.proyecto;
  return (
    <div style={{ marginTop: 20 }}>
      <ProyectoLinks proyecto={p} />
      <ProyectoActionBar proyecto={p} reload={state.reload} actions={['tallas-regenerar', 'tallas-confirmar', 'tallas-importar']} />
      <TallasGrid
        lineas={p.children ?? []}
        cotizadoMaps={cotizadoMaps}
        canEditCantidad={canEditCantidad}
        canReport={canEditCantidad}
        proyectoId={p.id}
        reload={state.reload}
      />
      <FileList label="Relaciones de tallas (PDF)" files={toR2Files(parseFiles(p.cols[P_TALLAS_PDF]?.text), oppId, 'tallas')} />
    </div>
  );
}

interface ProveedorGroup {
  key: string;
  proveedorId: string | null;
  nombre: string;
  nombreItem: string;
  correo: string;
  lineas: ItemDTO[];
}

/** Agrupa las líneas del proyecto por proveedor (board_relation_mm1cfgv5 → id real,
 * no solo el texto — necesario para mandar `onlyProveedor` a cmp-tallas). */
function groupByProveedor(lineas: ItemDTO[]): ProveedorGroup[] {
  const groups = new Map<string, ProveedorGroup>();
  for (const l of lineas) {
    const rel = l.cols[S_PROVEEDOR]?.value as { linked_item_ids?: string[] } | undefined;
    const id = rel?.linked_item_ids?.[0];
    const key = id != null ? String(id) : 'sin-proveedor';
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        proveedorId: id != null ? String(id) : null,
        nombre: l.cols[S_PROVEEDOR_RAZON]?.text || l.cols[S_PROVEEDOR]?.text || 'Sin proveedor asignado',
        nombreItem: l.cols[S_PROVEEDOR]?.text || '',
        correo: l.cols[S_PROVEEDOR_CORREO]?.text || '',
        lineas: [],
      });
    }
    groups.get(key)!.lineas.push(l);
  }
  return [...groups.values()].sort((a, b) =>
    a.key === 'sin-proveedor' ? 1 : b.key === 'sin-proveedor' ? -1 : a.nombre.localeCompare(b.nombre));
}

function normalizeProveedorNombre(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Empareja el PDF de OC más reciente de un proveedor por nombre de archivo:
 * cmp-tallas los sube a file_mm0hj9pn como `orden_compra_<nombre proveedor>.pdf`
 * (verificado en datos reales — sin id explícito que los ligue). Se prueban
 * nombre e item crudo como candidatos porque `ProveedorGroup.nombre` prioriza
 * la razón social, que puede no ser el texto que cmp-tallas usó. El arreglo
 * conserva orden de subida, así que el último match es el más reciente. */
function findLatestOcFile(files: { url: string; name: string }[], candidatos: string[]): { url: string; name: string } | undefined {
  const wanted = candidatos.filter(Boolean).map(normalizeProveedorNombre);
  if (wanted.length === 0) return undefined;
  let latest: { url: string; name: string } | undefined;
  for (const f of files) {
    const m = /^orden_compra_(.+)\.pdf$/i.exec(f.name);
    if (m && wanted.includes(normalizeProveedorNombre(m[1]))) latest = f;
  }
  return latest;
}

const PROVEEDOR_GRID_TEMPLATE = '1.6fr 0.9fr 0.8fr 0.7fr 0.6fr 1.1fr 0.7fr 1.5fr 1fr';
const PROVEEDOR_GRID_COLS: { label: string; align: 'left' | 'right' }[] = [
  { label: 'Producto', align: 'left' }, { label: 'SKU', align: 'left' },
  { label: 'Color', align: 'left' }, { label: 'Talla', align: 'left' },
  { label: 'Cant.', align: 'right' }, { label: 'Costo Distr. C/U', align: 'right' },
  { label: 'Desc. %', align: 'right' }, { label: 'Estado', align: 'left' },
  { label: 'Entrega prov.', align: 'left' },
];

function ProveedorLineaRow({ l }: { l: ItemDTO }) {
  const estado = l.cols[S_ESTADO]?.text;
  const color = estado ? ESTADO_PRODUCTO_COLORS[estado] : undefined;
  const costo = Number(l.cols[S_COSTO]?.value ?? l.cols[S_COSTO]?.text);
  const moneda = l.cols[S_MONEDA]?.text;
  const cellStyle = { font: 'var(--text-label)', color: 'var(--ink-secondary)' } as const;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: PROVEEDOR_GRID_TEMPLATE, gap: 8, padding: '8px 12px', borderTop: '1px solid var(--border-subtle)', alignItems: 'center' }}>
      <div style={{ ...cellStyle, color: 'var(--ink)' }}>{l.cols[S_PRODUCTO]?.text || l.name}</div>
      <div style={cellStyle}>{l.cols[S_SKU]?.text || '—'}</div>
      <div style={cellStyle}>{l.cols[S_COLOR]?.text || '—'}</div>
      <div style={cellStyle}>{l.cols[S_TALLA]?.text || '—'}</div>
      <div style={{ ...cellStyle, color: 'var(--ink)', textAlign: 'right' }}>{l.cols[S_CANTIDAD]?.text || '0'}</div>
      <div style={{ ...cellStyle, color: 'var(--ink)', textAlign: 'right' }}>
        {Number.isFinite(costo) && costo > 0 ? `${fmtMoney(costo)}${moneda ? ' ' + moneda : ''}` : '—'}
      </div>
      <div style={{ ...cellStyle, textAlign: 'right' }}>{l.cols[S_DESCUENTO]?.text ? `${l.cols[S_DESCUENTO].text}%` : '—'}</div>
      <div>{estado && color ? <StatusBadge label={estado} color={color} tint={color + '22'} /> : <span style={{ ...cellStyle, color: 'var(--ink-quiet)' }}>—</span>}</div>
      <div style={cellStyle}>{l.cols[S_ENTREGA_PROV]?.text || '—'}</div>
    </div>
  );
}

const CARD_INPUT_STYLE = {
  font: 'var(--text-label)', padding: '5px 8px', borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)', minWidth: 160,
} as const;

/** Miniatura de la última OC (PDF) generada para este proveedor, junto a su
 * nombre en la tarjeta — antes solo vivían en el listado plano al fondo de la
 * pestaña (Efraín, 2026-08-13: "que no estén hasta abajo"). Clic abre el
 * mismo preview embebido que CotizacionPdfRow (pdf.js, sin depender del link
 * firmado crudo de Monday). Sin match, no se renderiza nada. */
function OcThumb({ file }: { file: { url: string; name: string } | undefined }) {
  const [preview, setPreview] = useState(false);
  if (!file) return null;
  return (
    <>
      <div
        onClick={() => setPreview(true)}
        title="Ver última OC generada de este proveedor"
        style={{
          cursor: 'pointer', width: 48, height: 48, borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)', background: 'var(--bg-sunken)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}
      >
        <PdfIcon color="var(--accent)" size={26} />
      </div>
      {preview && (
        <Modal title="Orden de compra" onClose={() => setPreview(false)} width={760}>
          <Suspense fallback={<div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Cargando…</div>}>
            <PdfCanvasPreview url={file.url} maxWidth={712} />
          </Suspense>
          <a href={file.url} download style={{ display: 'inline-block', marginTop: 12, font: 'var(--text-label)', color: 'var(--accent)' }}>
            Descargar
          </a>
        </Modal>
      )}
    </>
  );
}

/** Tarjeta de un proveedor: sus líneas + botón "Generar OC" acotado a él
 * (only_proveedor) — resultado local con el mismo contrato que ProyectoActionBar.
 * Método/Condiciones de pago son overrides SOLO de esta OC (WhatsApp 2026-08-04:
 * antes el default del Proyecto se aplicaba igual a todos los proveedores) —
 * prellenados con el default, no se guardan de vuelta a Monday. */
function ProveedorCard({ group, proyecto, oppId, reload }: { group: ProveedorGroup; proyecto: ItemDetailDTO; oppId: string | null; reload: () => void }) {
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const [metodoPago, setMetodoPago] = useState(proyecto.cols[P_METODO_PAGO]?.text ?? '');
  const [condPago, setCondPago] = useState(proyecto.cols[P_COND_PAGO]?.text ?? '');
  const cantidadTotal = group.lineas.reduce((s, r) => s + (Number(r.cols[S_CANTIDAD]?.text?.replace(/,/g, '')) || 0), 0);
  const ocFiles = toR2Files(parseFiles(proyecto.cols[P_OC_PDF]?.text), oppId, 'oc');
  const ocFile = findLatestOcFile(ocFiles, [group.nombre, group.nombreItem]);

  const onGenerar = async () => {
    setOutcome(null);
    try {
      const res = await proyectoAction(proyecto.id, 'generar-oc', {
        onlyProveedor: group.proveedorId!,
        metodoPago: metodoPago.trim() || undefined,
        condPago: condPago.trim() || undefined,
      });
      setOutcome(describeResult('generar-oc', res));
      reload();
    } catch {
      setOutcome({ kind: 'error', text: 'No se pudo ejecutar la acción. Verifica tu conexión.' });
    }
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', background: '#fff', overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <OcThumb file={ocFile} />
          <div>
            <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{group.nombre}</div>
            <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
              {group.correo ? `${group.correo} · ` : ''}{group.lineas.length} línea{group.lineas.length === 1 ? '' : 's'} · {cantidadTotal} pzas
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text" value={metodoPago} onChange={e => setMetodoPago(e.target.value)}
            placeholder="Método de pago" title="Método de pago de esta OC (no cambia el default del Proyecto)"
            style={CARD_INPUT_STYLE}
          />
          <input
            type="text" value={condPago} onChange={e => setCondPago(e.target.value)}
            placeholder="Condiciones de pago" title="Condiciones de pago de esta OC (no cambia el default del Proyecto)"
            style={{ ...CARD_INPUT_STYLE, minWidth: 220 }}
          />
          <ConfirmButton
            label="Generar OC"
            confirmLabel="¿Generar la OC de este proveedor? Se manda a firmas"
            busyLabel="Generando… puede tardar unos minutos, no cierres esta pantalla"
            disabled={!group.proveedorId}
            title={!group.proveedorId ? 'Asigna un proveedor a estas líneas primero' : 'Una OC de este proveedor + firmas Elaborado→Revisado→Autorizado'}
            onConfirm={onGenerar}
          />
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 720 }}>
          <div style={{ display: 'grid', gridTemplateColumns: PROVEEDOR_GRID_TEMPLATE, gap: 8, padding: '8px 12px', font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
            {PROVEEDOR_GRID_COLS.map(c => <div key={c.label} style={{ textAlign: c.align }}>{c.label}</div>)}
          </div>
          {group.lineas.map(l => <ProveedorLineaRow key={l.id} l={l} />)}
        </div>
      </div>
      {outcome && (
        <div style={{ margin: '0 14px 12px', padding: '8px 12px', borderRadius: 'var(--radius-lg)', border: `1px solid ${OUTCOME_COLOR[outcome.kind]}`, background: 'var(--bg-raised)', font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>
          {outcome.text}
        </div>
      )}
    </div>
  );
}

/** Grid de líneas del proyecto agrupadas por proveedor — el equivalente por-proveedor
 * de la tab Cotización, para la tab Órdenes de compra. */
function ProveedorGrid({ lineas, proyecto, oppId, reload }: { lineas: ItemDTO[]; proyecto: ItemDetailDTO; oppId: string | null; reload: () => void }) {
  const grupos = groupByProveedor(lineas);
  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {grupos.map(g => <ProveedorCard key={g.key} group={g} proyecto={proyecto} oppId={oppId} reload={reload} />)}
    </div>
  );
}

export function ProyectoOrdenesSection({ state, oppId }: { state: ProyectoState; oppId: string | null }) {
  const me = useMe();
  const canCompras = me?.role === 'compras' || me?.role === 'admin';
  if (state.loading) return <Shell hint="Buscando el proyecto ligado…" />;
  if (!state.proyecto) {
    return <Shell hint="Esta oportunidad aún no tiene Proyecto en Monday — se crea al GANAR la oportunidad; las órdenes de compra se generan desde el proyecto." />;
  }
  const p = state.proyecto;
  const lineas = p.children ?? [];
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 10 }}>
        Proyecto {p.name} — una OC por proveedor, con firmas Elaborado → Revisado → Autorizado (DocuSeal).
      </div>
      <ProyectoActionBar proyecto={p} reload={state.reload} actions={['generar-oc']} />
      {canCompras ? (
        lineas.length > 0
          ? <ProveedorGrid lineas={lineas} proyecto={p} oppId={oppId} reload={state.reload} />
          : <div style={{ marginTop: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Aún no hay líneas en el proyecto — importa las tallas primero.</div>
      ) : (
        <div style={{ marginTop: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>El desglose por proveedor lo gestiona Compras.</div>
      )}
    </div>
  );
}

// Comentario de Estado (proyectos_sub) — junto con S_ESTADO, editables solo por
// compras/admin (shared/visibility.ts, grupo AC) desde el tab Ejecución.
const S_COMENTARIO = 'text_mm20gzsb';

interface EstadoEdit { nuevoEstado: string; comentario: string; saving: boolean; error?: string }

const chipBtnStyle = { padding: '6px 14px', font: 'var(--text-label)' } as const;

/** Un chip por línea (producto+color+talla): color = estado actual, cantidad
 * debajo de la talla. Editable solo por compras/admin — abre un popover angosto
 * con el selector de estado + comentario (obligatorio si el nuevo estado es
 * Incidencia/Retraso, mismo criterio que reportarTallasIncorrectas). El popover
 * abierto es UNO SOLO en todo el tab (Efraín, 2026-08-06: "no se cierran los pop
 * ups por elemento") — `isOpen`/`onOpen`/`onClose` vienen de EjecucionSection. */
function EstadoChip({ row, canEdit, onSaved, isOpen, onOpen, onClose }: {
  row: ItemDTO; canEdit: boolean; onSaved: () => void;
  isOpen: boolean; onOpen: () => void; onClose: () => void;
}) {
  const estado = row.cols[S_ESTADO]?.text || 'Pendiente OC al Prov';
  const color = ESTADO_PRODUCTO_COLORS[estado] ?? '#9aa5b1';
  const [edit, setEdit] = useState<EstadoEdit | null>(null);

  const abrir = () => {
    if (!canEdit) return;
    setEdit({ nuevoEstado: estado, comentario: row.cols[S_COMENTARIO]?.text || '', saving: false });
    onOpen();
  };

  const guardar = async () => {
    if (!edit) return;
    if (edit.nuevoEstado === 'Incidencia/Retraso' && !edit.comentario.trim()) {
      setEdit({ ...edit, error: 'Cuenta qué pasó — obligatorio para marcar Incidencia/Retraso' });
      return;
    }
    setEdit({ ...edit, saving: true, error: undefined });
    try {
      await patchItem('proyectos_sub', row.id, { [S_ESTADO]: edit.nuevoEstado, [S_COMENTARIO]: edit.comentario });
      onClose();
      onSaved();
    } catch {
      setEdit({ ...edit, saving: false, error: 'No se pudo guardar' });
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={abrir}
        title={row.cols[S_COMENTARIO]?.text || estado}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 50,
          padding: '6px 10px', borderRadius: 'var(--radius-lg)', background: color + '22',
          border: `1px solid ${color}66`, cursor: canEdit ? 'pointer' : 'default',
        }}
      >
        <span style={{ font: 'var(--text-label-strong)', color: 'var(--ink)' }}>{row.cols[S_TALLA]?.text || '—'}</span>
        <span style={{ font: 'var(--text-caption-strong)', color }}>{row.cols[S_CANTIDAD]?.text || '0'}</span>
      </div>
      {isOpen && edit && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 5, width: 250,
          background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)',
          boxShadow: '0 6px 20px rgba(0,0,0,.15)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <select
            value={edit.nuevoEstado}
            onChange={(e) => setEdit({ ...edit, nuevoEstado: e.target.value })}
            style={{ font: 'var(--text-label)', padding: '7px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}
          >
            {ESTADO_PRODUCTO_ORDER.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <textarea
            value={edit.comentario}
            onChange={(e) => setEdit({ ...edit, comentario: e.target.value })}
            placeholder={edit.nuevoEstado === 'Incidencia/Retraso' ? 'Qué pasó (obligatorio)' : 'Comentario (opcional)'}
            rows={2}
            style={{ font: 'var(--text-label)', padding: '7px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', resize: 'vertical' }}
          />
          {edit.error && <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>{edit.error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" style={chipBtnStyle} onClick={edit.saving ? undefined : onClose}>Cancelar</Button>
            <Button style={chipBtnStyle} onClick={edit.saving ? undefined : guardar}>{edit.saving ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Timeline de una línea — lee todo el historial del Proyecto (una sola llamada,
 * cacheada por EjecucionSection) y filtra por sub_item_id del lado del cliente. */
function HistorialPanel({ subItemId, historial, onClose }: {
  subItemId: string; historial: EstadoHistorialEntryDTO[]; onClose: () => void;
}) {
  const propios = historial.filter((h) => h.subItemId === subItemId);
  return (
    <div style={{
      position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 5, width: 280, maxHeight: 320, overflowY: 'auto',
      background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)',
      boxShadow: '0 6px 20px rgba(0,0,0,.15)', padding: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)' }}>Historial</div>
        <div onClick={onClose} style={{ cursor: 'pointer', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>✕</div>
      </div>
      {propios.length === 0 && <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>Sin cambios de estado todavía.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {propios.map((h, i) => (
          <div key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', paddingTop: i === 0 ? 0 : 8 }}>
            <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>{h.changedAt.slice(0, 16).replace('T', ' ')}</div>
            <div style={{ font: 'var(--text-label)', color: 'var(--ink)' }}>
              {h.estadoPrevio ? `${h.estadoPrevio} → ${h.estadoNuevo}` : h.estadoNuevo}
            </div>
            {h.comentario && <div style={{ font: 'var(--text-caption)', color: 'var(--ink-secondary)', marginTop: 2 }}>{h.comentario}</div>}
            {h.changedBy && <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)', marginTop: 2 }}>{h.changedBy}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Resumen libre por producto+color — un texto global de la tarjeta, aparte del
 * comentario por talla (worker/lib/productoResumen.ts, nativo en D1: el grupo
 * producto+color no es una columna de Monday). Siempre visible (aunque esté
 * vacío) para que "de un vistazo" se entienda cómo va el producto sin abrir cada
 * talla; compras/admin lo edita con el mismo patrón select/textarea+Guardar. */
function ResumenBlock({ groupKey, resumen, canEdit, proyectoId, isOpen, onOpen, onClose, onSaved }: {
  groupKey: string; resumen: string; canEdit: boolean; proyectoId: string;
  isOpen: boolean; onOpen: () => void; onClose: () => void; onSaved: (resumen: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const abrir = () => {
    if (!canEdit) return;
    setDraft(resumen);
    setError(undefined);
    onOpen();
  };

  const guardar = async () => {
    setSaving(true);
    setError(undefined);
    const [producto, color] = groupKey.split('|');
    try {
      await patchProductoResumen(proyectoId, producto, color, draft.trim());
      setSaving(false);
      onSaved(draft.trim());
      onClose();
    } catch {
      setSaving(false);
      setError('No se pudo guardar');
    }
  };

  return (
    <div style={{ position: 'relative', marginTop: 10 }}>
      <div
        onClick={abrir}
        title={canEdit ? 'Editar resumen del producto' : undefined}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 8px',
          borderRadius: 'var(--radius-md)', background: 'var(--bg-sunken)',
          cursor: canEdit ? 'pointer' : 'default',
        }}
      >
        <span style={{ font: 'var(--text-caption-strong)', color: 'var(--ink-tertiary)', flexShrink: 0 }}>Resumen</span>
        <span style={{ font: 'var(--text-caption)', color: resumen ? 'var(--ink-secondary)' : 'var(--ink-quiet)', flex: 1 }}>
          {resumen || (canEdit ? 'Sin resumen — click para agregar' : 'Sin resumen todavía')}
        </span>
        {canEdit && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)', flexShrink: 0 }}>✎</span>}
      </div>
      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 5, width: '100%', minWidth: 260,
          background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)',
          boxShadow: '0 6px 20px rgba(0,0,0,.15)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Cómo va este producto…"
            rows={3}
            autoFocus
            style={{ font: 'var(--text-label)', padding: '7px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', resize: 'vertical' }}
          />
          {error && <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" style={chipBtnStyle} onClick={saving ? undefined : onClose}>Cancelar</Button>
            <Button style={chipBtnStyle} onClick={saving ? undefined : guardar}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tarjeta de un producto+color: resumen global + chips de estado por talla (una
 * fila = una talla, ya resuelto estructuralmente por proyectos_sub — nunca una
 * columna por talla) + ícono de historial. Mismo agrupado que TallaBoxCard
 * (Tallas), distinto contenido. */
function EjecucionCard({ group, canEdit, historial, resumen, proyectoId, openPopover, setOpenPopover, onChanged, onResumenSaved }: {
  group: TallaGroup; canEdit: boolean; historial: EstadoHistorialEntryDTO[]; resumen: string; proyectoId: string;
  openPopover: string | null; setOpenPopover: (key: string | null) => void;
  onChanged: () => void; onResumenSaved: (groupKey: string, resumen: string) => void;
}) {
  const groupKey = `${group.producto}|${group.color}`;
  const resumenKey = `resumen:${groupKey}`;
  const cardBattery = batteryFromSubitems(group.rows.map((r) => ({
    estado: r.cols[S_ESTADO]?.text,
    cantidad: Number((r.cols[S_CANTIDAD]?.text || '0').replace(/,/g, '')) || 0,
  })));

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 14, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{group.producto}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
            {group.sku && <MonoTag>{group.sku}</MonoTag>}
            {group.color && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>{group.color}</span>}
          </div>
        </div>
        <div style={{ width: 140 }}><ProgressBattery data={cardBattery} /></div>
      </div>
      <ResumenBlock
        groupKey={groupKey}
        resumen={resumen}
        canEdit={canEdit}
        proyectoId={proyectoId}
        isOpen={openPopover === resumenKey}
        onOpen={() => setOpenPopover(resumenKey)}
        onClose={() => setOpenPopover(null)}
        onSaved={(r) => onResumenSaved(groupKey, r)}
      />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
        {group.rows.map((r) => {
          const chipKey = `chip:${r.id}`;
          const histKey = `hist:${r.id}`;
          return (
            <div key={r.id} style={{ position: 'relative' }}>
              <EstadoChip
                row={r} canEdit={canEdit} onSaved={onChanged}
                isOpen={openPopover === chipKey}
                onOpen={() => setOpenPopover(chipKey)}
                onClose={() => setOpenPopover(null)}
              />
              <div
                onClick={() => setOpenPopover(openPopover === histKey ? null : histKey)}
                title="Ver historial de esta línea"
                style={{
                  position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: '50%',
                  background: 'var(--bg-sunken)', border: '1px solid var(--border)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', font: '9px sans-serif', color: 'var(--ink-tertiary)',
                }}
              >
                ⏱
              </div>
              {openPopover === histKey && (
                <HistorialPanel subItemId={r.id} historial={historial} onClose={() => setOpenPopover(null)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Tab "Ejecución" del Proyecto: batería agregada (piezas entregadas/en camino/
 * incidencia) + tarjetas por producto+color con resumen global y chips de estado
 * por talla — pensado para verse "de un vistazo" en vez de clonar la tabla de
 * subitems de Monday (Efraín, 2026-08-05). Lectura para todos; edición (compras/
 * admin) escribe `color_mm0hqf79`/`text_mm20gzsb` vía el PATCH genérico, que ya
 * deja rastro en estado_producto_historial (worker/lib/estadoProducto.ts) sin
 * agregar columnas, más el resumen por producto (worker/lib/productoResumen.ts).
 * Un solo popover abierto a la vez en todo el tab — `openPopover` vive aquí y un
 * backdrop de página completa lo cierra al hacer click fuera (Efraín, 2026-08-06:
 * "no se cierran los pop ups por elemento, se quedan abiertos"). */
export function EjecucionSection({ state, oppId: _oppId }: { state: ProyectoState; oppId: string | null }) {
  const me = useMe();
  const canEdit = me?.role === 'compras' || me?.role === 'admin';
  const [historial, setHistorial] = useState<EstadoHistorialEntryDTO[]>([]);
  const [resumenMap, setResumenMap] = useState<Record<string, string>>({});
  const [openPopover, setOpenPopover] = useState<string | null>(null);

  const proyectoId = state.proyecto?.id;
  const reloadHistorial = useCallback(() => {
    if (!proyectoId) return;
    getEstadoHistorial(proyectoId).then(setHistorial).catch(() => setHistorial([]));
  }, [proyectoId]);
  const reloadResumen = useCallback(() => {
    if (!proyectoId) return;
    getProductoResumen(proyectoId).then((rows) => {
      const map: Record<string, string> = {};
      for (const r of rows) map[`${r.producto}|${r.color}`] = r.resumen;
      setResumenMap(map);
    }).catch(() => setResumenMap({}));
  }, [proyectoId]);

  useEffect(reloadHistorial, [reloadHistorial]);
  useEffect(reloadResumen, [reloadResumen]);

  if (state.loading) return <Shell hint="Buscando el proyecto ligado…" />;
  if (!state.proyecto) {
    return <Shell hint="Esta oportunidad aún no tiene Proyecto en Monday — el seguimiento de ejecución arranca cuando se generan las órdenes de compra a proveedor." />;
  }
  const p = state.proyecto;
  const lineas = p.children ?? [];
  const battery = batteryFromSubitems(lineas.map((l) => ({
    estado: l.cols[S_ESTADO]?.text,
    cantidad: Number((l.cols[S_CANTIDAD]?.text || '0').replace(/,/g, '')) || 0,
  })));
  const grupos = groupByProductoColor(lineas);

  const onChanged = () => {
    state.reload();
    reloadHistorial();
  };
  const onResumenSaved = (groupKey: string, r: string) => {
    setResumenMap((prev) => ({ ...prev, [groupKey]: r }));
  };

  return (
    <div style={{ marginTop: 16 }}>
      <ProgressBattery data={battery} size="full" />
      {lineas.length === 0 ? (
        <div style={{ marginTop: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
          Aún no hay líneas en el proyecto — importa las tallas primero.
        </div>
      ) : (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {grupos.map((g) => {
            const groupKey = `${g.producto}|${g.color}`;
            return (
              <EjecucionCard
                key={groupKey} group={g} canEdit={canEdit} historial={historial}
                resumen={resumenMap[groupKey] ?? ''} proyectoId={p.id}
                openPopover={openPopover} setOpenPopover={setOpenPopover}
                onChanged={onChanged} onResumenSaved={onResumenSaved}
              />
            );
          })}
        </div>
      )}
      {!canEdit && (
        <div style={{ marginTop: 14, font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>
          El estado lo actualiza Compras conforme avanza la entrega.
        </div>
      )}
      {openPopover && (
        <div onClick={() => setOpenPopover(null)} style={{ position: 'fixed', inset: 0, zIndex: 4 }} />
      )}
    </div>
  );
}

function Shell({ hint }: { hint: string }) {
  return (
    <div style={{ marginTop: 16, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>{hint}</div>
  );
}
