// Tab "Órdenes de compra" de la sección Proyecto — líneas del proyecto
// agrupadas por proveedor, con botón "Generar OC" acotado a cada uno.
//
// Desde 2026-08-18 la OC se EDITA aquí, no solo se genera (Efraín: "los de
// compras necesitan poder modificar las órdenes de compra o crear nuevas a
// partir de productos que puede que no estén en la cotización"): cantidad,
// costo, moneda, descuento y fecha de entrega se guardan inline contra la
// línea del Proyecto en Monday (PATCH /api/boards/proyectos_sub/items/:id →
// outbox), la línea se puede mover de proveedor o borrar, y "+ Agregar
// producto" levanta una línea que nunca estuvo en la cotización — con
// proveedor nuevo, eso abre una tarjeta (= una OC) nueva.
//
// Cada cambio queda en el log de actividad CON EL USUARIO REAL del portal
// (worker/lib/activityLog.ts, PORTAL_WRITE_COLUMNS — el activity log de
// Monday atribuiría todo al dueño del token): el reloj de cada línea muestra
// su historial, y el tab "Actividad" del Proyecto el del proyecto completo.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  proyectoAction, patchItem, deleteProyectoLinea, getActivity, getOcNotas, saveOcNota,
  listOcImagenes, ocImagenUrl, uploadOcImagen, restablecerOcImagen,
  usePoll, SOLO_NOMBRE,
  type ActivityEntryDTO, type ItemDetailDTO, type ItemDTO, type OcImagenDTO,
} from '../../../lib/api';
import { useMe } from '../../../lib/useMe';
import { ConfirmButton } from '../../../components/core/ConfirmButton';
import { Button } from '../../../components/core/Button';
import { StatusBadge } from '../../../components/core/Badges';
import { Modal } from '../../../components/core/Modal';
import { SearchInput } from '../../../components/forms/SearchInput';
import { AgregarLineaModal } from '../../proyectos/AgregarLineaModal';
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

// 11 columnas en el ancho del drawer (~856px útiles con maxWidth 920): las de
// acciones van al final y TIENEN que caber sin scroll horizontal, o el reloj y
// el borrar quedan invisibles. Producto se lleva el sobrante y parte el texto.
const PROVEEDOR_GRID_TEMPLATE = '1.25fr 0.7fr 0.6fr 0.5fr 0.4fr 0.75fr 0.45fr 0.45fr 1fr 0.8fr 0.5fr';
const PROVEEDOR_GRID_COLS: { label: string; align: 'left' | 'right' }[] = [
  { label: 'Producto', align: 'left' }, { label: 'SKU', align: 'left' },
  { label: 'Color', align: 'left' }, { label: 'Talla', align: 'left' },
  { label: 'Cant.', align: 'right' }, { label: 'Costo Distr. C/U', align: 'right' },
  { label: 'Moneda', align: 'left' }, { label: 'Desc. %', align: 'right' },
  { label: 'Estado', align: 'left' }, { label: 'Entrega prov.', align: 'left' },
  { label: '', align: 'left' },
];

const CELL_STYLE = { font: 'var(--text-label)', color: 'var(--ink-secondary)' } as const;

/** Celda editable de una línea del Proyecto: guarda al salir del campo (o con
 * Enter) contra Monday vía PATCH, y pinta el valor nuevo de inmediato aunque
 * el espejo todavía no lo refleje — mismo patrón `overrides` que la captura de
 * cantidades en TallasSection. Escape cancela. */
