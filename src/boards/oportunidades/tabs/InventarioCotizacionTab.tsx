import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ItemDTO } from '../../../lib/apiClient';
import { getCatalogoProductos, getInventarioCotizacion, saveInventarioCotizacion, type InventarioCotizacionProductoDTO } from '../../../lib/apiClient';
import { Button } from '../../../components/core/Button';
import { catalogIndex, displayProducto, linkedProductoId, PRODUCTO_REL_COL } from './cotizacion/gridMeta';

const MARCA_COL = 'product_and_service_description';

// "5.11" por MARCA del catálogo ("5.11 Tactical"), ignorando puntos y espacios.
export function es511(producto: ItemDTO) {
  const marca = producto.cols[MARCA_COL]?.text ?? '';
  return marca.replace(/[^a-z0-9]/gi, '').toLowerCase().includes('511');
}

// Resolver la línea de cotización a su producto de catálogo va por el MISMO
// camino que la grid (gridMeta): la relación es `{linked_item_ids:[...]}` —
// `linkedPulseIds` es de la API vieja de Monday y aquí nunca llega, así que
// leerlo dejaba TODA la cotización sin productos 5.11 (Efraín, 2026-09-21).
// El fallback por nombre usa el texto de la relación primero: el mirror trae el
// nombre corto ("Fast-Tac TDU Pant") y el catálogo lo guarda con SKU al frente
// ("74462 - Fast-Tac TDU Pant"), así que comparar contra el mirror no casa.
export function productForQuoteLine(line: ItemDTO, catalogo: ItemDTO[]): ItemDTO | undefined {
  const idx = catalogIndex(catalogo);
  const id = linkedProductoId(line);
  if (id != null) {
    const porId = idx.byId.get(id);
    if (porId) return porId;
  }
  const nombres = [line.cols[PRODUCTO_REL_COL]?.text, displayProducto(line)];
  for (const nombre of nombres) {
    const clave = (nombre ?? '').trim().toLowerCase();
    const match = clave ? idx.byName.get(clave) : undefined;
    if (match) return match;
  }
  return undefined;
}

type ProductRow = InventarioCotizacionProductoDTO & { fromQuote: boolean };

