// Panel expandible (chevron) con la ficha completa de la línea — Descripción y
// Tallas, que la grid/tarjeta colapsada no muestra. En el board Costeo agrega el
// checkbox de Compras "Descripción y tallas confirmadas": vive en el catálogo de
// Productos por SKU, no por línea (Efraín 2026-07-18 — la ficha es del producto,
// no de la cotización), y bloquea "Mandar a Validación de costeo" mientras falte
// (worker/lib/costeo.ts checkValidacion). Compartido por CotizacionTab (desktop)
// y MobileQuoteRow.
//
// En Costeo/Validación (variant='costeo', ambas comparten variant — ver
// OpportunityDrawer COSTEO_VARIANT_BOARDS) también muestra el embellecimiento
// de la línea (solo lectura: status + zonas + imágenes de referencia), para
// no forzar a Compras/Ventas a saltar a la tab Embellecimientos solo para
// verlo (Efraín, 2026-07-20). Sin edición ni validación aquí — eso sigue
// viviendo en EmbellecimientosTab.
import { useEffect, useState } from 'react';
import type { ItemDTO } from '../../../../lib/api';
import { getZoneImages, getItem, usePoll, SOLO_NOMBRE } from '../../../../lib/api';
import { StatusBadge } from '../../../../components/core/Badges';
import { SearchInput } from '../../../../components/forms/SearchInput';
import { EMB_STATUS_COL, EMB_LABEL_CON, explodeEmbellecimiento } from '../../../../lib/embellecimiento';
import {
  DESCRIPCION_COL, TALLAS_COL, PRODUCTO_CONFIRM_COL, PRODUCTO_PROVEEDOR_COL,
  CATALOGO_DESCRIPCION_COL, CATALOGO_TALLAS_COL, HISTORIAL_PRECIOS_COL,
  linkedProductoId, catalogIndex,
} from './gridMeta';

const EMB_DESC_COL = 'long_text_mm1bj4pt';

const fieldLabel: React.CSSProperties = {
  font: '700 9px \'Inter\', sans-serif', color: 'var(--ink-tertiary)',
  textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 4,
};