function EditableCell({ value, onSave, align = 'left', type = 'text', suffix, placeholder, title, wrap }: {
  value: string;
  onSave: (v: string) => Promise<void>;
  align?: 'left' | 'right';
  type?: 'text' | 'number' | 'date';
  suffix?: string;
  placeholder?: string;
  title?: string;
  /** Deja el valor en varias líneas en vez de recortarlo con elipsis — para
   * Producto, cuya descripción se lleva medio renglón ("POLICIA VIAL 27 CM DE
   * BASE BORDADO CON HILO DORADO…") y recortada no se puede ni revisar. */
  wrap?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const commit = async () => {
    const next = (draft ?? '').trim();
    setDraft(null);
    if (next === value.trim()) return;
    setSaving(true);
    setError(false);
    try {
      await onSave(next);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  if (draft !== null) {
    return (
      <input
        autoFocus
        type={type}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(null);
        }}
        style={{
          width: '100%', boxSizing: 'border-box', font: 'var(--text-label)', color: 'var(--ink)',
          border: '1px solid var(--accent)', borderRadius: 'var(--radius-md)', padding: '3px 5px',
          textAlign: align,
        }}
      />
    );
  }

  const shown = value.trim();
  return (
    <div
      onClick={() => setDraft(shown)}
      title={title ?? 'Clic para editar'}
      style={{
        ...CELL_STYLE, textAlign: align, cursor: 'text', minWidth: 0,
        borderRadius: 'var(--radius-md)', padding: '3px 5px',
        border: `1px dashed ${error ? 'var(--status-perdida)' : 'transparent'}`,
        background: saving ? 'var(--bg-sunken)' : 'transparent',
        color: shown ? 'var(--ink)' : 'var(--ink-quiet)',
        ...(wrap
          ? { overflowWrap: 'anywhere' as const }
          : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }),
      }}
      className="row-hover"
    >
      {saving ? '…' : error ? 'error' : shown ? `${shown}${suffix ?? ''}` : (placeholder ?? '—')}
    </div>
  );
}

/** Historial de una línea: las entradas del log de actividad del Proyecto que
 * son de ESTA línea (el caller ya las trajo todas de una). Es lo que Efraín
 * pidió "por si cometemos error" — quién cambió el costo, de cuánto a cuánto. */
