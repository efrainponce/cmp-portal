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
import { latestFileUrl, NO_FIRMADAS_COL, FIRMADAS_COL } from './DocumentacionTab';
import { VersionChips } from './cotizacion/VersionChips';
import { SnapshotTable } from './cotizacion/SnapshotTable';
import { TotalsRow } from './cotizacion/TotalsRow';
import { CotizacionPdfRow } from './cotizacion/CotizacionPdfRow';
import {
  type RowEditState, EMPTY_ROW, numFrom, marginColor, suggestedPrecio23, inlineEditableCols,
  ETAPA_COSTEO_COLORS, GRID_COLS_COSTEO, GRID_COLS_VENTA, displayProducto, cellValue,
  inputStyle, RowWarning,
  COSTO_DISTR_COL, ETAPA_COSTEO_COL, SUGERIDO_COL, MARGEN_COL,
  PRODUCTO_COL, PRODUCTO_TXT_COL, PRODUCTO_REL_COL, COLOR_COL, COLORES_DISP_COL,
  PRODUCTO_COLOR_DROPDOWN_COL, EMB_STATUS_COL, EMB_LABEL_CON, EMB_LABEL_SIN,
} from './cotizacion/gridMeta';

export function CotizacionTab({
  subCols, products, variant = 'venta', onSaved, versions = [], onNuevaVersion, editable = true, stage, oppId, item,
  readOnly = false, precioOnly = false, draft = false,
}: {
  subCols: ColMeta[]; products: ItemDTO[]; variant?: 'venta' | 'costeo'; onSaved?: () => void;
  versions?: QuoteVersionDTO[]; onNuevaVersion?: () => void;
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
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const selectedVersion = selectedVersionId != null ? versions.find((v) => v.id === selectedVersionId) : undefined;
  const hasSinFirmar = !!(item && latestFileUrl(item.cols[NO_FIRMADAS_COL]?.text));
  const hasFirmada = !!(item && latestFileUrl(item.cols[FIRMADAS_COL]?.text));

  const gridCols = variant === 'costeo' ? GRID_COLS_COSTEO : GRID_COLS_VENTA;
  const visibleCols = gridCols.filter((gc) => subCols.some((c) => c.id === gc.id));
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
  const rowState = (id: string): RowEditState => rows[id] ?? EMPTY_ROW;
  const patchRow = (id: string, patch: Partial<RowEditState>) =>
    setRows((r) => ({ ...r, [id]: { ...rowState(id), ...patch } }));

  // Catálogo de Productos — solo se necesita cuando el producto es editable
  // inline (Nueva oportunidad o borrador de versión), para el datalist y para
  // resolver el nombre tecleado a un item_id real (board_relation_mkzmafgp).
  useEffect(() => {
    if (canAddLines) listItems('productos').then(setCatalog).catch(() => {});
  }, [canAddLines]);

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

  /** PATCH de `writes` a la línea marcando `marker` como saving; al éxito
   * limpia editing[marker] (si `clearEditing`), aplica el `preview` local
   * opcional (mirrors asíncronos de Monday) y notifica onSaved. Todos los
   * writes de la grid pasan por aquí — un solo manejo de error/saving. */
  const saveCols = async (
    productId: string,
    marker: string,
    writes: Record<string, string>,
    opts: { clearEditing?: boolean; preview?: Record<string, ColVal> } = {},
  ) => {
    patchRow(productId, { saving: { ...rowState(productId).saving, [marker]: true }, error: undefined });
    try {
      await patchItem('oportunidades_sub', productId, writes);
    } catch (e) {
      const after = rowState(productId);
      const saving = { ...after.saving };
      delete saving[marker];
      patchRow(productId, { saving, error: e instanceof Error ? e.message : 'No se pudo guardar.' });
      return;
    }
    const after = rowState(productId);
    const saving = { ...after.saving };
    delete saving[marker];
    const patch: Partial<RowEditState> = { saving };
    if (opts.clearEditing) {
      const editing = { ...after.editing };
      delete editing[marker];
      patch.editing = editing;
    }
    if (opts.preview) patch.preview = { ...after.preview, ...opts.preview };
    patchRow(productId, patch);
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
    void saveCols(
      product.id, PRODUCTO_COL,
      match ? { [PRODUCTO_REL_COL]: match.id } : { [PRODUCTO_TXT_COL]: raw },
      { clearEditing: true, preview: { [PRODUCTO_COL]: { text: match ? match.name : raw, type: 'text' } } },
    );
  };

  if (selectedVersion) {
    return (
      <div style={{ padding: '24px 32px 40px', width: '100%', boxSizing: 'border-box' }}>
        <VersionChips versions={versions} selected={selectedVersionId} onSelect={setSelectedVersionId} />
        <CotizacionPdfRow oppId={oppId} hasSinFirmar={hasSinFirmar} hasFirmada={hasFirmada} />
        <SnapshotTable version={selectedVersion} />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div style={{ padding: '24px 32px 40px', width: '100%', boxSizing: 'border-box' }}>
        <VersionChips versions={versions} selected={selectedVersionId} onSelect={setSelectedVersionId} onNuevaVersion={onNuevaVersion} />
        <CotizacionPdfRow oppId={oppId} hasSinFirmar={hasSinFirmar} hasFirmada={hasFirmada} />
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)', marginBottom: 16 }}>
          Sin líneas de producto registradas.
        </div>
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
    <div style={{ padding: '24px 32px 40px', width: '100%', boxSizing: 'border-box' }}>
      <VersionChips versions={versions} selected={selectedVersionId} onSelect={setSelectedVersionId} onNuevaVersion={onNuevaVersion} />
      <CotizacionPdfRow oppId={oppId} hasSinFirmar={hasSinFirmar} hasFirmada={hasFirmada} />
      <datalist id="productos-catalogo-cotizacion">
        {catalog.map((p) => <option key={p.id} value={p.name} />)}
      </datalist>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)' }}>
        <div style={variant === 'costeo' ? { minWidth: 1360 } : undefined}>
          <div style={{
            display: 'grid', gridTemplateColumns: `1.8fr ${visibleCols.slice(1).map(() => '1fr').join(' ')}`,
            gap: 14, padding: '10px 16px', background: 'var(--bg-sunken)', font: '700 9.5px \'Inter\', sans-serif',
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
                  display: 'grid', gridTemplateColumns: `1.8fr ${visibleCols.slice(1).map(() => '1fr').join(' ')}`,
                  gap: 14, alignItems: 'center', padding: '12px 16px',
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
                      const productoElegido = productoNombre.trim() !== '';
                      const productoMatch = catalog.find(
                        (c2) => c2.name.trim().toLowerCase() === productoNombre.trim().toLowerCase(),
                      );
                      const catalogColores = (productoMatch?.cols[PRODUCTO_COLOR_DROPDOWN_COL]?.text ?? '')
                        .split(',').map((s) => s.trim()).filter(Boolean);
                      const mirrorColores = (p.cols[COLORES_DISP_COL]?.text ?? '')
                        .split(',').map((s) => s.trim()).filter(Boolean);
                      const disponibles = catalogColores.length > 0 ? catalogColores : mirrorColores;

                      // Sin lista de colores para este producto (no configurada en el
                      // catálogo) — se deja en blanco, deshabilitado. Nada de texto libre:
                      // el vendedor no debe "inventar" un color que el catálogo no define
                      // (Efraín, 2026-07-16).
                      if (disponibles.length === 0) {
                        return (
                          <div key={c.id} style={{ textAlign: c.align }}>
                            <input
                              value=""
                              disabled
                              placeholder={productoElegido ? 'Sin colores configurados' : 'Elige un producto primero'}
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
                              {checked ? EMB_LABEL_CON : EMB_LABEL_SIN}
                            </span>
                          </label>
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
                </div>
                {state.error && (
                  <div style={{ padding: '0 14px 8px', font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>
                    {state.error}
                  </div>
                )}
              </div>
            );
          })}
          <TotalsRow variant={variant} visibleCols={visibleCols} products={products} rows={rows} />
        </div>
      </div>
    </div>
  );
}
