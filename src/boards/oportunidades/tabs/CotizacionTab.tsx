// Cotización / línea de producto grid — mirrors the design's fixed-column
// table. Metadata de columnas, totales, chips de versión y PDFs viven en
// ./cotizacion/* — aquí queda la grid interactiva y sus writes.
//
// In BOTH variants, columns the server marked writable for the viewer's role
// (`ColMeta.w`, from shared/visibility.ts) AND listed in inlineEditableCols
// render as inputs: compras/admin capture costs in `costeo`, vendedor edits
// product/color/quantity inline in Nueva oportunidad Y sobre un borrador de
// versión (`draft` — vigente sin costear, recién duplicada con "+ Nueva
// versión"; Efraín 2026-07-17). Price is never vendedor-editable (set by
// costeo/admin via cmp-tallas). Editing cost columns recomputes the row's formula
// columns locally (src/lib/costeoCalc.ts, verified 1:1 against Monday's own
// formulas) for an instant preview, then PATCHes only the raw input on blur —
// formula columns are never written back, Monday recomputes those itself and
// the mirror catches up on refetch.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ColMeta, ColVal, ItemDetailDTO, ItemDTO, QuoteVersionDTO } from '../../../lib/api';
import { patchItem, apiFetch, listItems } from '../../../lib/apiClient';
import { Button } from '../../../components/core/Button';
import { previewRow, COL } from '../../../lib/costeoCalc';
import { useIsMobile } from '../../../lib/useIsMobile';
import { useMe } from '../../../lib/useMe';
import { latestFileUrl, NO_FIRMADAS_COL, FIRMADAS_COL, SOLICITUDES_COL } from './DocumentacionTab';
import { VersionChips } from './cotizacion/VersionChips';
import { SnapshotTable } from './cotizacion/SnapshotTable';
import { TotalsRow } from './cotizacion/TotalsRow';
import { CotizacionPdfRow } from './cotizacion/CotizacionPdfRow';
import { CondicionesCotizacion } from './cotizacion/CondicionesCotizacion';
import { MobileQuoteRow } from './cotizacion/MobileQuoteRow';
import { QuoteRow } from './cotizacion/QuoteRow';
import { ColumnVisibilityPicker } from './cotizacion/ColumnVisibilityPicker';
import {
  type RowEditState, EMPTY_ROW, inlineEditableCols,
  GRID_COLS_COSTEO, GRID_COLS_VENTA, colsTemplate, displayProducto,
  loadHiddenCols, saveHiddenCols, gridWrapStyle,
  PRODUCTO_COL, PRODUCTO_TXT_COL, PRODUCTO_REL_COL, COLOR_COL,
  EMB_STATUS_COL, EMB_LABEL_CON, EMB_LABEL_SIN,
  PRODUCTO_CONFIRM_COL, linkedProductoId, MONEY_COLS,
} from './cotizacion/gridMeta';
import type { ProductoChoice } from '../../../components/forms/ProductPicker';

