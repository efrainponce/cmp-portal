// Cotización / línea de producto grid — mirrors the design's fixed-column
// table. Each column is keyed to its real Monday column id; columns the
// viewer's role can't see simply aren't in `cols` and are skipped (server
// already strips them — see docs/dev-contracts.md).
//
// In BOTH variants, columns the server marked writable for the viewer's role
// (`ColMeta.w`, from shared/visibility.ts) AND listed in INLINE_EDITABLE_COLS
// render as inputs: compras/admin capture costs in `costeo`, vendedor can only
// view pricing in `venta` (Efraín 2026-07-16 — vendedores edit product/color/
// quantity only via "Nueva versión", not inline; price set by costeo/admin via
// versioning in cmp-tallas). Editing cost columns recomputes the row's formula
// columns locally (src/lib/costeoCalc.ts, verified 1:1 against Monday's own
// formulas) for an instant preview, then PATCHes only the raw input on blur —
// formula columns are never written back, Monday recomputes those itself and
// the mirror catches up on refetch.
import { useEffect, useState } from 'react';
import type { ColMeta, ColVal, ItemDTO, QuoteVersionDTO } from '../../../lib/api';
import { patchItem, apiFetch, listItems } from '../../../lib/apiClient';
import { fmtMoney } from '../../../lib/format';
import { MonoTag, StatusBadge } from '../../../components/core/Badges';
import { Button } from '../../../components/core/Button';
import { previewRow, COL } from '../../../lib/costeoCalc';

const COSTO_DISTR_COL = 'numeric_mm0bph99';
const ETAPA_COSTEO_COL = 'color_mm084gvf';

const PRODUCTO_COL = 'lookup_mm0x4kda';        // mirror del producto ligado — solo lectura directa
const PRODUCTO_TXT_COL = 'text_mm0bkm1j';      // Producto (texto libre) — fallback sin catálogo
const PRODUCTO_REL_COL = 'board_relation_mkzmafgp'; // relación real a Productos — puebla el mirror
const COLOR_COL = 'text_mm07s2mg';
const COLORES_DISP_COL = 'lookup_mkznm0h3';    // mirror: colores disponibles del producto ligado (asíncrono)
const PRODUCTO_COLOR_DROPDOWN_COL = 'dropdown_mkztty4b'; // Color del producto en el catálogo — misma
// fuente que valida enviarCosteo. Se lee directo del `catalog` ya cargado en memoria (sin esperar
// al mirror asíncrono del subitem, que solo se puebla después de que Monday recompute la relación).

// Mismo status column y labels que worker/lib/quoteVersions.ts (SUB_EMB_STATUS) —
// marcar "Con Embellecimiento" aquí es lo que hace que la línea aparezca en la
// tab Embellecimientos (EmbellecimientosTab filtra por este mismo label).
const EMB_STATUS_COL = 'color_mm1b34bg';
const EMB_LABEL_CON = 'Con Embellecimiento';
const EMB_LABEL_SIN = 'Sin Embellecimiento';

// Determina qué columnas son editables inline según la etapa de la oportunidad.
// En "Nueva oportunidad" (stage 4): vendedor edita producto/color/cantidad/embellecimiento inline.
// En otras etapas: esos cambios SOLO vía "Nueva versión" (archivable, dispara costeo).
// Precio: NUNCA editable por vendedor (solo vía cmp-tallas costeo/admin).
// Costos: solo compras/admin.
function inlineEditableCols(stage: string | undefined): Set<string> {
  const base = new Set<string>([
    COL.costoDistr, COL.descuentoPct, COL.conversion, COL.gastosPct,
  ]);
  if (stage === '4') { // Nueva oportunidad
    base.add(PRODUCTO_COL);
    base.add(COLOR_COL);
    base.add(COL.cantidad);
    base.add(EMB_STATUS_COL);
  }
  return base;
}

