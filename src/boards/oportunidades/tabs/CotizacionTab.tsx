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
import { useEffect, useState } from 'react';
import type { ColMeta, ColVal, ItemDetailDTO, ItemDTO, QuoteVersionDTO } from '../../../lib/api';
import { patchItem, apiFetch, listItems } from '../../../lib/apiClient';
import { fmtMoney } from '../../../lib/format';
import { MonoTag, StatusBadge } from '../../../components/core/Badges';
import { Button } from '../../../components/core/Button';
import { previewRow, COL } from '../../../lib/costeoCalc';
import { useIsMobile } from '../../../lib/useIsMobile';
import { useMe } from '../../../lib/useMe';
import { latestFileUrl, NO_FIRMADAS_COL, FIRMADAS_COL, SOLICITUDES_COL } from './DocumentacionTab';
import { VersionChips } from './cotizacion/VersionChips';
import { SnapshotTable } from './cotizacion/SnapshotTable';
import { TotalsRow } from './cotizacion/TotalsRow';
import { CotizacionPdfRow } from './cotizacion/CotizacionPdfRow';
import { MobileQuoteRow } from './cotizacion/MobileQuoteRow';
import { LineDetailPanel } from './cotizacion/LineDetailPanel';
import { ColumnVisibilityPicker } from './cotizacion/ColumnVisibilityPicker';
import {
  type RowEditState, EMPTY_ROW, numFrom, marginColor, suggestedPrecio23, inlineEditableCols,
  ETAPA_COSTEO_COLORS, GRID_COLS_COSTEO, GRID_COLS_VENTA, colsTemplate, displayProducto, cellValue,
  inputStyle, valueChipStyle, getLineWarnings, loadHiddenCols, saveHiddenCols, gridWrapStyle,
  ETAPA_COSTEO_COL, SUGERIDO_COL, MARGEN_COL,
  PRODUCTO_COL, PRODUCTO_TXT_COL, PRODUCTO_REL_COL, COLOR_COL, COLORES_DISP_COL,
  PRODUCTO_COLOR_DROPDOWN_COL, EMB_STATUS_COL, EMB_LABEL_CON, EMB_LABEL_SIN,
  PRODUCTO_CONFIRM_COL, linkedProductoId, chevronButtonStyle, MONEY_COLS,
} from './cotizacion/gridMeta';