export function InventarioCotizacionTab({ oppId, quoteLines, readOnly = false }: { oppId: string; quoteLines: ItemDTO[]; readOnly?: boolean }) {
  const [catalogo, setCatalogo] = useState<ItemDTO[]>([]);
  const [saved, setSaved] = useState<InventarioCotizacionProductoDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState('');
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getCatalogoProductos(), getInventarioCotizacion(oppId)])
      .then(([products, entries]) => { if (!cancelled) { setCatalogo(products); setSaved(entries); } })
      .catch(() => { if (!cancelled) setError('No se pudo cargar el inventario de esta cotización.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [oppId]);

  const rows = useMemo<ProductRow[]>(() => {
    const byId = new Map(saved.map((p) => [p.productoId, p]));
    const automaticos = quoteLines
      .map((line) => productForQuoteLine(line, catalogo))
      .filter((p): p is ItemDTO => !!p && es511(p));
    const idsInQuote = new Set(automaticos.map((p) => p.id));
    const output: ProductRow[] = [];
    for (const p of automaticos) {
      if (output.some((row) => row.productoId === p.id)) continue;
      output.push({ productoId: p.id, productoNombre: p.name, comentarios: '', agregadoManualmente: false, ...byId.get(p.id), fromQuote: true });
    }
    for (const p of saved) {
      if (!idsInQuote.has(p.productoId)) output.push({ ...p, fromQuote: false });
    }
    return output.sort((a, b) => a.productoNombre.localeCompare(b.productoNombre));
  }, [catalogo, quoteLines, saved]);

  const disponibles = useMemo(() => catalogo.filter((p) => es511(p) && !rows.some((r) => r.productoId === p.id)), [catalogo, rows]);
  const replace = (next: InventarioCotizacionProductoDTO) => setSaved((prev) => [...prev.filter((p) => p.productoId !== next.productoId), next]);

  const persist = async (row: ProductRow, files?: { mexico?: File; usa?: File }) => {
    if (readOnly) return;
    setSaving((p) => ({ ...p, [row.productoId]: true }));
    setError(undefined);
    const result = await saveInventarioCotizacion(oppId, row, files);
    setSaving((p) => ({ ...p, [row.productoId]: false }));
    if (!result.ok || !result.producto) { setError(result.error ?? 'No se pudo guardar el producto.'); return; }
    replace(result.producto);
  };

  const onFile = (row: ProductRow, place: 'mexico' | 'usa', event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void persist(row, { [place]: file });
  };

  const addProduct = () => {
    const product = disponibles.find((p) => p.id === adding);
    if (!product) return;
    void persist({ productoId: product.id, productoNombre: product.name, comentarios: '', agregadoManualmente: true, fromQuote: false });
    setAdding('');
  };

  return (
    <div style={{ padding: '24px 32px 40px', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)', marginBottom: 4 }}>Inventario 5.11</div>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>Los productos 5.11 de la cotización aparecen aquí automáticamente. Agrega fotos de inventario en México y USA, más comentarios por producto.</div>
      </div>
      {!readOnly && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'end', padding: 14, border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', background: 'var(--bg-raised)', marginBottom: 18 }}>
          <label style={{ flex: 1, minWidth: 0 }}>
            <span style={labelStyle}>Agregar producto 5.11</span>
            <select value={adding} onChange={(e) => setAdding(e.target.value)} style={inputStyle}>
              <option value="">Selecciona un producto…</option>
              {disponibles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <Button variant={!adding ? 'disabled' : 'secondary'} onClick={addProduct}>Agregar</Button>
        </div>
      )}
      {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)', marginBottom: 12 }}>{error}</div>}
      {loading ? <div style={{ color: 'var(--ink-tertiary)', font: 'var(--text-label)' }}>Cargando inventario…</div> : rows.length === 0 ? (
        <div style={{ padding: 24, border: '1px dashed var(--border)', borderRadius: 'var(--radius-xl)', color: 'var(--ink-tertiary)', font: 'var(--text-label)' }}>Esta cotización todavía no tiene productos 5.11. Puedes agregar uno del catálogo.</div>
      ) : <div style={{ display: 'grid', gap: 14 }}>{rows.map((row) => (
        <ProductCard key={row.productoId} row={row} disabled={readOnly || !!saving[row.productoId]} onFile={onFile} onComments={(comentarios) => void persist({ ...row, comentarios })} />
      ))}</div>}
    </div>
  );
}

// Las fotos son capturas anchas de tablas de tallas: van una debajo de otra a
// todo el ancho y a altura natural (antes se recortaban a 122 px con `cover`).
// Clic en la foto = verla en grande; cambiarla va por su botón aparte.
function ProductCard({ row, disabled, onFile, onComments }: { row: ProductRow; disabled: boolean; onFile: (row: ProductRow, place: 'mexico' | 'usa', event: ChangeEvent<HTMLInputElement>) => void; onComments: (comments: string) => void }) {
  const [zoom, setZoom] = useState<{ url: string; title: string }>();
  const photo = (title: string, url: string | undefined, place: 'mexico' | 'usa') => {
    const input = <input aria-label={title} type="file" accept="image/*" disabled={disabled} onChange={(e) => onFile(row, place, e)} style={{ display: 'none' }} />;
    return (
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={labelStyle}>{title}</div>
          {url && !disabled && <label style={{ font: 'var(--text-label)', color: 'var(--accent)', cursor: 'pointer', marginBottom: 6 }}>Cambiar imagen{input}</label>}
        </div>
        {url ? (
          <button type="button" onClick={() => setZoom({ url, title })} title="Ver en grande" style={{ display: 'block', width: '100%', padding: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--bg)', cursor: 'zoom-in' }}>
            <img src={url} alt={title} style={{ display: 'block', width: '100%', height: 'auto' }} />
          </button>
        ) : (
          <label style={{ display: 'flex', minHeight: 122, border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)', cursor: disabled ? 'default' : 'pointer', background: 'var(--bg)' }}>
            <span style={{ margin: 'auto', color: 'var(--ink-tertiary)', font: 'var(--text-label)' }}>{disabled ? 'Sin imagen' : 'Subir imagen'}</span>
            {input}
          </label>
        )}
      </div>
    );
  };
  return <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 16, background: 'var(--bg-raised)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}><div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{row.productoNombre}</div>{row.fromQuote && <span style={{ font: 'var(--text-eyebrow)', color: 'var(--accent)', background: 'var(--status-ganada-tint)', borderRadius: 999, padding: '3px 7px' }}>En cotización</span>}</div>
    <div style={{ display: 'grid', gap: 16 }}>{photo('Inventario MEX', row.imagenMexicoUrl, 'mexico')}{photo('Inventario USA', row.imagenUsaUrl, 'usa')}</div>
    <label style={{ display: 'block', marginTop: 14 }}><span style={labelStyle}>Comentarios</span><textarea defaultValue={row.comentarios} disabled={disabled} onBlur={(e) => { if (e.target.value !== row.comentarios) onComments(e.target.value); }} rows={3} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Agrega comentarios de disponibilidad, tallas o tiempos…" /></label>
    {zoom && <ImageZoom url={zoom.url} title={zoom.title} onClose={() => setZoom(undefined)} />}
  </div>;
}

function ImageZoom({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div role="dialog" aria-label={title} onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.85)', display: 'flex', flexDirection: 'column', padding: 16, boxSizing: 'border-box', cursor: 'zoom-out' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff', font: 'var(--text-body-strong)', marginBottom: 10 }}>
        <span>{title}</span>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: '#fff', font: 'var(--text-label)' }}>Abrir original</a>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ background: 'none', border: 0, color: '#fff', fontSize: 26, lineHeight: 1, cursor: 'pointer' }}>×</button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex' }}>
        <img src={url} alt={title} onClick={(e) => e.stopPropagation()} style={{ margin: 'auto', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', cursor: 'default' }} />
      </div>
    </div>,
    document.body,
  );
}

const labelStyle: React.CSSProperties = { display: 'block', font: 'var(--text-eyebrow)', color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '.45px', marginBottom: 6 };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg)', color: 'var(--ink)', padding: '8px 10px', font: 'var(--text-label)' };