// Colores reales de la columna status "Etapa Costeo" en Monday (settings_str),
// no inventados — docs/monday-column-map.md.
const ETAPA_COSTEO_COLORS: Record<string, { color: string; tint: string }> = {
  'No iniciado': { color: '#68737d', tint: '#e6e9eb' },
  'En curso': { color: '#e99729', tint: '#fdecd7' },
  'Listo': { color: '#00b461', tint: '#d6f5e6' },
  'Detenido': { color: '#ce3048', tint: '#fbdbdf' },
  'Modificado': { color: '#3db0df', tint: '#dbf0fa' },
};

/** Chips V1/V2… — vigente resaltada. Seleccionar una anterior muestra su
 * instantánea (solo lectura, sin fórmulas: esas solo existen para la vigente).
 * "Enviar a costeo" junto a la vigente abre el draft de nueva versión — crear
 * una versión ES la forma de mandar cambios de línea a costeo otra vez. */
export function VersionChips({
  versions, selected, onSelect, onNuevaVersion,
}: {
  versions: QuoteVersionDTO[]; selected: number | null; onSelect: (id: number | null) => void;
  onNuevaVersion?: () => void;
}) {
  if (versions.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
      {versions.map((v) => {
        const isSelected = selected === null ? v.status === 'vigente' : selected === v.id;
        return (
          <div
            key={v.id}
            onClick={() => onSelect(v.status === 'vigente' ? null : v.id)}
            title={v.status === 'vigente' ? 'Vigente' : `Superada — ${v.createdAt}`}
            style={{
              cursor: 'pointer', font: 'var(--text-label-strong)', padding: '4px 12px',
              borderRadius: 'var(--radius-pill)',
              background: isSelected ? '#2b2925' : 'var(--bg-sunken)',
              color: isSelected ? '#fff' : 'var(--ink-secondary)',
            }}
          >
            {v.label}{v.status === 'vigente' ? ' · vigente' : ''}
          </div>
        );
      })}
      {onNuevaVersion && (
        <div
          onClick={onNuevaVersion}
          title="Crea una nueva versión de la cotización y la manda a costeo"
          style={{
            cursor: 'pointer', font: 'var(--text-label-strong)', padding: '4px 12px',
            borderRadius: 'var(--radius-pill)', border: '1px dashed var(--border)',
            color: 'var(--accent)', background: 'transparent',
          }}
        >
          + Enviar a costeo
        </div>
      )}
    </div>
  );
}

function SnapshotTable({ version }: { version: QuoteVersionDTO }) {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1.6fr .5fr .7fr .7fr .85fr .85fr',
        padding: '9px 14px', background: 'var(--bg-sunken)', font: '700 9.5px \'Inter\', sans-serif',
        color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '.3px',
      }}>
        <div>Producto</div><div>SKU</div><div>Color</div><div>Cant.</div>
        <div style={{ textAlign: 'right' }}>P. venta C/U</div><div style={{ textAlign: 'right' }}>Subtotal</div>
      </div>
      {version.products.map((p, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '1.6fr .5fr .7fr .7fr .85fr .85fr',
          alignItems: 'center', padding: '9px 14px', background: '#fff', borderTop: '1px solid var(--border-subtle)',
          font: 'var(--text-label)', color: 'var(--ink-secondary)',
        }}>
          <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>
            {p.producto}{p.embellecimiento ? ' 🎨' : ''}
          </div>
          <div>{p.sku ? <MonoTag style={{ display: 'inline-block' }}>{p.sku}</MonoTag> : '—'}</div>
          <div>{p.color || '—'}</div>
          <div>{p.cantidad}</div>
          <div style={{ textAlign: 'right' }}>{p.precioUnitario ? fmtMoney(p.precioUnitario) : '—'}</div>
          <div style={{ textAlign: 'right' }}>{fmtMoney((p.precioUnitario ?? 0) * p.cantidad)}</div>
        </div>
      ))}
    </div>
  );
}

