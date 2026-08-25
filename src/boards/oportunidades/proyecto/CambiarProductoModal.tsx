// "Cambiar producto" de la tabla de Órdenes de compra — falta de inventario:
// Compras surte OTRO producto con OTRO proveedor y las tallas ya capturadas
// SIGUEN SIENDO CORRECTAS (Efraín, 2026-08-25).
//
// Por qué es un modal a nivel GRUPO y no la celda inline que ya existe: el
// producto vive repetido en cada renglón de talla (8 tallas = 8 celdas), y
// teclearlo 8 veces parte el grupo producto+color en dos en cuanto haya un
// typo — de ahí cuelgan las tarjetas del tab Tallas, la ficha de la OC con
// imágenes y el SKU con el que se resuelve la foto. Aquí se elige UN producto
// del catálogo y el worker lo escribe idéntico en las N líneas, con su SKU.
//
// La celda inline de Producto/Color no se va: sigue siendo el camino para
// corregir cómo se LEE el texto en el PDF. Esto es para cambiar de producto.
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Modal } from '../../../components/core/Modal';
import { Button } from '../../../components/core/Button';
import { SearchInput } from '../../../components/forms/SearchInput';
import { ProductPicker } from '../../../components/forms/ProductPicker';
import { MonoTag } from '../../../components/core/Badges';
import {
  cambiarProductoLineas, getCatalogoProductos, usePoll, SOLO_NOMBRE,
  type ItemDTO,
} from '../../../lib/api';
import { PRODUCTO_SKU_COL } from '../../../lib/productSearch';
import { fmtMoney } from '../../../lib/format';

// Productos (18395657591) — ya viajan en el catálogo de la cotización
// (CATALOGO_COLS en src/lib/productSearch.ts), no hay que pedirlas aparte.
const PRODUCTO_PROVEEDOR_COL = 'board_relation_mm1cwqky';
const PRODUCTO_COSTO_COL = 'numeric_mkzpx7eb';

/** Proveedor asignado al producto en el catálogo — el default obvio al cambiar
 * de producto, porque es el que de verdad lo surte. */
function proveedorDelCatalogo(p: ItemDTO): { id: string; nombre: string } | null {
  const val = p.cols[PRODUCTO_PROVEEDOR_COL]?.value as { linked_item_ids?: unknown[] } | undefined;
  const id = (val?.linked_item_ids ?? []).map(String).find(s => s && s !== 'undefined');
  if (!id) return null;
  return { id, nombre: p.cols[PRODUCTO_PROVEEDOR_COL]?.text?.trim() || `Proveedor ${id}` };
}

type ModoProveedor = 'catalogo' | 'conservar' | 'otro' | 'ninguno';

interface Props {
  proyectoId: string;
  /** Lo que la línea trae HOY: con esto el worker resuelve el grupo (no manda ids). */
  productoActual: string;
  colorActual: string;
  proveedorActual: string;
  /** Talla y id de la línea desde la que se abrió — para el modo "solo esta". */
  lineaId: string;
  talla: string;
  /** Cuántas líneas (tallas) comparte el grupo producto+color. */
  lineasEnGrupo: number;
  onClose: () => void;
  onDone: () => void;
}

