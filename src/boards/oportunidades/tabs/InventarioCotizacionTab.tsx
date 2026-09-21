import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ItemDTO } from '../../../lib/apiClient';
import { getCatalogoProductos, getInventarioCotizacion, saveInventarioCotizacion, type InventarioCotizacionProductoDTO } from '../../../lib/apiClient';
import { Button } from '../../../components/core/Button';

const MARCA_COL = 'product_and_service_description';
const PRODUCTO_REL_COL = 'board_relation_mkzmafgp';
const PRODUCTO_MIRROR_COL = 'lookup_mm0x4kda';
const PRODUCTO_TEXT_COL = 'text_mm0bkm1j';

function es511(producto: ItemDTO) {
  const marca = producto.cols[MARCA_COL]?.text ?? '';
  return marca.replace(/[^a-z0-9]/gi, '').toLowerCase().includes('511');
}

function relationId(value: unknown): string | undefined {
  if (value && typeof value === 'object') {
    const id = (value as { linkedPulseIds?: Array<{ linkedPulseId?: number | string }> }).linkedPulseIds?.[0]?.linkedPulseId;
    return id == null ? undefined : String(id);
  }
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value) as { linkedPulseIds?: Array<{ linkedPulseId?: number | string }> };
    const id = parsed.linkedPulseIds?.[0]?.linkedPulseId;
    return id == null ? undefined : String(id);
  } catch { return undefined; }
}

function productForQuoteLine(line: ItemDTO, catalogo: ItemDTO[]): ItemDTO | undefined {
  const id = relationId(line.cols[PRODUCTO_REL_COL]?.value);
  if (id) return catalogo.find((p) => p.id === id);
  const name = (line.cols[PRODUCTO_MIRROR_COL]?.text || line.cols[PRODUCTO_TEXT_COL]?.text || '').trim().toLowerCase();
  return name ? catalogo.find((p) => p.name.trim().toLowerCase() === name) : undefined;
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
    <div style={{ padding: '24px 32px 40px', maxWidth: 1060, width: '100%', boxSizing: 'border-box' }}>
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

function ProductCard({ row, disabled, onFile, onComments }: { row: ProductRow; disabled: boolean; onFile: (row: ProductRow, place: 'mexico' | 'usa', event: ChangeEvent<HTMLInputElement>) => void; onComments: (comments: string) => void }) {
  const photo = (title: string, url: string | undefined, place: 'mexico' | 'usa') => (
    <div style={{ minWidth: 0 }}>
      <div style={labelStyle}>{title}</div>
      <label style={{ display: 'flex', minHeight: 122, border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', cursor: disabled ? 'default' : 'pointer', background: 'var(--bg)' }}>
        {url ? <img src={url} alt={title} style={{ width: '100%', height: 122, objectFit: 'cover' }} /> : <span style={{ margin: 'auto', color: 'var(--ink-tertiary)', font: 'var(--text-label)' }}>{disabled ? 'Sin imagen' : 'Subir imagen'}</span>}
        <input aria-label={title} type="file" accept="image/*" disabled={disabled} onChange={(e) => onFile(row, place, e)} style={{ display: 'none' }} />
      </label>
    </div>
  );
  return <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 16, background: 'var(--bg-raised)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}><div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{row.productoNombre}</div>{row.fromQuote && <span style={{ font: 'var(--text-eyebrow)', color: 'var(--accent)', background: 'var(--status-ganada-tint)', borderRadius: 999, padding: '3px 7px' }}>En cotización</span>}</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>{photo('Inventario MEX', row.imagenMexicoUrl, 'mexico')}{photo('Inventario USA', row.imagenUsaUrl, 'usa')}</div>
    <label style={{ display: 'block', marginTop: 14 }}><span style={labelStyle}>Comentarios</span><textarea defaultValue={row.comentarios} disabled={disabled} onBlur={(e) => { if (e.target.value !== row.comentarios) onComments(e.target.value); }} rows={3} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Agrega comentarios de disponibilidad, tallas o tiempos…" /></label>
  </div>;
}

const labelStyle: React.CSSProperties = { display: 'block', font: 'var(--text-eyebrow)', color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '.45px', marginBottom: 6 };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg)', color: 'var(--ink)', padding: '8px 10px', font: 'var(--text-label)' };