interface GridCol {
  id: string;
  label: string;
  align: 'left' | 'right';
  kind: 'text' | 'money' | 'percent';
}

const GRID_COLS_COSTEO: GridCol[] = [
  { id: 'lookup_mm0x4kda', label: 'Producto', align: 'left', kind: 'text' },
  { id: 'lookup_mkzn7x9a', label: 'SKU', align: 'left', kind: 'text' },
  { id: 'numeric_mkzm6399', label: 'Cant.', align: 'left', kind: 'text' },
  { id: ETAPA_COSTEO_COL, label: 'Etapa costeo', align: 'left', kind: 'text' },
  { id: 'lookup_mm11t8gj', label: 'Moneda', align: 'left', kind: 'text' },
  { id: 'numeric_mm0bph99', label: 'Costo distr. C/U', align: 'right', kind: 'money' },
  { id: 'numeric_mkzn2q51', label: 'Desc. %', align: 'right', kind: 'percent' },
  { id: 'formula_mkzngnjm', label: 'Costo real C/U', align: 'right', kind: 'money' },
  { id: 'numeric_mm0rvhgs', label: 'Conversión', align: 'right', kind: 'text' },
  { id: 'numeric_mkzngs9x', label: 'Gastos %', align: 'right', kind: 'percent' },
  { id: 'numeric_mm0gxvpa', label: 'Costo embell. C/U', align: 'right', kind: 'money' },
  { id: 'formula_mkznpfgg', label: 'Costo total C/U', align: 'right', kind: 'money' },
  { id: 'numeric_mkzneg3d', label: 'P. venta', align: 'right', kind: 'money' },
  { id: 'formula_mkznpw5p', label: 'Margen', align: 'right', kind: 'percent' },
];

// Ventas-side view: no cost breakdown, just what the customer is quoted.
const GRID_COLS_VENTA: GridCol[] = [
  { id: 'lookup_mm0x4kda', label: 'Producto', align: 'left', kind: 'text' },
  { id: 'lookup_mkzn7x9a', label: 'SKU', align: 'left', kind: 'text' },
  { id: COLOR_COL, label: 'Color', align: 'left', kind: 'text' },
  { id: 'numeric_mkzm6399', label: 'Cant.', align: 'left', kind: 'text' },
  { id: EMB_STATUS_COL, label: 'Con Embellecimiento', align: 'left', kind: 'text' },
  { id: 'numeric_mkzneg3d', label: 'P. venta C/U', align: 'right', kind: 'money' },
  { id: 'formula_mkznmjh6', label: 'Subtotal', align: 'right', kind: 'money' },
  { id: 'formula_mm0rtdqp', label: 'IVA', align: 'right', kind: 'money' },
  { id: 'formula_mm00xy0n', label: 'Total c/IVA', align: 'right', kind: 'money' },
];

// Mismo fallback que worker/lib/quoteVersions.ts's productoNombre(): el mirror
// (lookup_mm0x4kda) solo se puebla cuando hay relación real a Productos; sin
// relación, cae al texto libre (text_mm0bkm1j). `preview` gana primero — es el
// valor recién guardado antes de que el mirror asíncrono de Monday lo confirme.
function displayProducto(product: ItemDTO, preview?: Record<string, ColVal>): string {
  return preview?.[PRODUCTO_COL]?.text || product.cols[PRODUCTO_COL]?.text || product.cols[PRODUCTO_TXT_COL]?.text || '';
}

function cellValue(col: GridCol, val?: ColVal): string {
  if (!val || val.text === '') return '—';
  if (col.kind === 'money') {
    const n = Number(val.value ?? val.text);
    return Number.isNaN(n) ? val.text : fmtMoney(n);
  }
  if (col.kind === 'percent') {
    const n = Number(val.value ?? val.text);
    return Number.isNaN(n) ? val.text : `${n}%`;
  }
  return val.text;
}

