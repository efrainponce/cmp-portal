// Sección "Proyecto" compartida por las pestañas Tallas y Órdenes de compra:
// los flujos de tallas/OC de cmp-tallas viven en el item Proyecto ligado a la
// oportunidad (Proyectos board_relation_mm0hf0y3), no en la Oportunidad.
// Botones espejo de los de Monday, gated por rol; las tallas importadas se
// muestran desde el mirror (proyectos_sub) — el objetivo es que dejen de vivir
// solo en el Excel.
import { useCallback, useEffect, useState } from 'react';
import { getProyecto, proyectoAction, type ItemDetailDTO, type ItemDTO, type ProyectoAction } from '../../lib/api';
import { useMe } from '../../lib/useMe';
import { ConfirmButton } from '../../components/core/ConfirmButton';
import { MonoTag, StatusBadge } from '../../components/core/Badges';
import { fmtMoney } from '../../lib/format';

// Proyectos (18395657594)
export const P_SHEET_LINK = 'link_mm1amwz8';     // Google Sheet de tallas
const P_DRIVE_LINK = 'link_mm462saa';     // Carpeta Drive (visible Compras)
const P_TALLAS_PDF = 'file_mm0hcrtz';     // PDFs relación de tallas (visible Compras)
const P_OC_PDF = 'file_mm0hj9pn';         // PDFs órdenes de compra (visible Compras)
export const P_OC_CLIENTE = 'file_mm0hayh4'; // OC/cotización/contrato firmado por el cliente (vendedor sube)

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
const ESTADO_PRODUCTO_COLORS: Record<string, string> = {
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
            busyLabel="Validando…"
            disabled={!canVendedor || !sheetUrl}
            title={!canVendedor ? 'Solo el vendedor valida las tallas' : !sheetUrl ? 'Primero crea el archivo de tallas' : 'Valida el desglose y genera el PDF a firma'}
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
            busyLabel="Generando órdenes…"
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

/** Grid de tallas importadas (subitems del Proyecto) agrupado por producto. */
function TallasGrid({ lineas }: { lineas: ItemDTO[] }) {
  if (lineas.length === 0) {
    return (
      <div style={{ marginTop: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
        Aún no hay tallas importadas en Monday — captura el desglose en el archivo de tallas y pide a Compras importarlo.
      </div>
    );
  }

  const grupos = new Map<string, ItemDTO[]>();
  for (const l of lineas) {
    const key = l.cols[S_PRODUCTO]?.text || l.name;
    grupos.set(key, [...(grupos.get(key) ?? []), l]);
  }

  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[...grupos.entries()].map(([producto, rows]) => (
        <div key={producto} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 14, background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{producto}</div>
            {rows[0].cols[S_SKU]?.text && <MonoTag>{rows[0].cols[S_SKU].text}</MonoTag>}
            <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
              Total: {rows.reduce((s, r) => s + (Number(r.cols[S_CANTIDAD]?.text?.replace(/,/g, '')) || 0), 0)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {rows.map(r => (
              <div key={r.id} style={{
                border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)',
                padding: '6px 10px', background: 'var(--bg)', font: 'var(--text-label)', color: 'var(--ink-secondary)',
              }}>
                <span style={{ font: 'var(--text-label-strong)', color: 'var(--ink)' }}>{r.cols[S_TALLA]?.text || '—'}</span>
                {' · '}{r.cols[S_CANTIDAD]?.text || '0'}
                {r.cols[S_COLOR]?.text ? ` · ${r.cols[S_COLOR].text}` : ''}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProyectoTallasSection({ state, oppId }: { state: ProyectoState; oppId: string | null }) {
  if (state.loading) return <Shell hint="Buscando el proyecto ligado…" />;
  if (!state.proyecto) {
    return <Shell hint="Esta oportunidad aún no tiene Proyecto en Monday — se crea cuando se GANA la oportunidad, y ahí vive el desglose de tallas." />;
  }
  const p = state.proyecto;
  return (
    <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
      <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)', marginBottom: 2 }}>Proyecto {p.name}</div>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 10 }}>
        Desglose de tallas del proyecto — mismo flujo que los botones de Monday.
      </div>
      <ProyectoLinks proyecto={p} />
      <ProyectoActionBar proyecto={p} reload={state.reload} actions={['tallas-regenerar', 'tallas-confirmar', 'tallas-importar']} />
      <TallasGrid lineas={p.children ?? []} />
      <FileList label="Relaciones de tallas (PDF)" files={toR2Files(parseFiles(p.cols[P_TALLAS_PDF]?.text), oppId, 'tallas')} />
    </div>
  );
}

interface ProveedorGroup {
  key: string;
  proveedorId: string | null;
  nombre: string;
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
        correo: l.cols[S_PROVEEDOR_CORREO]?.text || '',
        lineas: [],
      });
    }
    groups.get(key)!.lineas.push(l);
  }
  return [...groups.values()].sort((a, b) =>
    a.key === 'sin-proveedor' ? 1 : b.key === 'sin-proveedor' ? -1 : a.nombre.localeCompare(b.nombre));
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

/** Tarjeta de un proveedor: sus líneas + botón "Generar OC" acotado a él
 * (only_proveedor) — resultado local con el mismo contrato que ProyectoActionBar. */
function ProveedorCard({ group, proyecto, reload }: { group: ProveedorGroup; proyecto: ItemDetailDTO; reload: () => void }) {
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const cantidadTotal = group.lineas.reduce((s, r) => s + (Number(r.cols[S_CANTIDAD]?.text?.replace(/,/g, '')) || 0), 0);

  const onGenerar = async () => {
    setOutcome(null);
    try {
      const res = await proyectoAction(proyecto.id, 'generar-oc', { onlyProveedor: group.proveedorId! });
      setOutcome(describeResult('generar-oc', res));
      reload();
    } catch {
      setOutcome({ kind: 'error', text: 'No se pudo ejecutar la acción. Verifica tu conexión.' });
    }
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', background: '#fff', overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', borderBottom: '1px solid var(--border-subtle)' }}>
        <div>
          <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{group.nombre}</div>
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
            {group.correo ? `${group.correo} · ` : ''}{group.lineas.length} línea{group.lineas.length === 1 ? '' : 's'} · {cantidadTotal} pzas
          </div>
        </div>
        <ConfirmButton
          label="Generar OC"
          confirmLabel="¿Generar la OC de este proveedor? Se manda a firmas"
          busyLabel="Generando…"
          disabled={!group.proveedorId}
          title={!group.proveedorId ? 'Asigna un proveedor a estas líneas primero' : 'Una OC de este proveedor + firmas Elaborado→Revisado→Autorizado'}
          onConfirm={onGenerar}
        />
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
function ProveedorGrid({ lineas, proyecto, reload }: { lineas: ItemDTO[]; proyecto: ItemDetailDTO; reload: () => void }) {
  const grupos = groupByProveedor(lineas);
  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {grupos.map(g => <ProveedorCard key={g.key} group={g} proyecto={proyecto} reload={reload} />)}
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
          ? <ProveedorGrid lineas={lineas} proyecto={p} reload={state.reload} />
          : <div style={{ marginTop: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Aún no hay líneas en el proyecto — importa las tallas primero.</div>
      ) : (
        <div style={{ marginTop: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>El desglose por proveedor lo gestiona Compras.</div>
      )}
      <FileList label="Órdenes de compra (PDF)" files={toR2Files(parseFiles(p.cols[P_OC_PDF]?.text), oppId, 'oc')} />
    </div>
  );
}

function Shell({ hint }: { hint: string }) {
  return (
    <div style={{ marginTop: 16, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>{hint}</div>
  );
}