export function CambiarProductoModal({
  proyectoId, productoActual, colorActual, proveedorActual, lineaId, talla, lineasEnGrupo, onClose, onDone,
}: Props) {
  const [catalogo, setCatalogo] = useState<ItemDTO[]>([]);
  const [catalogoLoading, setCatalogoLoading] = useState(true);
  const [nuevo, setNuevo] = useState<ItemDTO | null>(null);
  const [todasLasTallas, setTodasLasTallas] = useState(true);
  const [modoProveedor, setModoProveedor] = useState<ModoProveedor>('catalogo');
  const [otroProveedor, setOtroProveedor] = useState<ItemDTO | null>(null);
  const [q, setQ] = useState('');
  const { data: proveedores } = usePoll('proveedores', q, SOLO_NOMBRE);
  const [costo, setCosto] = useState('');
  const [moneda, setMoneda] = useState('');
  const [descuento, setDescuento] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[] | null>(null);

  useEffect(() => {
    let vivo = true;
    getCatalogoProductos()
      .then(items => { if (vivo) setCatalogo(items); })
      .catch(() => { /* el picker se queda vacío y el modal lo dice */ })
      .finally(() => { if (vivo) setCatalogoLoading(false); });
    return () => { vivo = false; };
  }, []);

  const delCatalogo = useMemo(() => (nuevo ? proveedorDelCatalogo(nuevo) : null), [nuevo]);
  const skuNuevo = nuevo?.cols[PRODUCTO_SKU_COL]?.text?.trim() ?? '';
  const costoCatalogo = Number((nuevo?.cols[PRODUCTO_COSTO_COL]?.text ?? '').replace(/,/g, ''));

  // Sin proveedor en el catálogo, "el del catálogo" no es una opción real:
  // cae a conservar el que ya trae la línea (que es lo menos destructivo).
  useEffect(() => {
    if (nuevo && !delCatalogo && modoProveedor === 'catalogo') setModoProveedor('conservar');
  }, [nuevo, delCatalogo, modoProveedor]);

  const lineasAfectadas = todasLasTallas ? lineasEnGrupo : 1;

  const proveedorIdDelBody = (): string | undefined => {
    if (modoProveedor === 'conservar') return undefined;
    if (modoProveedor === 'ninguno') return '';
    if (modoProveedor === 'otro') return otroProveedor?.id;
    return delCatalogo?.id;
  };

  const submit = async (confirmado: boolean) => {
    if (!nuevo) { setError('Elige el producto nuevo del catálogo.'); return; }
    if (modoProveedor === 'otro' && !otroProveedor) { setError('Elige el proveedor o cambia la opción.'); return; }
    setSaving(true);
    setError(null);
    const res = await cambiarProductoLineas(proyectoId, {
      productoActual,
      colorActual,
      soloLineaId: todasLasTallas ? undefined : Number(lineaId),
      productoId: Number(nuevo.id),
      proveedorId: proveedorIdDelBody(),
      costo: costo.trim() ? Number(costo) : undefined,
      descuento: descuento.trim() ? Number(descuento) : undefined,
      moneda: moneda.trim() || undefined,
      confirmado,
    });
    setSaving(false);
    if (res.requiereConfirmacion) { setAvisos(res.avisos ?? []); return; }
    if (!res.ok) { setError(res.error ?? 'No se pudo cambiar el producto.'); return; }
    onDone();
    onClose();
  };

  return (
    <Modal
      title="Cambiar el producto de la orden"
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={saving ? undefined : onClose}>Cancelar</Button>
          <Button
            variant="primary"
            onClick={saving || !nuevo ? undefined : () => submit(avisos !== null)}
            style={saving || !nuevo ? { opacity: .6 } : undefined}
          >
            {saving ? 'Cambiando…'
              : avisos !== null ? 'Cambiar de todos modos'
              : `Cambiar ${lineasAfectadas} ${lineasAfectadas === 1 ? 'línea' : 'líneas'}`}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
          Para cuando no hay inventario y se surte otro producto. <b>Las tallas y cantidades no se tocan</b> —
          solo cambia qué producto son. La cotización de la oportunidad se queda con el producto original.
        </div>

        <Campo label="Producto actual">
          <div style={{ font: 'var(--text-label)', color: 'var(--ink)' }}>
            {productoActual}{colorActual ? ` · ${colorActual}` : ''}
            <span style={{ color: 'var(--ink-quiet)' }}>{proveedorActual ? ` · ${proveedorActual}` : ''}</span>
          </div>
        </Campo>

        <Campo label="Alcance">
          <Radio
            checked={todasLasTallas}
            onChange={() => setTodasLasTallas(true)}
            label={`Todas las tallas de este producto y color (${lineasEnGrupo})`}
          />
          <Radio
            checked={!todasLasTallas}
            onChange={() => setTodasLasTallas(false)}
            label={`Solo esta línea${talla ? ` (talla ${talla})` : ''}`}
          />
        </Campo>

        <Campo label="Producto nuevo *">
          <ProductPicker
            value={nuevo?.name ?? ''}
            catalog={catalogo}
            catalogLoading={catalogoLoading}
            allowFreeText={false}
            placeholder="Buscar por nombre o SKU…"
            onPick={(choice) => { if ('item' in choice) { setNuevo(choice.item); setModoProveedor('catalogo'); } }}
          />
          {nuevo && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {skuNuevo ? <MonoTag>{skuNuevo}</MonoTag> : (
                <span style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>
                  Este producto no tiene SKU en el catálogo — la ficha de la OC saldrá sin foto.
                </span>
              )}
              {Number.isFinite(costoCatalogo) && costoCatalogo > 0 && (
                <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
                  Costo distribuidor del catálogo: {fmtMoney(costoCatalogo)}
                </span>
              )}
            </div>
          )}
        </Campo>

        <Campo label="Proveedor">
          <Radio
            checked={modoProveedor === 'catalogo'}
            onChange={() => setModoProveedor('catalogo')}
            disabled={!delCatalogo}
            label={delCatalogo
              ? `El del catálogo: ${delCatalogo.nombre}`
              : 'El del catálogo (este producto no tiene proveedor asignado)'}
          />
          <Radio
            checked={modoProveedor === 'conservar'}
            onChange={() => setModoProveedor('conservar')}
            label={`Conservar el actual${proveedorActual ? `: ${proveedorActual}` : ''}`}
          />
          <Radio checked={modoProveedor === 'otro'} onChange={() => setModoProveedor('otro')} label="Otro proveedor…" />
          <Radio checked={modoProveedor === 'ninguno'} onChange={() => setModoProveedor('ninguno')} label="Sin proveedor (la saca de toda OC)" />
          {modoProveedor === 'otro' && (
            otroProveedor ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6,
                border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '8px 12px',
              }}>
                <span style={{ font: 'var(--text-label)', color: 'var(--ink)' }}>{otroProveedor.name}</span>
                <span onClick={() => setOtroProveedor(null)} style={{ cursor: 'pointer', color: 'var(--accent)', font: 'var(--text-caption)' }}>Cambiar</span>
              </div>
            ) : (
              <div style={{ marginTop: 6 }}>
                <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor…" style={{ maxWidth: 'none' }} />
                <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginTop: 6 }}>
                  {(proveedores?.items ?? []).length === 0 ? (
                    <div style={{ padding: 10, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin resultados.</div>
                  ) : (proveedores?.items ?? []).map(p => (
                    <div
                      key={p.id}
                      className="row-hover"
                      onClick={() => setOtroProveedor(p)}
                      style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', font: 'var(--text-label)', color: 'var(--ink)', cursor: 'pointer' }}
                    >
                      {p.name}
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </Campo>

        {/* Cambiar de proveedor casi siempre cambia el costo negociado; en
            blanco se conserva el que traía la línea (lo que se cotizó con el
            producto anterior, que probablemente ya no aplica). */}
        <Campo label="Costeo de la OC (en blanco = se queda el que ya tenía)">
          <div style={{ display: 'flex', gap: 10 }}>
            <input value={costo} onChange={(e) => setCosto(e.target.value)} type="number" placeholder="Costo Distr. C/U" style={inputStyle} />
            <input value={moneda} onChange={(e) => setMoneda(e.target.value)} placeholder="Moneda" style={inputStyle} />
            <input value={descuento} onChange={(e) => setDescuento(e.target.value)} type="number" placeholder="Descuento %" style={inputStyle} />
          </div>
        </Campo>

        {avisos && avisos.length > 0 && (
          <div style={{
            border: '1px solid var(--status-perdida)', borderRadius: 'var(--radius-lg)',
            padding: '10px 12px', font: 'var(--text-label)', color: 'var(--ink)',
          }}>
            <div style={{ font: 'var(--text-label-strong)', color: 'var(--status-perdida)', marginBottom: 6 }}>Antes de cambiar</div>
            {avisos.map((a, i) => <div key={i} style={{ marginBottom: 4 }}>{a}</div>)}
          </div>
        )}
        {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
      </div>
    </Modal>
  );
}

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function Radio({ checked, onChange, label, disabled }: {
  checked: boolean; onChange: () => void; label: string; disabled?: boolean;
}) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0',
      font: 'var(--text-label)', color: disabled ? 'var(--ink-quiet)' : 'var(--ink)',
      cursor: disabled ? 'default' : 'pointer',
    }}>
      <input type="radio" checked={checked} disabled={disabled} onChange={disabled ? undefined : onChange} />
      {label}
    </label>
  );
}

const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', font: 'var(--text-label)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '8px 10px',
};