function LineaHistorial({ entries, onClose, titulo }: {
  entries: ActivityEntryDTO[]; onClose: () => void; titulo: string;
}) {
  return (
    <Modal title={`Historial — ${titulo}`} onClose={onClose} width={520}>
      {entries.length === 0 ? (
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
          Sin cambios registrados en esta línea todavía.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {entries.map((e, i) => (
            <div key={i} style={{ padding: '9px 2px', borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)' }}>
              <div style={{ font: 'var(--text-label)', color: 'var(--ink)' }}>
                {(e.actorName ?? 'Alguien')}
                {e.columnTitle ? ` cambió ${e.columnTitle}` : ' hizo un cambio'}
                {e.previousText ? ` de "${e.previousText}"` : ''}
                {e.text ? ` a "${e.text}"` : ' (lo vació)'}
              </div>
              <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 2 }}>
                {new Date(e.at).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Mover una línea a otro proveedor = sacarla de esta OC y meterla en la de
 * otro (o dejarla sin proveedor, fuera de toda OC). Escribe el mismo
 * board_relation que agrupa las tarjetas. */
function MoverProveedorModal({ lineaId, onClose, onMoved }: {
  lineaId: string; onClose: () => void; onMoved: () => void;
}) {
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data } = usePoll('proveedores', q, SOLO_NOMBRE);
  const opciones = data?.items ?? [];

  const mover = async (proveedorId: string) => {
    setSaving(true);
    setError(null);
    try {
      await patchItem('proyectos_sub', lineaId, { [S_PROVEEDOR]: proveedorId });
      onMoved();
      onClose();
    } catch {
      setError('No se pudo mover la línea.');
      setSaving(false);
    }
  };

  return (
    <Modal title="Mover línea a otro proveedor" onClose={onClose} width={440}>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 10 }}>
        La línea sale de la OC actual y entra en la del proveedor que elijas. Si aún no tiene tarjeta, se crea una.
      </div>
      <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor…" style={{ maxWidth: 'none' }} />
      <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginTop: 8 }}>
        {opciones.length === 0 ? (
          <div style={{ padding: 10, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin resultados.</div>
        ) : opciones.map(p => (
          <div
            key={p.id}
            className="row-hover"
            onClick={saving ? undefined : () => mover(p.id)}
            style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', font: 'var(--text-label)', color: 'var(--ink)', cursor: saving ? 'default' : 'pointer' }}
          >
            {p.name}
          </div>
        ))}
      </div>
      <div
        onClick={saving ? undefined : () => mover('')}
        style={{ marginTop: 10, font: 'var(--text-label)', color: 'var(--accent)', cursor: saving ? 'default' : 'pointer' }}
      >
        Quitarle el proveedor (la saca de toda OC)
      </div>
      {error && <div style={{ marginTop: 8, color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
    </Modal>
  );
}

const ICON_BTN_STYLE = {
  cursor: 'pointer', font: 'var(--text-caption)', color: 'var(--ink-tertiary)',
  padding: '2px 4px', borderRadius: 'var(--radius-md)', userSelect: 'none',
} as const;

function ProveedorLineaRow({ l, proyectoId, canEdit, historial, onChanged }: {
  l: ItemDTO; proyectoId: string; canEdit: boolean; historial: ActivityEntryDTO[]; onChanged: () => void;
}) {
  // Overrides locales: el espejo D1 tarda en confirmar el write a Monday, así
  // que la celda muestra lo recién guardado en vez de regresar al valor viejo
  // (mismo patrón que el resto de las previews locales del portal).
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [verHistorial, setVerHistorial] = useState(false);
  const [mover, setMover] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [errorBorrar, setErrorBorrar] = useState<string | null>(null);

  const val = (colId: string) => overrides[colId] ?? l.cols[colId]?.text ?? '';
  const save = (colId: string) => async (v: string) => {
    await patchItem('proyectos_sub', l.id, { [colId]: v });
    setOverrides(p => ({ ...p, [colId]: v }));
    onChanged();
  };

  const estado = l.cols[S_ESTADO]?.text;
  const estadoColor = estado ? ESTADO_PRODUCTO_COLORS[estado] : undefined;
  const costoRaw = val(S_COSTO).replace(/,/g, '');
  const costo = Number(costoRaw);
  const moneda = val(S_MONEDA);
  const nombreLinea = val(S_PRODUCTO) || l.name;

  const borrar = async () => {
    setBorrando(true);
    setErrorBorrar(null);
    const res = await deleteProyectoLinea(proyectoId, l.id);
    setBorrando(false);
    if (!res.ok) { setErrorBorrar(res.error ?? 'No se pudo eliminar.'); return; }
    onChanged();
  };

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: PROVEEDOR_GRID_TEMPLATE, gap: 8, padding: '6px 12px', alignItems: 'center' }}>
        {/* Producto y Color se corrigen aquí antes de mandar la OC (Efraín,
            2026-08-19) — son justo lo que el proveedor lee en el documento.
            Talla no: cuadra contra el desglose de tallas. */}
        {canEdit
          ? <EditableCell value={val(S_PRODUCTO) || l.name} onSave={save(S_PRODUCTO)} wrap placeholder="Sin producto" title="Producto tal como saldrá impreso en la OC" />
          : <div style={{ ...CELL_STYLE, color: 'var(--ink)', minWidth: 0, overflowWrap: 'anywhere' }}>{nombreLinea}</div>}
        <div style={CELL_STYLE}>{l.cols[S_SKU]?.text || '—'}</div>
        {canEdit
          ? <EditableCell value={val(S_COLOR)} onSave={save(S_COLOR)} wrap placeholder="Sin color" title="Color tal como saldrá impreso en la OC" />
          : <div style={CELL_STYLE}>{l.cols[S_COLOR]?.text || '—'}</div>}
        <div style={CELL_STYLE}>{l.cols[S_TALLA]?.text || '—'}</div>
        {canEdit ? (
          <>
            <EditableCell value={val(S_CANTIDAD)} onSave={save(S_CANTIDAD)} align="right" type="number" placeholder="0" />
            <EditableCell value={costoRaw} onSave={save(S_COSTO)} align="right" type="number" placeholder="Sin costo" title="Costo que se le paga al proveedor — va en el PDF de la OC" />
            <EditableCell value={moneda} onSave={save(S_MONEDA)} placeholder="MXN" />
            <EditableCell value={val(S_DESCUENTO)} onSave={save(S_DESCUENTO)} align="right" type="number" suffix="%" />
          </>
        ) : (
          <>
            <div style={{ ...CELL_STYLE, color: 'var(--ink)', textAlign: 'right' }}>{val(S_CANTIDAD) || '0'}</div>
            <div style={{ ...CELL_STYLE, color: 'var(--ink)', textAlign: 'right' }}>
              {Number.isFinite(costo) && costo > 0 ? fmtMoney(costo) : '—'}
            </div>
            <div style={CELL_STYLE}>{moneda || '—'}</div>
            <div style={{ ...CELL_STYLE, textAlign: 'right' }}>{val(S_DESCUENTO) ? `${val(S_DESCUENTO)}%` : '—'}</div>
          </>
        )}
        <div>{estado && estadoColor ? <StatusBadge label={estado} color={estadoColor} tint={estadoColor + '22'} /> : <span style={{ ...CELL_STYLE, color: 'var(--ink-quiet)' }}>—</span>}</div>
        {canEdit
          ? <EditableCell value={val(S_ENTREGA_PROV)} onSave={save(S_ENTREGA_PROV)} type="date" placeholder="Sin fecha" />
          : <div style={CELL_STYLE}>{val(S_ENTREGA_PROV) || '—'}</div>}
        <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
          <span onClick={() => setVerHistorial(true)} title="Ver quién cambió qué en esta línea" style={ICON_BTN_STYLE}>🕐</span>
          {canEdit && <span onClick={() => setMover(true)} title="Mover esta línea a otro proveedor" style={ICON_BTN_STYLE}>⇄</span>}
          {canEdit && (
            <span
              onClick={borrando ? undefined : () => { if (window.confirm(`¿Eliminar la línea "${nombreLinea}"? Se borra también en Monday.`)) borrar(); }}
              title="Eliminar esta línea del proyecto"
              style={{ ...ICON_BTN_STYLE, color: borrando ? 'var(--ink-quiet)' : 'var(--status-perdida)' }}
            >
              ✕
            </span>
          )}
        </div>
      </div>
      {errorBorrar && (
        <div style={{ padding: '0 12px 8px', font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>{errorBorrar}</div>
      )}
      {verHistorial && <LineaHistorial entries={historial} titulo={nombreLinea} onClose={() => setVerHistorial(false)} />}
      {mover && <MoverProveedorModal lineaId={l.id} onClose={() => setMover(false)} onMoved={onChanged} />}
    </div>
  );
}

/** Campo con etiqueta arriba dentro de la franja "datos de esta OC" — antes los
 * inputs vivían sueltos en el encabezado, con la etiqueta solo de placeholder, y
 * empujaban los botones a un segundo renglón (Efraín, 2026-08-19: "poner todos
 * los botones en la misma línea"). */
function CampoOc({ label, value, onChange, placeholder, title, flex }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; title: string; flex: string;
}) {
  return (
    <label style={{ flex, minWidth: 150, display: 'block' }} title={title}>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 4 }}>{label}</div>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box', font: 'var(--text-label)', color: 'var(--ink)',
          padding: '8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)',
        }}
      />
    </label>
  );
}

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
 * (worker/lib/ocProveedorPdf.ts) en vez de disparar Eledo/cmp-tallas. Es SOLO
 * vista previa: no consume folio ni guarda nada. Para emitirla de verdad está
 * "Generar OC (portal)", al lado. */
function NativeOcButton({ proyectoId, proveedorId }: { proyectoId: string; proveedorId: string | null }) {
  const [preview, setPreview] = useState(false);
  // La vista previa alterna entre las dos formas del MISMO documento. Importa
  // que se pueda ver antes de emitir: "Generar OC" consume folio, y darse
  // cuenta ahí de que un producto salió sin foto ya cuesta una orden quemada.
  const [conImagenes, setConImagenes] = useState(false);
  if (!proveedorId) return null;
  const url = `/api/proyectos/${proyectoId}/oc-nativa/${proveedorId}/pdf${conImagenes ? '?imagenes=1' : ''}`;
  return (
    <>
      <Button variant="secondary" onClick={() => setPreview(true)} title="Vista previa de esta OC con el motor del portal — no consume folio ni guarda nada">
        Ver OC
      </Button>
      {preview && (
        <Modal title="Orden de compra — portal" onClose={() => setPreview(false)} width={760}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <Button variant={conImagenes ? 'secondary' : 'primary'} onClick={() => setConImagenes(false)}>Normal</Button>
            <Button variant={conImagenes ? 'primary' : 'secondary'} onClick={() => setConImagenes(true)}>Con imágenes</Button>
          </div>
          <Suspense fallback={<div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Generando…</div>}>
            <PdfCanvasPreview key={url} url={url} maxWidth={712} />
          </Suspense>
          <a href={url} download style={{ display: 'inline-block', marginTop: 12, font: 'var(--text-label)', color: 'var(--accent)' }}>
            Descargar
          </a>
        </Modal>
      )}
    </>
  );
}

/** Notas al proveedor de ESTA OC — texto libre que sale IMPRESO en el PDF
 * (Efraín, 2026-08-19: "un campo de texto en las Órdenes de Compra para dejar
 * notas al proveedor, que aparezcan impresas en el documento final"). Vive por
 * proveedor en D1 (worker/lib/ocNotas.ts), no en el Proyecto: la nota de un
 * proveedor no tiene por qué salir en la OC de los demás. Guarda al salir del
 * campo, como el resto de las celdas de este tab. */
function NotaProveedor({ proyectoId, proveedorId, inicial }: {
  proyectoId: string; proveedorId: string; inicial: string;
}) {
  const [texto, setTexto] = useState(inicial);
  const [guardado, setGuardado] = useState<'idle' | 'guardando' | 'ok' | 'error'>('idle');
  // La nota llega junto con el resto del tab (una sola llamada para todas las
  // tarjetas): si el fetch resuelve después del primer render, se adopta —
  // salvo que el usuario ya esté escribiendo.
  const [tocado, setTocado] = useState(false);
  useEffect(() => { if (!tocado) setTexto(inicial); }, [inicial, tocado]);

  const commit = async () => {
    if (texto.trim() === inicial.trim()) { setGuardado('idle'); return; }
    setGuardado('guardando');
    const res = await saveOcNota(proyectoId, proveedorId, texto);
    if (!res.ok) { setGuardado('error'); return; }
    setTexto(res.nota ?? '');
    setTocado(false);
    setGuardado('ok');
  };

  return (
    <div style={{ flex: '1 1 100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 4 }}>
        <span>Notas para el proveedor — se imprimen en la OC</span>
        <span style={{ color: guardado === 'error' ? 'var(--status-perdida)' : 'var(--ink-quiet)' }}>
          {guardado === 'guardando' ? 'Guardando…' : guardado === 'ok' ? 'Guardado' : guardado === 'error' ? 'No se pudo guardar' : ''}
        </span>
      </div>
      <textarea
        value={texto}
        maxLength={1200}
        rows={2}
        onChange={e => { setTocado(true); setTexto(e.target.value); setGuardado('idle'); }}
        onBlur={commit}
        placeholder="Ej. Entregar en almacén CDMX antes del 30 de agosto, marcar cajas por talla."
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical',
          font: 'var(--text-label)', color: 'var(--ink)', padding: '8px',
          borderRadius: 'var(--radius-md)', border: '1px solid var(--border)',
        }}
      />
    </div>
  );
}

/** Fotos de los productos de esta OC — una por SKU (Efraín, 2026-08-24: "solo
 * POR PRODUCTO"). La foto se guarda por producto y se reusa en las órdenes
 * siguientes, así que subirla una vez alcanza; el catálogo de Airtable es el
 * default y "Del catálogo" vuelve a él.
 *
 * Solo se pinta la tira: la que jala de Airtable sola es la generación del PDF
 * (worker/lib/ocImagenes.ts). Aquí un SKU sin foto se muestra vacío en vez de
 * salir a la red por cada producto cada vez que alguien abre el tab. */
function FotosProducto({ productos }: { productos: { sku: string; nombre: string }[] }) {
  const [estado, setEstado] = useState<Record<string, OcImagenDTO>>({});
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState('');
  const skus = productos.map(p => p.sku).join(',');

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    listOcImagenes(skus.split(',').filter(Boolean))
      .then(lista => {
        if (!vivo) return;
        setEstado(Object.fromEntries(lista.map(i => [i.sku.toUpperCase(), i])));
      })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [skus]);

  if (productos.length === 0) return null;

  const guardar = (sku: string, meta: OcImagenDTO) =>
    setEstado(prev => ({ ...prev, [sku.toUpperCase()]: meta }));

  return (
    <div style={{ flex: '1 1 100%' }}>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 6 }}>
        Fotos de la OC con imágenes — una por producto, se reusa en las siguientes órdenes
        {msg ? <span style={{ marginLeft: 8, color: 'var(--status-perdida)' }}>{msg}</span> : null}
      </div>
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
        {productos.map(p => (
          <FotoProducto
            key={p.sku}
            producto={p}
            meta={estado[p.sku.toUpperCase()]}
            cargando={cargando}
            onCambio={meta => { setMsg(''); guardar(p.sku, meta); }}
            onError={setMsg}
          />
        ))}
      </div>
    </div>
  );
}

