// Tab "Órdenes de compra" de la sección Proyecto — líneas del proyecto
// agrupadas por proveedor, con botón "Generar OC" acotado a cada uno.
import { lazy, Suspense, useState } from 'react';
import { proyectoAction, type ItemDetailDTO, type ItemDTO } from '../../../lib/api';
import { useMe } from '../../../lib/useMe';
import { ConfirmButton } from '../../../components/core/ConfirmButton';
import { StatusBadge } from '../../../components/core/Badges';
import { Modal } from '../../../components/core/Modal';
import { fmtMoney } from '../../../lib/format';
import { PdfIcon } from '../tabs/cotizacion/CotizacionPdfRow';
import {
  type ProyectoState, P_OC_PDF, P_METODO_PAGO, P_COND_PAGO,
  ProyectoActionBar, Shell, parseFiles, toR2Files,
  type ActionOutcome, describeResult, OUTCOME_COLOR,
  ESTADO_PRODUCTO_COLORS,
  S_PRODUCTO, S_SKU, S_COLOR, S_TALLA, S_CANTIDAD,
  S_PROVEEDOR, S_PROVEEDOR_RAZON, S_PROVEEDOR_CORREO, S_ESTADO, S_COSTO, S_DESCUENTO, S_MONEDA, S_ENTREGA_PROV,
} from './shared';

const PdfCanvasPreview = lazy(() =>
  import('../../../components/core/PdfCanvasPreview').then((m) => ({ default: m.PdfCanvasPreview })),
);

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
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Empareja el PDF de OC más reciente de un proveedor por nombre de archivo:
 * cmp-tallas los sube a file_mm0hj9pn como `OC_<folio>_<nombre proveedor>.pdf`
 * (ej. `OC_OC-125_ABRAHAM FARID GORDILLO KANAN.pdf` — confirmado contra datos
 * reales el 2026-08-12; el patrón `orden_compra_<nombre>.pdf` de la versión
 * anterior nunca hizo match con nada, así que ninguna miniatura aparecía — sin
 * id explícito que ligue el archivo al proveedor). Se prueban nombre e item
 * crudo como candidatos porque `ProveedorGroup.nombre` prioriza la razón
 * social, que puede no ser el texto que cmp-tallas usó. El arreglo conserva
 * orden de subida, así que el último match es el más reciente. */
function findLatestOcFile(files: { url: string; name: string }[], candidatos: string[]): { url: string; name: string } | undefined {
  const wanted = candidatos.filter(Boolean).map(normalizeProveedorNombre);
  if (wanted.length === 0) return undefined;
  let latest: { url: string; name: string } | undefined;
  for (const f of files) {
    const m = /^OC_[^_]+_(.+)\.pdf$/i.exec(f.name);
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
      <div style={{ ...cellStyle, color: 'var(--ink)', minWidth: 0, overflowWrap: 'anywhere' }}>{l.cols[S_PRODUCTO]?.text || l.name}</div>
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
  // Padding vertical (8) + borde (1+1) = 18, para igualar la altura del botón
  // "Generar OC" (Button primario: padding 9 vertical, sin borde = 18 también).
  font: 'var(--text-label)', padding: '8px', borderRadius: 'var(--radius-md)',
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

/** Botón "Ver OC (portal)" — arma el PDF al vuelo en el Worker
 * (worker/lib/ocProveedorPdf.ts) en vez de disparar Eledo/cmp-tallas. v1 a
 * propósito simple (Efraín, 2026-08-13): solo genera/muestra, sin folio propio
 * ni firma electrónica — conviven los dos botones mientras se prueba. */
function NativeOcButton({ proyectoId, proveedorId }: { proyectoId: string; proveedorId: string | null }) {
  const [preview, setPreview] = useState(false);
  if (!proveedorId) return null;
  const url = `/api/proyectos/${proyectoId}/oc-nativa/${proveedorId}/pdf`;
  return (
    <>
      <button type="button" onClick={() => setPreview(true)} style={CARD_INPUT_STYLE} title="Genera la OC de este proveedor con el motor propio del portal (con Precio/Cantidad/Subtotal correctos)">
        Ver OC (portal)
      </button>
      {preview && (
        <Modal title="Orden de compra — portal" onClose={() => setPreview(false)} width={760}>
          <Suspense fallback={<div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Generando…</div>}>
            <PdfCanvasPreview url={url} maxWidth={712} />
          </Suspense>
          <a href={url} download style={{ display: 'inline-block', marginTop: 12, font: 'var(--text-label)', color: 'var(--accent)' }}>
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
          <NativeOcButton proyectoId={proyecto.id} proveedorId={group.proveedorId} />
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