function EmbellecimientoDetail({ product }: { product: ItemDTO }) {
  const con = product.cols[EMB_STATUS_COL]?.text === EMB_LABEL_CON;
  const zones = con ? explodeEmbellecimiento(product.cols[EMB_DESC_COL]?.text, true) : [];
  const [images, setImages] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!con) return;
    let cancelled = false;
    getZoneImages(product.id).then((imgs) => { if (!cancelled) setImages(imgs); }).catch(() => {});
    return () => { cancelled = true; };
  }, [product.id, con]);

  return (
    <div>
      <div style={fieldLabel}>Embellecimiento</div>
      <div style={{ marginBottom: zones.length > 0 ? 8 : 0 }}>
        <StatusBadge
          label={con ? EMB_LABEL_CON : 'Sin Embellecimiento'}
          color={con ? '#00b461' : '#68737d'}
          tint={con ? '#d6f5e6' : '#e6e9eb'}
        />
      </div>
      {zones.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {zones.map((z) => (
            <div key={z.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', flex: 1 }}>
                <span style={{ color: 'var(--ink)' }}>{z.label}:</span> {z.value}
              </div>
              {images[z.label] && (
                <img
                  src={images[z.label]}
                  alt={z.label}
                  style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', flex: 'none' }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Buscador + lista para asignar Proveedor al producto de catálogo — mismo
 * patrón que AgregarLineaModal.tsx (proyectos), pero editando sobre el
 * catálogo (board_relation_mm1cwqky), no sobre una línea nueva del Proyecto.
 * Bloquea "Mandar a Validación de costeo" mientras falte (Efraín, 2026-08-04). */
function ProveedorField({
  productoId, current, saving, error, onEditProveedor,
}: {
  productoId: number;
  current: string;
  saving: boolean;
  error?: string;
  onEditProveedor: (productoId: number, proveedorId: string, proveedorNombre: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const { data } = usePoll('proveedores', picking ? q : '', SOLO_NOMBRE);
  const opciones = picking ? (data?.items ?? []) : [];

  if (!picking) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ font: 'var(--text-label)', color: current ? 'var(--ink)' : 'var(--status-perdida)' }}>
          {current || 'Sin proveedor asignado'}
        </span>
        <span
          onClick={() => setPicking(true)}
          style={{
            cursor: 'pointer', color: 'var(--accent)', font: 'var(--text-caption-strong, var(--text-caption))',
            textDecoration: 'underline',
          }}
        >
          {current ? 'Cambiar' : 'Asignar'}
        </span>
      </div>
    );
  }

  return (
    <div>
      <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor…" style={{ maxWidth: 'none' }} />
      <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginTop: 6 }}>
        {opciones.length === 0 ? (
          <div style={{ padding: 10, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin resultados.</div>
        ) : opciones.map((p) => (
          <div
            key={p.id}
            className="row-hover"
            onClick={() => { onEditProveedor(productoId, p.id, p.name); setPicking(false); setQ(''); }}
            style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', font: 'var(--text-label)', color: 'var(--ink)', cursor: 'pointer' }}
          >
            {p.name}
          </div>
        ))}
      </div>
      <span onClick={() => { setPicking(false); setQ(''); }} style={{ cursor: 'pointer', color: 'var(--ink-tertiary)', font: 'var(--text-caption)' }}>
        Cancelar
      </span>
      {saving && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)', marginLeft: 8 }}>guardando…</span>}
      {error && <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)', marginTop: 2 }}>{error}</div>}
    </div>
  );
}

export function LineDetailPanel({
  product, catalog, variant, canConfirm, saving, error, onToggleConfirm,
  tallasSaving, tallasError, onEditTallas,
  generoMF, generoSaving, onToggleGenero,
  proveedorSaving, proveedorError, onEditProveedor,
}: {
  product: ItemDTO;
  catalog: ItemDTO[];
  variant: 'venta' | 'costeo';
  canConfirm: boolean;
  saving: boolean;
  error?: string;
  onToggleConfirm: (productoId: number, next: boolean) => void;
  tallasSaving: boolean;
  tallasError?: string;
  onEditTallas: (productoId: number, next: string) => void;
  generoMF: boolean;
  generoSaving: boolean;
  onToggleGenero: (productoId: number, next: boolean) => void;
  proveedorSaving: boolean;
  proveedorError?: string;
  onEditProveedor: (productoId: number, proveedorId: string, proveedorNombre: string) => void;
}) {
  const productoId = linkedProductoId(product);
  const catalogItem = productoId != null ? catalogIndex(catalog).byId.get(productoId) : undefined;

  // La descripción sale del mirror de la línea. Si todavía no se pobló (Monday
  // lo recalcula asíncrono tras ligar el producto) se cae al catálogo — pero esa
  // columna YA NO viaja en el catálogo: es un long_text que pesaba 115 KB de los
  // 188 del catálogo entero, o sea el 61%, y sólo servía para este panel, sólo
  // para la línea que alguien expande, y sólo mientras el mirror está vacío.
  // Traerla para los 1247 productos en cada apertura era desproporcionado, así
  // que se pide la de ESE producto, sólo cuando de verdad hace falta.
  const descripcionMirror = product.cols[DESCRIPCION_COL]?.text || '';
  const [descripcionCatalogo, setDescripcionCatalogo] = useState('');
  useEffect(() => {
    if (descripcionMirror || productoId == null) return;
    let cancelado = false;
    getItem('productos', String(productoId))
      .then((p) => { if (!cancelado) setDescripcionCatalogo(p.cols[CATALOGO_DESCRIPCION_COL]?.text ?? ''); })
      .catch(() => { /* sin descripción es el mismo estado que antes de que llegue el mirror */ });
    return () => { cancelado = true; };
  }, [descripcionMirror, productoId]);
  const descripcion = descripcionMirror || descripcionCatalogo;
  const tallas = product.cols[TALLAS_COL]?.text || catalogItem?.cols[CATALOGO_TALLAS_COL]?.text || '';
  const confirmed = !!catalogItem?.cols[PRODUCTO_CONFIRM_COL]?.text;
  // Tallas se edita sobre el catálogo (mismo lugar que se guarda), no sobre el
  // mirror de la línea — mismo patrón que PRODUCTO_CONFIRM_COL de abajo.
  const canEditTallas = variant === 'costeo' && canConfirm && productoId != null;
  const [tallasEdit, setTallasEdit] = useState<string | null>(null);
  const tallasInputValue = tallasEdit ?? catalogItem?.cols[CATALOGO_TALLAS_COL]?.text ?? '';

  return (
    <div style={{
      padding: '12px 16px', background: 'var(--bg-sunken)', borderTop: '1px solid var(--border-subtle)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div>
        <div style={fieldLabel}>Descripción</div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', whiteSpace: 'pre-wrap' }}>
          {descripcion || '—'}
        </div>
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <div style={fieldLabel}>Tallas</div>
          {tallasSaving && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-faint)' }}>guardando…</span>}
        </div>
        {canEditTallas && productoId != null ? (
          <>
            <input
              value={tallasInputValue}
              placeholder="S, M, XL o unitalla"
              onChange={(e) => setTallasEdit(e.target.value)}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next !== (catalogItem?.cols[CATALOGO_TALLAS_COL]?.text ?? '').trim()) onEditTallas(productoId, next);
              }}
              style={{
                width: '100%', font: 'var(--text-label)', color: 'var(--ink)',
                border: '1px solid var(--accent)', borderRadius: 'var(--radius-md)',
                padding: '6px 8px', boxSizing: 'border-box', background: '#fff',
              }}
            />
            {tallasError && (
              <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)', marginTop: 2 }}>{tallasError}</div>
            )}
          </>
        ) : (
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', whiteSpace: 'pre-wrap' }}>
            {tallas || '—'}
          </div>
        )}
        {canEditTallas && productoId != null && (
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6,
            cursor: generoSaving ? 'default' : 'pointer',
          }}>
            <input
              type="checkbox"
              checked={generoMF}
              disabled={generoSaving}
              onChange={(e) => onToggleGenero(productoId, e.target.checked)}
            />
            <span style={{ font: 'var(--text-caption)', color: 'var(--ink-secondary)' }}>
              Género M/F {generoSaving && '(guardando…)'}
            </span>
          </label>
        )}
      </div>
      {variant === 'costeo' && productoId != null && (
        <div>
          <div style={fieldLabel}>Proveedor</div>
          {canConfirm ? (
            <ProveedorField
              productoId={productoId}
              current={catalogItem?.cols[PRODUCTO_PROVEEDOR_COL]?.text ?? ''}
              saving={proveedorSaving}
              error={proveedorError}
              onEditProveedor={onEditProveedor}
            />
          ) : (
            <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>
              {catalogItem?.cols[PRODUCTO_PROVEEDOR_COL]?.text || '—'}
            </div>
          )}
        </div>
      )}
      {variant === 'costeo' && (
        <div>
          <div style={fieldLabel}>Historial de Precios</div>
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', whiteSpace: 'pre-wrap' }}>
            {product.cols[HISTORIAL_PRECIOS_COL]?.text || '—'}
          </div>
        </div>
      )}
      {variant === 'costeo' && <EmbellecimientoDetail product={product} />}
      {variant === 'costeo' && (
        productoId == null ? (
          <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>
            Sin producto de catálogo vinculado — no se puede confirmar.
          </div>
        ) : (
          <div>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              cursor: canConfirm && !saving ? 'pointer' : 'default',
            }}>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={!canConfirm || saving}
                onChange={(e) => onToggleConfirm(productoId, e.target.checked)}
              />
              <span style={{
                font: 'var(--text-label-strong)',
                color: confirmed ? 'var(--status-ganada)' : 'var(--ink-secondary)',
              }}>
                Descripción y tallas confirmadas
              </span>
            </label>
            {!canConfirm && (
              <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 2 }}>
                Solo Compras puede confirmar.
              </div>
            )}
            {error && <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)', marginTop: 2 }}>{error}</div>}
          </div>
        )
      )}
    </div>
  );
}