function FotoProducto({ producto, meta, cargando, onCambio, onError }: {
  producto: { sku: string; nombre: string };
  meta?: OcImagenDTO;
  cargando: boolean;
  onCambio: (meta: OcImagenDTO) => void;
  onError: (msg: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState(false);
  // La URL de la miniatura no cambia al reemplazar la foto (el key de R2 sí),
  // así que se le cuelga la fecha de actualización para saltarse el caché.
  const src = meta ? ocImagenUrl(producto.sku, meta.updatedAt) : '';

  const correr = async (fn: () => Promise<OcImagenDTO>) => {
    setOcupado(true);
    try { onCambio(await fn()); }
    catch (err) { onError(err instanceof Error ? err.message : 'No se pudo actualizar la foto.'); }
    finally { setOcupado(false); }
  };

  return (
    <div style={{
      width: 132, flexShrink: 0, border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)', padding: 6, background: 'var(--bg-sunken)',
    }}>
      <div style={{
        height: 96, borderRadius: 'var(--radius-sm)', background: '#fff',
        border: '1px solid var(--border-subtle)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        {src
          ? <img src={src} alt={producto.nombre} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          : <span style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>
              {cargando ? '…' : 'Sin foto'}
            </span>}
      </div>
      <div title={producto.nombre} style={{
        font: 'var(--text-caption)', color: 'var(--ink)', marginTop: 4,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {producto.nombre}
      </div>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
        {producto.sku}{meta ? ` · ${meta.origen === 'subida' ? 'subida' : 'catálogo'}` : ''}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button
          type="button"
          disabled={ocupado}
          onClick={() => input.current?.click()}
          style={{ font: 'var(--text-caption)', color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          {meta ? 'Cambiar' : 'Subir'}
        </button>
        <button
          type="button"
          disabled={ocupado}
          title="Vuelve a jalar la foto del catálogo de Airtable"
          onClick={() => correr(() => restablecerOcImagen(producto.sku))}
          style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          Del catálogo
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png"
        hidden
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void correr(() => uploadOcImagen(producto.sku, file));
        }}
      />
    </div>
  );
}

/** Tarjeta de un proveedor: sus líneas + botón "Generar OC" acotado a él
 * (only_proveedor) — resultado local con el mismo contrato que ProyectoActionBar.
 * Método/Condiciones de pago son overrides SOLO de esta OC (WhatsApp 2026-08-04:
 * antes el default del Proyecto se aplicaba igual a todos los proveedores) —
 * prellenados con el default, no se guardan de vuelta a Monday. */
function ProveedorCard({ group, proyecto, oppId, reload, canEdit, activity, nota }: {
  group: ProveedorGroup; proyecto: ItemDetailDTO; oppId: string | null; reload: () => void;
  canEdit: boolean; activity: ActivityEntryDTO[]; nota: string;
}) {
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const [metodoPago, setMetodoPago] = useState(proyecto.cols[P_METODO_PAGO]?.text ?? '');
  const [condPago, setCondPago] = useState(proyecto.cols[P_COND_PAGO]?.text ?? '');
  const cantidadTotal = group.lineas.reduce((s, r) => s + (Number(r.cols[S_CANTIDAD]?.text?.replace(/,/g, '')) || 0), 0);
  // Total de la OC con el costo YA editado — es el número contra el que Compras
  // revisa que no se le fue un cero de más al capturar (Efraín, 2026-08-18).
  const montoTotal = group.lineas.reduce((s, r) => {
    const cant = Number(r.cols[S_CANTIDAD]?.text?.replace(/,/g, '')) || 0;
    const costo = Number(r.cols[S_COSTO]?.text?.replace(/,/g, '')) || 0;
    const desc = Number(r.cols[S_DESCUENTO]?.text?.replace(/,/g, '')) || 0;
    return s + cant * costo * (1 - desc / 100);
  }, 0);
  const monedaOc = group.lineas.map(r => r.cols[S_MONEDA]?.text).find(Boolean) ?? '';
  const ocFiles = toR2Files(parseFiles(proyecto.cols[P_OC_PDF]?.text), oppId, 'oc');
  // Un renglón por PRODUCTO (no por línea): la OC con imágenes junta las tallas
  // de un mismo SKU en una sola ficha, así que la foto también es una sola.
  const productos = useMemo(() => {
    const vistos = new Map<string, { sku: string; nombre: string }>();
    for (const l of group.lineas) {
      const sku = (l.cols[S_SKU]?.text ?? '').trim();
      if (!sku) continue;
      const key = sku.toUpperCase();
      if (!vistos.has(key)) vistos.set(key, { sku, nombre: l.cols[S_PRODUCTO]?.text || l.name || sku });
    }
    return [...vistos.values()];
  }, [group.lineas]);
  const ocFile = findLatestOcFile(ocFiles, [group.nombre, group.nombreItem]);

  const correr = (accion: 'generar-oc' | 'generar-oc-portal' | 'generar-oc-portal-imagenes') => async () => {
    setOutcome(null);
    try {
      const res = await proyectoAction(proyecto.id, accion, {
        onlyProveedor: group.proveedorId!,
        metodoPago: metodoPago.trim() || undefined,
        condPago: condPago.trim() || undefined,
      });
      setOutcome(describeResult(accion, res));
      reload();
    } catch {
      setOutcome({ kind: 'error', text: 'No se pudo ejecutar la acción. Verifica tu conexión.' });
    }
  };
  // Dos motores para el mismo documento mientras se prueba el propio: el del
  // portal (folio + PDF nativo, SIN firmas — Efraín, 2026-08-19) y el de
  // siempre, que pasa por cmp-tallas/Eledo y manda las 3 firmas de DocuSeal.
  const onGenerarPortal = correr('generar-oc-portal');
  const onGenerarImagenes = correr('generar-oc-portal-imagenes');
  const onGenerar = correr('generar-oc');

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', background: '#fff', overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <OcThumb file={ocFile} />
          <div>
            <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{group.nombre}</div>
            <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
              {group.correo ? `${group.correo} · ` : ''}{group.lineas.length} línea{group.lineas.length === 1 ? '' : 's'} · {cantidadTotal} pzas
              {montoTotal > 0 ? ` · ${fmtMoney(montoTotal)}${monedaOc ? ' ' + monedaOc : ''}` : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <NativeOcButton proyectoId={proyecto.id} proveedorId={group.proveedorId} />
          <ConfirmButton
            label="Generar OC (portal)"
            confirmLabel="¿Emitir la OC de este proveedor? Sin firmas"
            busyLabel="Generando OC…"
            disabled={!group.proveedorId}
            title={!group.proveedorId
              ? 'Asigna un proveedor a estas líneas primero'
              : 'Emite la OC con el motor del portal: toma folio y la guarda en el Proyecto. Sin firma electrónica — se firma a mano.'}
            onConfirm={onGenerarPortal}
          />
          <ConfirmButton
            label="Generar OC con imágenes"
            confirmLabel="¿Emitir la OC con foto por producto? Sin firmas"
            busyLabel="Generando OC…"
            disabled={!group.proveedorId}
            title={!group.proveedorId
              ? 'Asigna un proveedor a estas líneas primero'
              : 'La misma OC del portal pero con una ficha de media hoja por producto, con su foto — para que el proveedor vea cuál variante es'}
            onConfirm={onGenerarImagenes}
          />
          <ConfirmButton
            label="Generar OC (Monday)"
            confirmLabel="¿Generar la OC de este proveedor? Se manda a firmas"
            busyLabel="Generando… puede tardar unos minutos, no cierres esta pantalla"
            variant="secondary"
            disabled={!group.proveedorId}
            title={!group.proveedorId ? 'Asigna un proveedor a estas líneas primero' : 'Una OC de este proveedor por el flujo de Monday/cmp-tallas + firmas Elaborado→Revisado→Autorizado'}
            onConfirm={onGenerar}
          />
        </div>
      </div>
      {canEdit && (
        <div style={{
          padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start',
        }}>
          <CampoOc
            label="Método de pago" value={metodoPago} onChange={setMetodoPago}
            placeholder="Ej. TRANSFERENCIA" flex="1 1 200px"
            title="Método de pago de esta OC (no cambia el default del Proyecto)"
          />
          <CampoOc
            label="Condiciones de pago" value={condPago} onChange={setCondPago}
            placeholder="Ej. 50% anticipo, 50% contra entrega" flex="2 1 280px"
            title="Condiciones de pago de esta OC (no cambia el default del Proyecto)"
          />
          {group.proveedorId && (
            <NotaProveedor proyectoId={proyecto.id} proveedorId={group.proveedorId} inicial={nota} />
          )}
          <FotosProducto productos={productos} />
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 840 }}>
          <div style={{ display: 'grid', gridTemplateColumns: PROVEEDOR_GRID_TEMPLATE, gap: 8, padding: '8px 12px', font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
            {PROVEEDOR_GRID_COLS.map(c => <div key={c.label} style={{ textAlign: c.align }}>{c.label}</div>)}
          </div>
          {group.lineas.map(l => (
            <ProveedorLineaRow
              key={l.id}
              l={l}
              proyectoId={proyecto.id}
              canEdit={canEdit}
              historial={activity.filter(e => e.itemId === l.id)}
              onChanged={reload}
            />
          ))}
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
function ProveedorGrid({ lineas, proyecto, oppId, reload, canEdit, activity, notas }: {
  lineas: ItemDTO[]; proyecto: ItemDetailDTO; oppId: string | null; reload: () => void;
  canEdit: boolean; activity: ActivityEntryDTO[]; notas: Record<string, string>;
}) {
  const grupos = groupByProveedor(lineas);
  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {grupos.map(g => (
        <ProveedorCard
          key={g.key} group={g} proyecto={proyecto} oppId={oppId} reload={reload}
          canEdit={canEdit} activity={activity}
          nota={g.proveedorId ? (notas[g.proveedorId] ?? '') : ''}
        />
      ))}
    </div>
  );
}

export function ProyectoOrdenesSection({ state, oppId }: { state: ProyectoState; oppId: string | null }) {
  const me = useMe();
  const canCompras = me?.role === 'compras' || me?.role === 'admin';
  const [agregar, setAgregar] = useState(false);
  // Actividad del Proyecto + TODAS sus líneas en una sola llamada (el endpoint
  // ya agrega los hijos, worker/routes/boards.ts): cada línea filtra la suya
  // para el reloj, en vez de una llamada por renglón.
  const [activity, setActivity] = useState<ActivityEntryDTO[]>([]);
  // Notas al proveedor de TODAS las OC del proyecto, en una sola llamada —
  // cada tarjeta toma la suya por id de proveedor.
  const [notas, setNotas] = useState<Record<string, string>>({});
  // `nonce` y no el largo de children: editar un costo no cambia el número de
  // líneas, y sin esto el reloj seguía mostrando "sin cambios" justo después
  // de guardar (visto en la prueba local 2026-08-18).
  const [nonce, setNonce] = useState(0);
  const proyectoId = state.proyecto?.id;
  useEffect(() => {
    // Solo Compras/Admin: el historial responde 403 al resto (shared/visibility.ts
    // canReadActivity) y el grid con el reloj tampoco se les pinta.
    if (!proyectoId || !canCompras) return;
    getActivity('proyectos', proyectoId).then(setActivity).catch(() => setActivity([]));
    getOcNotas(proyectoId).then(setNotas).catch(() => setNotas({}));
  }, [proyectoId, canCompras, nonce]);
  const onChanged = () => { state.reload(); setNonce(n => n + 1); };

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
        {canCompras && ' Producto, color, cantidad, costo, moneda, descuento y entrega se editan aquí mismo (clic en la celda) y se guardan en Monday.'}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <ProyectoActionBar proyecto={p} reload={state.reload} actions={['generar-oc']} />
        {canCompras && (
          <Button variant="secondary" onClick={() => setAgregar(true)}>
            + Agregar producto
          </Button>
        )}
      </div>
      {canCompras ? (
        lineas.length > 0
          ? <ProveedorGrid lineas={lineas} proyecto={p} oppId={oppId} reload={onChanged} canEdit activity={activity} notas={notas} />
          : (
            <div style={{ marginTop: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
              Aún no hay líneas en el proyecto — importa las tallas primero, o agrega un producto a mano con el botón de arriba.
            </div>
          )
      ) : (
        <div style={{ marginTop: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>El desglose por proveedor lo gestiona Compras.</div>
      )}
      {agregar && (
        <AgregarLineaModal
          proyectoId={p.id}
          onClose={() => setAgregar(false)}
          onCreated={onChanged}
        />
      )}
    </div>
  );
}