export function CotizacionTab({
  subCols, products, variant = 'venta', onSaved, versions = [], onNuevaVersion, onRestoreVersion, editable = true, stage, oppId, item,
  readOnly = false, precioOnly = false, draft = false,
}: {
  subCols: ColMeta[]; products: ItemDTO[]; variant?: 'venta' | 'costeo'; onSaved?: () => void;
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
  const visibleCols = gridCols.filter((gc) =>
    subCols.some((c) => c.id === gc.id) && !(hideMoneyCols && MONEY_COLS.has(gc.id))
    && (gc.id === gridCols[0].id || !hiddenCols.has(gc.id)));
  const writableIds = new Set(subCols.filter((c) => c.w).map((c) => c.id));
  // Crear/editar líneas inline: Nueva oportunidad o un borrador de versión
  // (vigente sin costear), y nunca desde los boards de Costeo/Validación
  // (eso es trabajo de Ventas en Oportunidades).
  const lineEdits = (stage === '4' || draft) && !readOnly && !precioOnly;
  const editableCols = precioOnly ? new Set<string>([COL.precio]) : inlineEditableCols(lineEdits);
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
  // (Nueva oportunidad o borrador de versión: datalist + resolver el nombre
  // tecleado a un item_id real) Y en el board Costeo (chevron de detalle:
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

  // Chevron + botón de eliminar — se renderizaban solo en la celda de
  // Producto de solo-lectura, pero en Nueva oportunidad (justo donde
  // canAddLines es true) Producto siempre se muestra como <input> editable,
  // así que este bloque nunca llegaba a pintarse ahí — el botón de eliminar
  // quedaba invisible en el único caso donde hace falta (Efraín, 2026-07-20).
  // Se extrae para poder mostrarlo también junto al input editable.
  const lineControls = (p: ItemDTO) => (
    <div style={{ display: 'inline-flex', gap: 4, marginRight: 4 }}>
      <button
        type="button"
        onClick={() => toggleExpanded(p.id)}
        title={expanded.has(p.id) ? 'Ocultar detalle' : 'Ver descripción y tallas'}
        style={chevronButtonStyle(expanded.has(p.id))}
      >
        ▸
      </button>
      {canAddLines && (
        <button
          type="button"
          onClick={() => onDeleteLine(p.id)}
          disabled={deletingId === p.id}
          title="Eliminar línea"
          style={{
            background: 'none',
            border: 'none',
            cursor: deletingId === p.id ? 'wait' : 'pointer',
            font: 'inherit',
            padding: 0,
            color: 'var(--status-perdida)',
            opacity: deletingId === p.id ? 0.6 : 1,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );

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

  // Producto/Color son texto libre, no numérico — sin preview de fórmulas.
  const onTextEdit = (product: ItemDTO, colId: string, raw: string) => {
    const state = rowState(product.id);
    patchRow(product.id, { editing: { ...state.editing, [colId]: raw }, error: undefined });
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

  // Etapa Costeo — dropdown que compras usa para marcar dónde va el costeo de
  // esta línea (No iniciado/En curso/Listo/Detenido/Modificado).
  const onEtapaCosteoChange = (product: ItemDTO, label: string) => {
    if (!label) return;
    const current = product.cols[ETAPA_COSTEO_COL]?.text ?? '';
    if (label === current) return;
    void saveCols(product.id, ETAPA_COSTEO_COL, { [ETAPA_COSTEO_COL]: label }, {
      preview: { [ETAPA_COSTEO_COL]: { text: label, type: 'status' } },
    });
  };

  // Al elegir un producto del catálogo escribe la relación real
  // (board_relation_mkzmafgp) — Monday puebla el mirror (lookup_mm0x4kda,
  // SKU, Marca…) solo. Sin match en catálogo, cae a texto libre
  // (text_mm0bkm1j) — mismo criterio que worker/lib/createOportunidad.ts.
  const onProductoBlur = (product: ItemDTO) => {
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
    // El write real va a board_relation_mkzmafgp o text_mm0bkm1j — el mirror
    // que se MUESTRA (lookup_mm0x4kda) lo puebla Monday de forma asíncrona
    // (el outbox manda el mutation en waitUntil, después de responder). Sin
    // este preview local, el refetch inmediato de onSaved() todavía trae el
    // mirror viejo/vacío y parece que la edición no se guardó.
    //
    // También se limpia el color: la lista de colores disponibles depende del
    // producto, así que un color elegido para el producto anterior puede ya
    // no ser válido — sin esto se quedaba pegado y parecía "bloqueado"
    // (Efraín, 2026-07-20).
    void saveCols(
      product.id, PRODUCTO_COL,
      match ? { [PRODUCTO_REL_COL]: match.id, [COLOR_COL]: '' } : { [PRODUCTO_TXT_COL]: raw, [COLOR_COL]: '' },
      {
        clearEditing: true,
        alsoClear: [COLOR_COL],
        preview: { [PRODUCTO_COL]: { text: match ? match.name : raw, type: 'text' }, [COLOR_COL]: { text: '', type: 'text' } },
      },
    );
  };

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
      <datalist id="productos-catalogo-cotizacion">
        {catalog.map((p) => <option key={p.id} value={p.name} />)}
      </datalist>
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
              onEdit={onEdit}
              onBlur={onBlur}
              onTextEdit={onTextEdit}
              onColorChange={onColorChange}
              onEmbellecimientoChange={onEmbellecimientoChange}
              onEtapaCosteoChange={onEtapaCosteoChange}
              onProductoBlur={onProductoBlur}
              expanded={expanded.has(p.id)}
              onToggleExpand={() => toggleExpanded(p.id)}
              canConfirm={canConfirm}
              confirmSaving={!!confirmSaving[String(linkedProductoId(p))]}
              confirmError={confirmError[String(linkedProductoId(p))]}
              onToggleConfirm={onToggleConfirm}
              canDelete={canAddLines}
              deleting={deletingId === p.id}
              onDeleteLine={onDeleteLine}
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
          {products.map((p, lineIdx) => {
            const state = rowState(p.id);
            const lineWarnings = getLineWarnings(p, state, variant, catalog, precioOnly);
            return (
              <div key={p.id} style={{ ...gridWrapStyle, background: lineWarnings.length > 0 ? '#fdf1f2' : '#fff' }}>
                <div style={{
                  ...gridWrapStyle,
                  display: 'grid', gridTemplateColumns: `28px ${colsTemplate(visibleCols)}`,
                  gap: 6, alignItems: 'center', padding: '8px 10px',
                }}>
                  <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', fontWeight: 700 }}>{lineIdx + 1}</div>
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
                        <div key={c.id} style={{ textAlign: c.align, display: 'flex', alignItems: 'center' }}>
                          {lineControls(p)}
                          <input
                            list="productos-catalogo-cotizacion"
                            value={raw}
                            disabled={!!state.saving[PRODUCTO_COL]}
                            onChange={(e) => onTextEdit(p, PRODUCTO_COL, e.target.value)}
                            onBlur={() => onProductoBlur(p)}
                            placeholder="Elegir producto…"
                            style={{ ...inputStyle, textAlign: 'left', flex: 1, minWidth: 0 }}
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
                      const productoElegido = productoNombre.trim() !== '';
                      // Match por relación real (board_relation_mkzmafgp), no por nombre: el
                      // mirror que se MUESTRA (lookup_mm0x4kda) puede llegar abreviado
                      // ("Camisa Zero" vs "1104 - Camisa Zero" del catálogo) y entonces el
                      // match por texto fallaba en silencio — se veía "Sin colores
                      // configurados" en una línea ya costeada con color guardado
                      // correctamente (Efraín, stress test 2026-07-21). Solo cae a texto
                      // libre cuando el producto no está ligado a catálogo (linea sin match).
                      const linkedId = linkedProductoId(p);
                      const productoMatch = linkedId != null
                        ? catalog.find((c2) => Number(c2.id) === linkedId)
                        : catalog.find((c2) => c2.name.trim().toLowerCase() === productoNombre.trim().toLowerCase());
                      const catalogColores = (productoMatch?.cols[PRODUCTO_COLOR_DROPDOWN_COL]?.text ?? '')
                        .split(',').map((s) => s.trim()).filter(Boolean);
                      const mirrorColores = (p.cols[COLORES_DISP_COL]?.text ?? '')
                        .split(',').map((s) => s.trim()).filter(Boolean);
                      const disponibles = catalogColores.length > 0 ? catalogColores : mirrorColores;

                      // Sin lista de colores para este producto (no configurada en el
                      // catálogo) — se deja en blanco, deshabilitado. Nada de texto libre:
                      // el vendedor no debe "inventar" un color que el catálogo no define
                      // (Efraín, 2026-07-16). Mientras el catálogo todavía no llega
                      // (catalogLoading), se distingue de "sin colores configurados" —
                      // antes se veían idénticos y parecía que el selector estaba roto.
                      if (disponibles.length === 0) {
                        return (
                          <div key={c.id} style={{ textAlign: c.align }}>
                            <input
                              value=""
                              disabled
                              placeholder={catalogLoading ? 'Cargando colores…' : (productoElegido ? 'Sin colores configurados' : 'Elige un producto primero')}
                              style={{ ...inputStyle, textAlign: 'left' }}
                            />
                          </div>
                        );
                      }
                      return (
                        <div key={c.id} style={{ textAlign: c.align }}>
                          <select
                            value={raw}
                            disabled={!!state.saving[COLOR_COL]}
                            onChange={(e) => onColorChange(p, e.target.value)}
                            style={{ ...inputStyle, textAlign: 'left' }}
                          >
                            <option value="">Elegir color…</option>
                            {disponibles.map((d) => <option key={d} value={d}>{d}</option>)}
                            {/* si el color guardado ya no está en la lista (cambiaron de producto), no lo escondas en silencio */}
                            {raw && !disponibles.includes(raw) && <option value={raw}>{raw}</option>}
                          </select>
                        </div>
                      );
                    }
                    if (writable && c.id === COL.cantidad) {
                      const raw = state.editing[c.id] ?? (p.cols[c.id]?.text ?? '');
                      return (
                        <div key={c.id} style={{ textAlign: c.align }}>
                          <input
                            type="number"
                            className="cmp-grid-num-input"
                            value={raw}
                            disabled={!!state.saving[c.id]}
                            onChange={(e) => onEdit(p, c.id, e.target.value)}
                            onBlur={() => onBlur(p, c.id)}
                            style={inputStyle}
                          />
                        </div>
                      );
                    }
                    if (writable && c.id === EMB_STATUS_COL) {
                      const label = state.preview[EMB_STATUS_COL]?.text ?? p.cols[EMB_STATUS_COL]?.text ?? '';
                      const checked = label === EMB_LABEL_CON;
                      return (
                        <div key={c.id} style={{ textAlign: c.align }}>
                          <select
                            value={checked ? EMB_LABEL_CON : EMB_LABEL_SIN}
                            disabled={!!state.saving[EMB_STATUS_COL]}
                            onChange={(e) => onEmbellecimientoChange(p, e.target.value === EMB_LABEL_CON)}
                            style={{ ...inputStyle, textAlign: 'left' }}
                          >
                            <option value={EMB_LABEL_SIN}>{EMB_LABEL_SIN}</option>
                            <option value={EMB_LABEL_CON}>{EMB_LABEL_CON}</option>
                          </select>
                        </div>
                      );
                    }
                    if (writable && c.id === ETAPA_COSTEO_COL) {
                      const raw = state.preview[ETAPA_COSTEO_COL]?.text ?? p.cols[ETAPA_COSTEO_COL]?.text ?? '';
                      return (
                        <div key={c.id} style={{ textAlign: c.align }}>
                          <select
                            value={raw}
                            disabled={!!state.saving[ETAPA_COSTEO_COL]}
                            onChange={(e) => onEtapaCosteoChange(p, e.target.value)}
                            style={{ ...inputStyle, textAlign: 'left' }}
                          >
                            <option value="">Elegir etapa…</option>
                            {Object.keys(ETAPA_COSTEO_COLORS).map((k) => <option key={k} value={k}>{k}</option>)}
                          </select>
                        </div>
                      );
                    }
                    if (writable) {
                      const raw = state.editing[c.id] ?? (p.cols[c.id]?.text ?? '');
                      return (
                        <div key={c.id} style={{ textAlign: c.align }}>
                          <input
                            type="number"
                            className="cmp-grid-num-input"
                            value={raw}
                            disabled={!!state.saving[c.id]}
                            onChange={(e) => onEdit(p, c.id, e.target.value)}
                            onBlur={() => onBlur(p, c.id)}
                            style={inputStyle}
                          />
                        </div>
                      );
                    }
                    // Chip gris (misma pill que los inputs editables) en toda celda de
                    // solo lectura salvo Producto (idx 0), SKU y las columnas de status
                    // (ya son su propio badge/chip) — imita la referencia de diseño
                    // simple que pidió Efraín (2026-07-20): valores "flotando" en una
                    // pastilla gris en vez de texto plano contra bordes de fila.
                    const isChip = idx > 0 && c.id !== 'lookup_mkzn7x9a'
                      && c.id !== ETAPA_COSTEO_COL && c.id !== EMB_STATUS_COL;
                    return (
                      <div key={c.id} style={{
                        textAlign: c.align,
                        font: idx === 0 ? 'var(--text-body-strong)' : 'var(--text-label)',
                        color: idx === 0 ? 'var(--ink)' : 'var(--ink-secondary)',
                        ...(idx === 0 ? { display: 'flex', alignItems: 'center', minWidth: 0 } : undefined),
                        ...(isChip ? valueChipStyle : undefined),
                      }}>
                        {idx === 0 && lineControls(p)}
                        {idx === 0 && p.pendingWrite && <span title="guardado, sincronizando…" style={{ marginRight: 6, color: 'var(--accent)', flex: 'none' }}>⏳</span>}
                        {c.id === PRODUCTO_COL && (
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                            {displayProducto(p, state.preview) || '—'}
                          </span>
                        )}
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
                              label={con ? EMB_LABEL_CON : EMB_LABEL_SIN}
                              color={con ? '#00b461' : '#68737d'}
                              tint={con ? '#d6f5e6' : '#e6e9eb'}
                            />
                          );
                        })()}
                        {c.id === MARGEN_COL && (() => {
                          const label = cellValue(c, displayVal);
                          if (label === '—') return '—';
                          const n = Number(displayVal?.value ?? displayVal?.text);
                          return <span style={{ color: Number.isFinite(n) ? marginColor(n) : undefined, fontWeight: 600 }}>{label}</span>;
                        })()}
                        {c.id === SUGERIDO_COL && (() => {
                          const label = cellValue(c, displayVal);
                          if (label !== '—') return label;
                          const costoTotalUnit = numFrom(state, p, COL.costoTotalUnit);
                          const margenGobPctVal = Number(state.editing[COL.margenGobPct] ?? p.cols[COL.margenGobPct]?.text ?? 0) || 0;
                          const suggested = suggestedPrecio23(costoTotalUnit, margenGobPctVal);
                          if (suggested === undefined) return '—';
                          return (
                            <span style={{ fontStyle: 'italic', color: 'var(--ink-tertiary)' }} title="Calculado para 23% de margen — sin precio auto de Monday">
                              {fmtMoney(suggested)}
                            </span>
                          );
                        })()}
                        {c.id !== PRODUCTO_COL && c.id !== 'lookup_mkzn7x9a' && c.id !== ETAPA_COSTEO_COL && c.id !== EMB_STATUS_COL
                          && c.id !== MARGEN_COL && c.id !== SUGERIDO_COL && cellValue(c, displayVal)}
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    {lineWarnings.length > 0 && (
                      <StatusBadge label={`⚠ ${lineWarnings.join(' • ')}`} color="#ce3048" tint="#fbdbdf" />
                    )}
                  </div>
                </div>
                {state.error && (
                  <div style={{ padding: '0 14px 8px', font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>
                    {state.error}
                  </div>
                )}
                {expanded.has(p.id) && (
                  <LineDetailPanel
                    product={p}
                    catalog={catalog}
                    variant={variant}
                    canConfirm={canConfirm}
                    saving={!!confirmSaving[String(linkedProductoId(p))]}
                    error={confirmError[String(linkedProductoId(p))]}
                    onToggleConfirm={onToggleConfirm}
                  />
                )}
              </div>
            );
          })}
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
    </div>
  );
}