const inputStyle: React.CSSProperties = {
  width: '100%', font: 'var(--text-label)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 6, padding: '3px 6px',
  textAlign: 'right', boxSizing: 'border-box',
};

const warningStyle: React.CSSProperties = {
  font: 'var(--text-caption)', color: '#9c4c3d', marginTop: 3,
};

function RowWarning({ children }: { children: React.ReactNode }) {
  return <div style={warningStyle}>⚠ {children}</div>;
}

interface RowEditState {
  editing: Record<string, string>;   // colId -> in-progress raw text
  preview: Record<string, ColVal>;   // colId -> locally recomputed formula preview
  saving: Record<string, boolean>;   // colId -> PATCH in flight
  error?: string;
}

const EMPTY_ROW: RowEditState = { editing: {}, preview: {}, saving: {} };

export function CotizacionTab({
  subCols, products, variant = 'venta', onSaved, versions = [], onNuevaVersion, editable = true, stage, oppId,
}: {
  subCols: ColMeta[]; products: ItemDTO[]; variant?: 'venta' | 'costeo'; onSaved?: () => void;
  versions?: QuoteVersionDTO[]; onNuevaVersion?: () => void;
  /** false en Ganada/Perdida — las líneas quedan de solo lectura, igual que el candado de versiones. */
  editable?: boolean;
  /** deal_stage de la oportunidad — determina qué campos vendedor puede editar inline. */
  stage?: string;
  /** ID de la oportunidad — necesario para crear líneas en Nueva oportunidad. */
  oppId?: string;
}) {
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const selectedVersion = selectedVersionId != null ? versions.find((v) => v.id === selectedVersionId) : undefined;

  const gridCols = variant === 'costeo' ? GRID_COLS_COSTEO : GRID_COLS_VENTA;
  const visibleCols = gridCols.filter((gc) => subCols.some((c) => c.id === gc.id));
  const writableIds = new Set(subCols.filter((c) => c.w).map((c) => c.id));
  const editableCols = inlineEditableCols(stage);

  const [rows, setRows] = useState<Record<string, RowEditState>>({});
  const [creatingLine, setCreatingLine] = useState(false);
  const [catalog, setCatalog] = useState<ItemDTO[]>([]);
  const rowState = (id: string): RowEditState => rows[id] ?? EMPTY_ROW;
  const patchRow = (id: string, patch: Partial<RowEditState>) =>
    setRows((r) => ({ ...r, [id]: { ...rowState(id), ...patch } }));

  // Catálogo de Productos — solo se necesita cuando el producto es editable
  // inline (Nueva oportunidad), para el datalist y para resolver el nombre
  // tecleado a un item_id real (board_relation_mkzmafgp, igual que NuevaVersionForm).
  useEffect(() => {
    if (stage === '4' && editable) listItems('productos').then(setCatalog).catch(() => {});
  }, [stage, editable]);

  const onAddLine = async () => {
    if (!oppId) return;
    setCreatingLine(true);
    try {
      const res = await apiFetch(`/oportunidades/${oppId}/productos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('No se pudo crear la línea');
      onSaved?.();
    } catch (e) {
      console.error('Error creando línea:', e);
    } finally {
      setCreatingLine(false);
    }
  };

  const onEdit = (product: ItemDTO, colId: string, raw: string) => {
    const state = rowState(product.id);
    const editing = { ...state.editing, [colId]: raw };
    const edited: Record<string, number> = {};
    for (const [k, v] of Object.entries(editing)) {
      const n = parseFloat(v);
      if (Number.isFinite(n)) edited[k] = n;
    }
    const preview = Number.isFinite(parseFloat(raw)) ? previewRow(product, edited) : state.preview;
    patchRow(product.id, { editing, preview, error: undefined });
  };

  const onBlur = async (product: ItemDTO, colId: string) => {
    const state = rowState(product.id);
    const raw = state.editing[colId];
    if (raw === undefined) return;
    const current = product.cols[colId]?.text ?? '';
    if (raw.trim() === '' || raw === current) {
      const editing = { ...state.editing };
      delete editing[colId];
      patchRow(product.id, { editing });
      return;
    }
    if (!Number.isFinite(parseFloat(raw))) {
      patchRow(product.id, { error: 'Valor inválido.' });
      return;
    }
    patchRow(product.id, { saving: { ...state.saving, [colId]: true }, error: undefined });
    try {
      await patchItem('oportunidades_sub', product.id, { [colId]: raw });
    } catch (e) {
      const after = rowState(product.id);
      const saving = { ...after.saving };
      delete saving[colId];
      patchRow(product.id, { saving, error: e instanceof Error ? e.message : 'No se pudo guardar.' });
      return;
    }
    const after = rowState(product.id);
    const editing = { ...after.editing };
    delete editing[colId];
    const saving = { ...after.saving };
    delete saving[colId];
    patchRow(product.id, { editing, saving });
    onSaved?.();
  };

  // Producto/Color son texto libre, no numérico — sin preview de fórmulas.
  const onTextEdit = (product: ItemDTO, colId: string, raw: string) => {
    const state = rowState(product.id);
    patchRow(product.id, { editing: { ...state.editing, [colId]: raw }, error: undefined });
  };

  // Color es un <select> — se guarda al elegir (onChange), no al perder foco:
  // un <select> no tiene un "blur para confirmar" natural como un input de texto.
  const onColorChange = async (product: ItemDTO, raw: string) => {
    const state = rowState(product.id);
    const current = product.cols[COLOR_COL]?.text ?? '';
    patchRow(product.id, { editing: { ...state.editing, [COLOR_COL]: raw } });
    if (raw === current) return;
    patchRow(product.id, { saving: { ...state.saving, [COLOR_COL]: true }, error: undefined });
    try {
      await patchItem('oportunidades_sub', product.id, { [COLOR_COL]: raw });
    } catch (e) {
      const after = rowState(product.id);
      const saving = { ...after.saving };
      delete saving[COLOR_COL];
      patchRow(product.id, { saving, error: e instanceof Error ? e.message : 'No se pudo guardar.' });
      return;
    }
    const after = rowState(product.id);
    const saving = { ...after.saving };
    delete saving[COLOR_COL];
    patchRow(product.id, { saving });
    onSaved?.();
  };

  // Con/Sin Embellecimiento — mismo status column y labels que submitVersion
  // (worker/lib/quoteVersions.ts). Marcarla "Con" es lo que hace que la línea
  // aparezca en EmbellecimientosTab (filtra por ese mismo label).
  const onEmbellecimientoChange = async (product: ItemDTO, con: boolean) => {
    const label = con ? EMB_LABEL_CON : EMB_LABEL_SIN;
    const state = rowState(product.id);
    patchRow(product.id, { saving: { ...state.saving, [EMB_STATUS_COL]: true }, error: undefined });
    try {
      await patchItem('oportunidades_sub', product.id, { [EMB_STATUS_COL]: label });
    } catch (e) {
      const after = rowState(product.id);
      const saving = { ...after.saving };
      delete saving[EMB_STATUS_COL];
      patchRow(product.id, { saving, error: e instanceof Error ? e.message : 'No se pudo guardar.' });
      return;
    }
    const after = rowState(product.id);
    const saving = { ...after.saving };
    delete saving[EMB_STATUS_COL];
    const preview = { ...after.preview, [EMB_STATUS_COL]: { text: label, type: 'status' } };
    patchRow(product.id, { saving, preview });
    onSaved?.();
  };

  // Al elegir un producto del catálogo escribe la relación real
  // (board_relation_mkzmafgp) — Monday puebla el mirror (lookup_mm0x4kda,
  // SKU, Marca…) solo. Sin match en catálogo, cae a texto libre
  // (text_mm0bkm1j) — mismo criterio que NuevaVersionForm/submitVersion.
  const onProductoBlur = async (product: ItemDTO) => {
    const state = rowState(product.id);
    const raw = state.editing[PRODUCTO_COL];
    if (raw === undefined) return;
    const current = displayProducto(product, state.preview);
    if (raw.trim() === '' || raw === current) {
      const editing = { ...state.editing };
      delete editing[PRODUCTO_COL];
      patchRow(product.id, { editing });
      return;
    }
    const match = catalog.find((c) => c.name.trim().toLowerCase() === raw.trim().toLowerCase());
    patchRow(product.id, { saving: { ...state.saving, [PRODUCTO_COL]: true }, error: undefined });
    try {
      if (match) {
        await patchItem('oportunidades_sub', product.id, { [PRODUCTO_REL_COL]: match.id });
      } else {
        await patchItem('oportunidades_sub', product.id, { [PRODUCTO_TXT_COL]: raw });
      }
    } catch (e) {
      const after = rowState(product.id);
      const saving = { ...after.saving };
      delete saving[PRODUCTO_COL];
      patchRow(product.id, { saving, error: e instanceof Error ? e.message : 'No se pudo guardar.' });
      return;
    }
    const after = rowState(product.id);
    const editing = { ...after.editing };
    delete editing[PRODUCTO_COL];
    const saving = { ...after.saving };
    delete saving[PRODUCTO_COL];
    // El write real fue a board_relation_mkzmafgp o text_mm0bkm1j — el mirror
    // que se MUESTRA (lookup_mm0x4kda) lo puebla Monday de forma asíncrona
    // (el outbox manda el mutation en waitUntil, después de responder). Sin
    // este preview local, el refetch inmediato de onSaved() todavía trae el
    // mirror viejo/vacío y parece que la edición no se guardó.
    const preview = { ...after.preview, [PRODUCTO_COL]: { text: match ? match.name : raw, type: 'text' } };
    patchRow(product.id, { editing, saving, preview });
    onSaved?.();
  };

  if (selectedVersion) {
    return (
      <div style={{ padding: '24px 32px 40px', width: '100%', boxSizing: 'border-box' }}>
        <VersionChips versions={versions} selected={selectedVersionId} onSelect={setSelectedVersionId} />
        <SnapshotTable version={selectedVersion} />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div style={{ padding: '24px 32px 40px', width: '100%', boxSizing: 'border-box' }}>
        <VersionChips versions={versions} selected={selectedVersionId} onSelect={setSelectedVersionId} onNuevaVersion={onNuevaVersion} />
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)', marginBottom: 16 }}>
          Sin líneas de producto registradas.
        </div>
        {stage === '4' && editable && (
          <Button
            variant="primary"
            onClick={creatingLine ? undefined : onAddLine}
            style={{ opacity: creatingLine ? 0.6 : 1 }}
          >
            {creatingLine ? 'Agregando línea…' : '+ Agregar línea'}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px 40px', width: '100%', boxSizing: 'border-box' }}>
      <VersionChips versions={versions} selected={selectedVersionId} onSelect={setSelectedVersionId} onNuevaVersion={onNuevaVersion} />
      <datalist id="productos-catalogo-cotizacion">
        {catalog.map((p) => <option key={p.id} value={p.name} />)}
      </datalist>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)' }}>
        <div style={variant === 'costeo' ? { minWidth: 900 } : undefined}>
          <div style={{
            display: 'grid', gridTemplateColumns: `1.6fr ${visibleCols.slice(1).map(() => '.85fr').join(' ')}`,
            padding: '9px 14px', background: 'var(--bg-sunken)', font: '700 9.5px \'Inter\', sans-serif',
            color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '.3px',
          }}>
            {visibleCols.map((c) => (
              <div key={c.id} style={{ textAlign: c.align }}>{c.label}</div>
            ))}
          </div>
          {products.map((p) => {
            const state = rowState(p.id);
            return (
              <div key={p.id} style={{ borderTop: '1px solid var(--border-subtle)', background: '#fff' }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: `1.6fr ${visibleCols.slice(1).map(() => '.85fr').join(' ')}`,
                  alignItems: 'center', padding: '9px 14px',
                }}>
                  {visibleCols.map((c, idx) => {
                    // lookup_mm0x4kda es un mirror — Monday nunca lo deja escribir
                    // directo, así que no está en writableIds. Lo real editable son
                    // sus dos posibles destinos de escritura (texto libre o relación).
                    const writable = c.id === PRODUCTO_COL
                      ? editable && editableCols.has(c.id) && (writableIds.has(PRODUCTO_TXT_COL) || writableIds.has(PRODUCTO_REL_COL))
                      : editable && writableIds.has(c.id) && editableCols.has(c.id);
                    const displayVal = state.preview[c.id] ?? p.cols[c.id];

                    if (writable && c.id === PRODUCTO_COL) {
                      const raw = state.editing[PRODUCTO_COL] ?? displayProducto(p, state.preview);
                      return (
                        <div key={c.id} style={{ textAlign: c.align }}>
                          <input
                            list="productos-catalogo-cotizacion"
                            value={raw}
                            disabled={!!state.saving[PRODUCTO_COL]}
                            onChange={(e) => onTextEdit(p, PRODUCTO_COL, e.target.value)}
                            onBlur={() => onProductoBlur(p)}
                            placeholder="Elegir producto…"
                            style={{ ...inputStyle, textAlign: 'left' }}
                          />
                        </div>
                      );
                    }
                    if (writable && c.id === COLOR_COL) {
                      const raw = state.editing[COLOR_COL] ?? (p.cols[COLOR_COL]?.text ?? '');
                      // Fuente primaria: el Color del producto en el catálogo (ya cargado en
                      // memoria, instantáneo). Fallback: el mirror del subitem (lookup_mkznm0h3),
                      // que solo se puebla después de que Monday recompute la relación.
                      const productoNombre = displayProducto(p, state.preview);
                      const productoMatch = catalog.find(
                        (c2) => c2.name.trim().toLowerCase() === productoNombre.trim().toLowerCase(),
                      );
                      const catalogColores = (productoMatch?.cols[PRODUCTO_COLOR_DROPDOWN_COL]?.text ?? '')
                        .split(',').map((s) => s.trim()).filter(Boolean);
                      const mirrorColores = (p.cols[COLORES_DISP_COL]?.text ?? '')
                        .split(',').map((s) => s.trim()).filter(Boolean);
                      const disponibles = catalogColores.length > 0 ? catalogColores : mirrorColores;
                      return (
                        <div key={c.id} style={{ textAlign: c.align }}>
                          <select
                            value={raw}
                            disabled={!!state.saving[COLOR_COL] || disponibles.length === 0}
                            onChange={(e) => onColorChange(p, e.target.value)}
                            style={{ ...inputStyle, textAlign: 'left' }}
                          >
                            <option value="">{disponibles.length > 0 ? 'Elegir color…' : 'Elige un producto primero'}</option>
                            {disponibles.map((d) => <option key={d} value={d}>{d}</option>)}
                            {/* si el color guardado ya no está en la lista (cambiaron de producto), no lo escondas en silencio */}
                            {raw && !disponibles.includes(raw) && <option value={raw}>{raw}</option>}
                          </select>
                          {!raw && <RowWarning>Elige un color</RowWarning>}
                        </div>
                      );
                    }
                    if (writable && c.id === COL.cantidad) {
                      const raw = state.editing[c.id] ?? (p.cols[c.id]?.text ?? '');
                      const cantidadNum = parseFloat(raw);
                      const sinCantidad = !Number.isFinite(cantidadNum) || cantidadNum <= 0;
                      return (
                        <div key={c.id} style={{ textAlign: c.align }}>
                          <input
                            type="number"
                            value={raw}
                            disabled={!!state.saving[c.id]}
                            onChange={(e) => onEdit(p, c.id, e.target.value)}
                            onBlur={() => onBlur(p, c.id)}
                            style={inputStyle}
                          />
                          {sinCantidad && <RowWarning>Cantidad requerida</RowWarning>}
                        </div>
                      );
                    }
                    if (writable && c.id === EMB_STATUS_COL) {
                      const label = state.preview[EMB_STATUS_COL]?.text ?? p.cols[EMB_STATUS_COL]?.text ?? '';
                      const checked = label === EMB_LABEL_CON;
                      return (
                        <div key={c.id} style={{ textAlign: c.align }}>
                          <label style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            cursor: state.saving[EMB_STATUS_COL] ? 'default' : 'pointer',
                          }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!!state.saving[EMB_STATUS_COL]}
                              onChange={(e) => onEmbellecimientoChange(p, e.target.checked)}
                            />
                            <span style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>
                              {checked ? 'Sí' : 'No'}
                            </span>
                          </label>
                        </div>
                      );
                    }
                    if (writable) {
                      const raw = state.editing[c.id] ?? (p.cols[c.id]?.text ?? '');
                      return (
                        <div key={c.id} style={{ textAlign: c.align }}>
                          <input
                            type="number"
                            value={raw}
                            disabled={!!state.saving[c.id]}
                            onChange={(e) => onEdit(p, c.id, e.target.value)}
                            onBlur={() => onBlur(p, c.id)}
                            style={inputStyle}
                          />
                        </div>
                      );
                    }
                    return (
                      <div key={c.id} style={{
                        textAlign: c.align,
                        font: idx === 0 ? 'var(--text-body-strong)' : 'var(--text-label)',
                        color: idx === 0 ? 'var(--ink)' : 'var(--ink-secondary)',
                      }}>
                        {idx === 0 && p.pendingWrite && <span title="guardado, sincronizando…" style={{ marginRight: 6, color: 'var(--accent)' }}>⏳</span>}
                        {idx === 0 && variant === 'costeo' && !p.cols[COSTO_DISTR_COL]?.text && (
                          <StatusBadge label="Pendiente de costeo" color="#9c4c3d" tint="#f3e5e1" style={{ marginRight: 6 }} />
                        )}
                        {c.id === PRODUCTO_COL && (displayProducto(p, state.preview) || '—')}
                        {c.id === 'lookup_mkzn7x9a' && (
                          <MonoTag style={{ display: 'inline-block' }}>{cellValue(c, displayVal)}</MonoTag>
                        )}
                        {c.id === ETAPA_COSTEO_COL && (() => {
                          const label = cellValue(c, displayVal);
                          const colors = ETAPA_COSTEO_COLORS[label] ?? ETAPA_COSTEO_COLORS['No iniciado'];
                          return label === '—'
                            ? '—'
                            : <StatusBadge label={label} color={colors.color} tint={colors.tint} />;
                        })()}
                        {c.id === EMB_STATUS_COL && (() => {
                          const label = state.preview[EMB_STATUS_COL]?.text ?? p.cols[EMB_STATUS_COL]?.text;
                          const con = label === EMB_LABEL_CON;
                          return (
                            <StatusBadge
                              label={con ? 'Sí' : 'No'}
                              color={con ? '#00b461' : '#68737d'}
                              tint={con ? '#d6f5e6' : '#e6e9eb'}
                            />
                          );
                        })()}
                        {c.id !== PRODUCTO_COL && c.id !== 'lookup_mkzn7x9a' && c.id !== ETAPA_COSTEO_COL && c.id !== EMB_STATUS_COL && cellValue(c, displayVal)}
                      </div>
                    );
                  })}
                </div>
                {state.error && (
                  <div style={{ padding: '0 14px 8px', font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>
                    {state.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