export function CotizacionTab({
  subCols, oppCols = [], products, variant = 'venta', onSaved, versions = [], onNuevaVersion, onRestoreVersion, editable = true, stage, oppId, item,
  readOnly = false, precioOnly = false, draft = false, showCondiciones = false,
}: {
  subCols: ColMeta[];
  /** ColMeta del board `oportunidades` — las condiciones de la cotización
   * (comerciales/entrega/vigencia) son del item, no de las líneas. */
  oppCols?: ColMeta[];
  products: ItemDTO[]; variant?: 'venta' | 'costeo'; onSaved?: () => void;
  versions?: QuoteVersionDTO[]; onNuevaVersion?: () => void;
  /** Al ver una versión superada, "Restaurar esta versión" — deja la cotización
   * igual a esa instantánea (la vigente se archiva y todo regresa a costeo). */
  onRestoreVersion?: (version: QuoteVersionDTO) => void;
  /** false en Ganada/Perdida — las líneas quedan de solo lectura, igual que el candado de versiones. */
  editable?: boolean;
  /** deal_stage de la oportunidad — determina qué campos vendedor puede editar inline. */
  stage?: string;
  /** true cuando la vigente es un borrador sin costear (recién duplicada con
   * "+ Nueva versión") — desbloquea las líneas inline igual que Nueva oportunidad. */
  draft?: boolean;
  /** ID de la oportunidad — necesario para crear líneas en Nueva oportunidad. */
  oppId?: string;
  /** Trae las columnas de archivo de cotización (sin firmar/firmada) para las miniaturas de PDF. */
  item?: ItemDetailDTO;
  /** true en el board Costeo — solo lectura para producto/color/cantidad/embellecimiento
   * y "Agregar línea" (eso es trabajo de Ventas en Oportunidades); costos y Etapa
   * Costeo se mantienen editables. */
  readOnly?: boolean;
  /** true en el board Validación Costeo — lo ÚNICO editable en la grid es Precio
   * de Venta; costos, Etapa Costeo y todo lo demás quedan de solo lectura
   * (Efraín, 2026-07-16). Tiene prioridad sobre `readOnly`. */
  precioOnly?: boolean;
  /** true solo en el board Costeo para rol compras/admin — Compras llena las
   * condiciones comerciales/entrega/vigencia ahí; no aplica en Oportunidades
   * ni en el resto de los boards de pipeline (Efraín, 2026-07-30). */
  showCondiciones?: boolean;
}) {
  const isMobile = useIsMobile();
  const tabPadding = isMobile ? '14px 14px 24px' : '24px 32px 40px';
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const selectedVersion = selectedVersionId != null ? versions.find((v) => v.id === selectedVersionId) : undefined;
  const hasSolicitud = !!(item && latestFileUrl(item.cols[SOLICITUDES_COL]?.text));
  const hasSinFirmar = !!(item && latestFileUrl(item.cols[NO_FIRMADAS_COL]?.text));
  const hasFirmada = !!(item && latestFileUrl(item.cols[FIRMADAS_COL]?.text));

  const gridCols = variant === 'costeo' ? GRID_COLS_COSTEO : GRID_COLS_VENTA;
  // Sin costeo todavía no hay precios vigentes — ocultar Precio/Subtotal/IVA/Total
  // en Nueva oportunidad (o un borrador de versión sin costear) en vez de
  // enseñar columnas vacías o sin sentido (Efraín, 2026-07-20).
  const hideMoneyCols = variant === 'venta' && (stage === '4' || draft);
  // "Columnas" — solo en Costeo/Validación de Costeo (mismo GRID_COLS_COSTEO en
  // ambos boards): preferencia personal del viewer para mostrar/ocultar, la
  // columna Producto (primera) nunca se ofrece porque sostiene el ancho fijo
  // del grid template y los controles de línea (Efraín, 2026-07-21).
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => (variant === 'costeo' ? loadHiddenCols() : new Set()));
  const onToggleColumn = (id: string) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveHiddenCols(next);
      return next;
    });
  };
  // Memoizadas porque son props de QuoteRow/MobileQuoteRow, que están
  // memoizados: un array o Set nuevo por render rompería el memo de todas las
  // líneas aunque nada haya cambiado.
  const visibleCols = useMemo(() => gridCols.filter((gc) =>
    subCols.some((c) => c.id === gc.id) && !(hideMoneyCols && MONEY_COLS.has(gc.id))
    && (gc.id === gridCols[0].id || !hiddenCols.has(gc.id))), [gridCols, subCols, hideMoneyCols, hiddenCols]);
  const writableIds = useMemo(
    () => new Set(subCols.filter((c) => c.w).map((c) => c.id)),
    [subCols],
  );
  // Crear/editar líneas inline: Nueva oportunidad o un borrador de versión
  // (vigente sin costear), y nunca desde los boards de Costeo/Validación
  // (eso es trabajo de Ventas en Oportunidades).
  const lineEdits = (stage === '4' || draft) && !readOnly && !precioOnly;
  const editableCols = useMemo(
    () => (precioOnly ? new Set<string>([COL.precio]) : inlineEditableCols(lineEdits)),
    [precioOnly, lineEdits],
  );
  const canAddLines = lineEdits && editable;

  const [rows, setRows] = useState<Record<string, RowEditState>>({});
  const [creatingLine, setCreatingLine] = useState(false);
  const [catalog, setCatalog] = useState<ItemDTO[]>([]);
  // Distingue "todavía no llega el catálogo" de "este producto no tiene
  // colores configurados" — antes ambos casos se veían igual (input vacío
  // deshabilitado), y parecía que el selector de color estaba roto
  // (Efraín, 2026-07-20).
  const [catalogLoading, setCatalogLoading] = useState(true);
  const rowState = (id: string): RowEditState => rows[id] ?? EMPTY_ROW;
  // Mezcla siempre sobre `r` (el estado más fresco que entrega el updater de
  // React), nunca sobre `rowState(id)` (closure del render en que se llamó a
  // patchRow) — con dos writes concurrentes en la misma línea (p.ej. Cantidad
  // y Con/Sin Embellecimiento casi al mismo tiempo), el que tarde más en
  // resolver contra Monday pisaba con un snapshot viejo el campo que el otro
  // ya había actualizado mientras tanto, y parecía que cambiar Cantidad
  // "cambiaba" Embellecimiento solo (Efraín, 2026-07-21).
  const patchRow = (id: string, patch: Partial<RowEditState>) =>
    setRows((r) => ({ ...r, [id]: { ...(r[id] ?? EMPTY_ROW), ...patch } }));

  // Catálogo de Productos — necesario cuando el producto es editable inline
  // (Nueva oportunidad o borrador de versión: el ProductPicker busca sobre él
  // y de ahí sale el item_id real) Y en el board Costeo (chevron de detalle:
  // Descripción/Tallas/confirmación viven en el catálogo por SKU).
  useEffect(() => {
    if (canAddLines || variant === 'costeo') {
      listItems('productos')
        .then((c) => { setCatalog(c); setCatalogLoading(false); })
        .catch(() => setCatalogLoading(false));
    } else {
      setCatalogLoading(false);
    }
  }, [canAddLines, variant]);

  // Chevron de detalle por línea — Descripción/Tallas completas + (en Costeo)
  // el checkbox de Compras que bloquea "Mandar a Validación de costeo".
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const me = useMe();
  const canConfirm = me?.role === 'compras' || me?.role === 'admin';
  const [confirmSaving, setConfirmSaving] = useState<Record<string, boolean>>({});
  const [confirmError, setConfirmError] = useState<Record<string, string | undefined>>({});

  // Escribe boolean_mm5cqtjs en el producto del catálogo (no en la línea — la
  // ficha es del SKU, Efraín 2026-07-18) y refresca `catalog` en optimista
  // para que el checkbox no "rebote" hasta el próximo refetch. onSaved() hace
  // que el drawer vuelva a correr checkValidacion.
  const onToggleConfirm = async (productoId: number, next: boolean) => {
    const key = String(productoId);
    setConfirmSaving((s) => ({ ...s, [key]: true }));
    setConfirmError((e) => ({ ...e, [key]: undefined }));
    try {
      await patchItem('productos', key, { [PRODUCTO_CONFIRM_COL]: next ? 'true' : '' });
      setCatalog((cat) => cat.map((c) => (c.id === key
        ? { ...c, cols: { ...c.cols, [PRODUCTO_CONFIRM_COL]: { text: next ? 'v' : '', type: 'checkbox' } } }
        : c)));
      onSaved?.();
    } catch (e) {
      setConfirmError((er) => ({ ...er, [key]: e instanceof Error ? e.message : 'No se pudo guardar.' }));
    } finally {
      setConfirmSaving((s) => ({ ...s, [key]: false }));
    }
  };

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

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const onDeleteLine = async (productId: string) => {
    setDeletingId(productId);
    try {
      const res = await apiFetch(`/oportunidades_sub/${productId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('No se pudo eliminar la línea');
      onSaved?.();
    } catch (e) {
      console.error('Error eliminando línea:', e);
    } finally {
      setDeletingId(null);
    }
  };

  /** PATCH de `writes` a la línea marcando `marker` como saving; al éxito
   * limpia editing[marker] (si `clearEditing`), aplica el `preview` local
   * opcional (mirrors asíncronos de Monday) y notifica onSaved. Todos los
   * writes de la grid pasan por aquí — un solo manejo de error/saving. */
  const saveCols = async (
    productId: string,
    marker: string,
    writes: Record<string, string>,
    opts: { clearEditing?: boolean; alsoClear?: string[]; preview?: Record<string, ColVal> } = {},
  ) => {
    patchRow(productId, { saving: { ...rowState(productId).saving, [marker]: true }, error: undefined });
    try {
      await patchItem('oportunidades_sub', productId, writes);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'No se pudo guardar.';
      // Toma el estado fresco al momento en que React aplica el update, no el
      // snapshot de antes del `await` — si otro campo de la misma línea se
      // editó mientras esta escritura tardaba en resolver contra Monday, ese
      // cambio ya vive en `r` y no se debe pisar (ver nota en `patchRow`).
      setRows((r) => {
        const cur = r[productId] ?? EMPTY_ROW;
        const saving = { ...cur.saving };
        delete saving[marker];
        return { ...r, [productId]: { ...cur, saving, error: message } };
      });
      return;
    }
    setRows((r) => {
      const cur = r[productId] ?? EMPTY_ROW;
      const saving = { ...cur.saving };
      delete saving[marker];
      const next: RowEditState = { ...cur, saving, error: undefined };
      if (opts.clearEditing || opts.alsoClear) {
        const editing = { ...cur.editing };
        if (opts.clearEditing) delete editing[marker];
        for (const k of opts.alsoClear ?? []) delete editing[k];
        next.editing = editing;
      }
      if (opts.preview) next.preview = { ...cur.preview, ...opts.preview };
      return { ...r, [productId]: next };
    });
    onSaved?.();
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

  const onBlur = (product: ItemDTO, colId: string) => {
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
    void saveCols(product.id, colId, { [colId]: raw }, { clearEditing: true });
  };

  // Color es un <select> — se guarda al elegir (onChange), no al perder foco:
  // un <select> no tiene un "blur para confirmar" natural como un input de texto.
  const onColorChange = (product: ItemDTO, raw: string) => {
    const state = rowState(product.id);
    const current = product.cols[COLOR_COL]?.text ?? '';
    patchRow(product.id, { editing: { ...state.editing, [COLOR_COL]: raw } });
    if (raw === current) return;
    void saveCols(product.id, COLOR_COL, { [COLOR_COL]: raw });
  };

  // Con/Sin Embellecimiento — mismo status column y labels que
  // worker/lib/quoteVersions.ts. Marcarla "Con" es lo que hace que la línea
  // aparezca en EmbellecimientosTab (filtra por ese mismo label).
  const onEmbellecimientoChange = (product: ItemDTO, con: boolean) => {
    const label = con ? EMB_LABEL_CON : EMB_LABEL_SIN;
    void saveCols(product.id, EMB_STATUS_COL, { [EMB_STATUS_COL]: label }, {
      preview: { [EMB_STATUS_COL]: { text: label, type: 'status' } },
    });
  };

  // Dropdowns de status de la línea: Etapa Costeo (dónde va el costeo: No
  // iniciado/En curso/Listo/Detenido/Modificado) y Moneda (línea) (MXN/USD/
  // EUR/GBP — Efraín, 2026-07-30). Igual que Color, se guardan al elegir: un
  // <select> no tiene "blur para confirmar". El preview local evita el parpadeo
  // mientras el mirror de Monday alcanza.
  const onStatusChange = (product: ItemDTO, colId: string, label: string) => {
    if (!label) return;
    const current = product.cols[colId]?.text ?? '';
    if (label === current) return;
    void saveCols(product.id, colId, { [colId]: label }, {
      preview: { [colId]: { text: label, type: 'status' } },
    });
  };

  // Producto elegido en el picker (src/components/forms/ProductPicker.tsx —
  // busca por nombre, SKU o pedazos de ambos). Del catálogo se escribe la
  // relación real (board_relation_mkzmafgp) y Monday puebla los mirrors
  // (lookup_mm0x4kda, SKU, Descripción…) solo; el texto libre
  // (text_mm0bkm1j) queda para un producto que todavía no existe en el
  // catálogo — mismo criterio que worker/lib/createOportunidad.ts.
  //
  // Antes esto vivía en el blur de un <input list=datalist>: lo tecleado solo
  // ligaba si era IDÉNTICO al nombre completo del catálogo, así que teclear un
  // SKU se guardaba como texto libre y la línea quedaba sin SKU, sin
  // descripción y sin colores (Efraín, 2026-07-30). Ahora la elección es
  // explícita y el texto libre solo pasa si el usuario lo escoge.
  const onProductoPick = (product: ItemDTO, choice: ProductoChoice) => {
    const nombre = 'item' in choice ? choice.item.name : choice.freeText.trim();
    if (!nombre) return;
    if (nombre === displayProducto(product, rowState(product.id).preview)) return;
    // El mirror que se MUESTRA (lookup_mm0x4kda) lo puebla Monday de forma
    // asíncrona (el outbox manda el mutation en waitUntil, después de
    // responder). Sin este preview local, el refetch inmediato de onSaved()
    // todavía trae el mirror viejo/vacío y parece que no se guardó.
    //
    // También se limpia el color: la lista de colores disponibles depende del
    // producto, así que un color elegido para el producto anterior puede ya
    // no ser válido — sin esto se quedaba pegado y parecía "bloqueado"
    // (Efraín, 2026-07-20).
    void saveCols(
      product.id, PRODUCTO_COL,
      'item' in choice
        ? { [PRODUCTO_REL_COL]: choice.item.id, [COLOR_COL]: '' }
        : { [PRODUCTO_TXT_COL]: nombre, [COLOR_COL]: '' },
      {
        clearEditing: true,
        alsoClear: [COLOR_COL],
        preview: { [PRODUCTO_COL]: { text: nombre, type: 'text' }, [COLOR_COL]: { text: '', type: 'text' } },
      },
    );
  };

  // QuoteRow/MobileQuoteRow están memoizados, así que necesitan callbacks con
  // identidad estable — si se recrean cada render, el memo no memoiza nada.
  // En vez de reescribir los handlers de arriba con useCallback (sus cuerpos
  // leen `rows`/`catalog` del render y tienen la lógica fina de concurrencia
  // documentada en `patchRow`/`saveCols`), se deja un ref apuntando siempre a
  // la versión más fresca y se exponen wrappers que nunca cambian. El
  // comportamiento es idéntico al de antes: la fila ya recibía en cada render
  // el handler más nuevo, porque se re-renderizaba siempre.
  const latest = useRef({
    onEdit, onBlur, onColorChange,
    onEmbellecimientoChange, onStatusChange, onProductoPick,
    onToggleConfirm, onDeleteLine, toggleExpanded,
  });
  latest.current = {
    onEdit, onBlur, onColorChange,
    onEmbellecimientoChange, onStatusChange, onProductoPick,
    onToggleConfirm, onDeleteLine, toggleExpanded,
  };
  const sEdit = useCallback((pr: ItemDTO, c: string, r: string) => latest.current.onEdit(pr, c, r), []);
  const sBlur = useCallback((pr: ItemDTO, c: string) => latest.current.onBlur(pr, c), []);
  const sColorChange = useCallback((pr: ItemDTO, r: string) => latest.current.onColorChange(pr, r), []);
  const sEmbChange = useCallback((pr: ItemDTO, con: boolean) => latest.current.onEmbellecimientoChange(pr, con), []);
  const sStatusChange = useCallback((pr: ItemDTO, c: string, l: string) => latest.current.onStatusChange(pr, c, l), []);
  const sProductoPick = useCallback((pr: ItemDTO, ch: ProductoChoice) => latest.current.onProductoPick(pr, ch), []);
  const sToggleConfirm = useCallback((id: number, next: boolean) => latest.current.onToggleConfirm(id, next), []);
  const sDeleteLine = useCallback((id: string) => latest.current.onDeleteLine(id), []);
  const sToggleExpand = useCallback((id: string) => latest.current.toggleExpanded(id), []);

  if (selectedVersion) {
    return (
      <div style={{ padding: tabPadding, width: '100%', boxSizing: 'border-box' }}>
        <VersionChips versions={versions} selected={selectedVersionId} onSelect={setSelectedVersionId} />
        {onRestoreVersion && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <Button variant="secondary" onClick={() => onRestoreVersion(selectedVersion)}>
              Restaurar {selectedVersion.label}
            </Button>
            <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
              Regresa la cotización a como estaba en {selectedVersion.label}
            </span>
          </div>
        )}
        <CotizacionPdfRow oppId={oppId} hasSolicitud={hasSolicitud} hasSinFirmar={hasSinFirmar} hasFirmada={hasFirmada} />
        <SnapshotTable version={selectedVersion} />
      </div>
    );
  }

  // Fila-esqueleto visible de inmediato al hacer clic en "+ Agregar línea" —
  // la creación real sigue tardando ~1-3s (round-trip a Monday), pero mostrar
  // algo en el lugar de la nueva línea evita que el clic se sienta congelado
  // (Efraín, 2026-07-20: reportó ~15s de espera "en blanco").
  const addingLineRow = creatingLine ? (
    <div style={{
      borderTop: '1px solid var(--border-subtle)', padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 8, background: '#faf8f6',
    }}>
      <span style={{ color: 'var(--accent)' }}>⏳</span>
      <span style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>Agregando línea…</span>
    </div>
  ) : null;

  if (products.length === 0) {
    return (
      <div style={{ padding: tabPadding, width: '100%', boxSizing: 'border-box' }}>
        <VersionChips versions={versions} selected={selectedVersionId} onSelect={setSelectedVersionId} onNuevaVersion={onNuevaVersion} />
        <CotizacionPdfRow oppId={oppId} hasSolicitud={hasSolicitud} hasSinFirmar={hasSinFirmar} hasFirmada={hasFirmada} />
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)', marginBottom: 16 }}>
          Sin líneas de producto registradas.
        </div>
        {addingLineRow}
        {canAddLines && (
          <Button
            variant="primary"
            onClick={creatingLine ? undefined : onAddLine}
            style={{ opacity: creatingLine ? 0.6 : 1 }}
          >
            {creatingLine ? 'Agregando línea…' : '+ Agregar línea'}
          </Button>
        )}
        {showCondiciones && (
          <CondicionesCotizacion oppId={oppId} oppCols={oppCols} item={item} onSaved={onSaved} locked={!editable} />
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: tabPadding, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <VersionChips versions={versions} selected={selectedVersionId} onSelect={setSelectedVersionId} onNuevaVersion={onNuevaVersion} />
        {variant === 'costeo' && (
          <ColumnVisibilityPicker columns={gridCols.slice(1)} hidden={hiddenCols} onToggle={onToggleColumn} />
        )}
      </div>
      <CotizacionPdfRow oppId={oppId} hasSolicitud={hasSolicitud} hasSinFirmar={hasSinFirmar} hasFirmada={hasFirmada} />
      {isMobile ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
          {products.map((p, lineIdx) => (
            <MobileQuoteRow
              key={p.id}
              product={p}
              partida={lineIdx + 1}
              state={rowState(p.id)}
              visibleCols={visibleCols}
              variant={variant}
              precioOnly={precioOnly}
              editable={editable}
              editableCols={editableCols}
              writableIds={writableIds}
              catalog={catalog}
              catalogLoading={catalogLoading}
              onEdit={sEdit}
              onBlur={sBlur}
              onColorChange={sColorChange}
              onEmbellecimientoChange={sEmbChange}
              onStatusChange={sStatusChange}
              onProductoPick={sProductoPick}
              expanded={expanded.has(p.id)}
              onToggleExpand={sToggleExpand}
              canConfirm={canConfirm}
              confirmSaving={!!confirmSaving[String(linkedProductoId(p))]}
              confirmError={confirmError[String(linkedProductoId(p))]}
              onToggleConfirm={sToggleConfirm}
              canDelete={canAddLines}
              deleting={deletingId === p.id}
              onDeleteLine={sDeleteLine}
            />
          ))}
          {addingLineRow}
          <TotalsRow variant={variant} visibleCols={visibleCols} products={products} rows={rows} isMobile />
          {canAddLines && (
            <div style={{ padding: '16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <Button
                variant="secondary"
                onClick={creatingLine ? undefined : onAddLine}
                style={{ opacity: creatingLine ? 0.6 : 1 }}
              >
                {creatingLine ? 'Agregando línea…' : '+ Agregar línea'}
              </Button>
            </div>
          )}
        </div>
      ) : (
      <div style={{ ...gridWrapStyle, maxWidth: '100%', overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)' }}>
        <div>
          <div style={{
            ...gridWrapStyle,
            display: 'grid', gridTemplateColumns: `28px ${colsTemplate(visibleCols)}`,
            gap: 6, padding: '9px 10px', borderBottom: '1px solid var(--border)',
            font: '600 11px \'Inter\', sans-serif', color: 'var(--ink-tertiary)',
          }}>
            <div title="Partida" style={{ textAlign: 'center' }}>#</div>
            {visibleCols.map((c) => (
              <div key={c.id} style={{ textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</div>
            ))}
            <div style={{ textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Avisos</div>
          </div>
          {products.map((p, lineIdx) => (
            <QuoteRow
              key={p.id}
              product={p}
              partida={lineIdx + 1}
              state={rowState(p.id)}
              visibleCols={visibleCols}
              variant={variant}
              precioOnly={precioOnly}
              editable={editable}
              editableCols={editableCols}
              writableIds={writableIds}
              catalog={catalog}
              catalogLoading={catalogLoading}
              onEdit={sEdit}
              onBlur={sBlur}
              onColorChange={sColorChange}
              onEmbellecimientoChange={sEmbChange}
              onStatusChange={sStatusChange}
              onProductoPick={sProductoPick}
              expanded={expanded.has(p.id)}
              onToggleExpand={sToggleExpand}
              canConfirm={canConfirm}
              confirmSaving={!!confirmSaving[String(linkedProductoId(p))]}
              confirmError={confirmError[String(linkedProductoId(p))]}
              onToggleConfirm={sToggleConfirm}
              canDelete={canAddLines}
              deleting={deletingId === p.id}
              onDeleteLine={sDeleteLine}
            />
          ))}
          {addingLineRow}
          <TotalsRow variant={variant} visibleCols={visibleCols} products={products} rows={rows} />
        </div>
        {canAddLines && (
          <div style={{ padding: '16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
            <Button
              variant="secondary"
              onClick={creatingLine ? undefined : onAddLine}
              style={{ opacity: creatingLine ? 0.6 : 1 }}
            >
              {creatingLine ? 'Agregando línea…' : '+ Agregar línea'}
            </Button>
          </div>
        )}
      </div>
      )}
      {showCondiciones && (
        <CondicionesCotizacion oppId={oppId} oppCols={oppCols} item={item} onSaved={onSaved} locked={!editable} />
      )}
    </div>
  );
}
