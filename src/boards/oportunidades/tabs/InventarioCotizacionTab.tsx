import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ItemDTO } from '../../../lib/apiClient';
import { getCatalogoProductos, getInventarioCotizacion, inventarioCotizacionPdf, saveInventarioCotizacion, type InventarioCotizacionProductoDTO } from '../../../lib/apiClient';
import { downloadBlob } from '../../../lib/estadoCuentaApi';
import { useIsMobile } from '../../../lib/useIsMobile';
import { Button } from '../../../components/core/Button';
import { toast } from '../../../components/core/Toaster';
import { catalogIndex, COLOR_COL, displayProducto, linkedProductoId, PRODUCTO_REL_COL } from './cotizacion/gridMeta';
import { ProductPicker } from '../../../components/forms/ProductPicker';
import { colorInventario } from '../../../../shared/inventarioCotizacion';

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

type ProductRow = InventarioCotizacionProductoDTO & {
  fromQuote: boolean;
  /** Color del renglón de D1 que la tarjeta muestra; undefined = nada capturado.
   * '' en una tarjeta con color = heredó la captura de antes del color. */
  colorGuardado?: string;
};

const claveInv = (productoId: string, color: string) => `${productoId}|${color}`;

/** Una tarjeta por producto 5.11 + COLOR de la cotización (el mismo SKU en dos
 * colores son dos inventarios — Lili, OPP 1075, 2026-09-22), más las capturas
 * agregadas a mano. Lo capturado antes de que existiera el color (color '') lo
 * hereda el primer color del producto que no tenga captura propia; al guardar
 * esa tarjeta el server se lo asigna, y deja de ser "sin color". */
export function armarTarjetas(quoteLines: ItemDTO[], catalogo: ItemDTO[], saved: InventarioCotizacionProductoDTO[]): ProductRow[] {
  const byKey = new Map(saved.map((p) => [claveInv(p.productoId, p.color), p]));
  const usados = new Set<string>();
  const output: ProductRow[] = [];
  const auto: { p: ItemDTO; color: string }[] = [];
  for (const line of quoteLines) {
    const p = productForQuoteLine(line, catalogo);
    if (!p || !es511(p)) continue;
    const color = colorInventario(line.cols[COLOR_COL]?.text);
    if (!auto.some((a) => a.p.id === p.id && a.color === color)) auto.push({ p, color });
  }
  auto.sort((a, b) => a.p.name.localeCompare(b.p.name) || a.color.localeCompare(b.color));
  for (const { p, color } of auto) {
    const propio = byKey.get(claveInv(p.id, color));
    if (propio) usados.add(claveInv(p.id, color));
    output.push({ productoId: p.id, productoNombre: p.name, color, comentarios: '', agregadoManualmente: false, ...propio, fromQuote: true, colorGuardado: propio ? color : undefined });
  }
  // Herencia de la captura sin color: al primer color de ese producto sin la suya.
  for (const row of output) {
    const legacy = claveInv(row.productoId, '');
    if (row.colorGuardado !== undefined || usados.has(legacy)) continue;
    const vieja = byKey.get(legacy);
    // Un producto agregado a mano sin color es otra cosa: no se hereda.
    if (!vieja || vieja.agregadoManualmente) continue;
    usados.add(legacy);
    Object.assign(row, { ...vieja, color: row.color, fromQuote: true, colorGuardado: '' });
  }
  for (const p of saved) {
    if (!usados.has(claveInv(p.productoId, p.color))) output.push({ ...p, fromQuote: false, colorGuardado: p.color });
  }
  return output.sort((a, b) => a.productoNombre.localeCompare(b.productoNombre) || a.color.localeCompare(b.color));
}

const CATALOGO_COLOR_COL = 'dropdown_mkztty4b';

export function InventarioCotizacionTab({ oppId, quoteLines, readOnly = false }: { oppId: string; quoteLines: ItemDTO[]; readOnly?: boolean }) {
  const [catalogo, setCatalogo] = useState<ItemDTO[]>([]);
  const [saved, setSaved] = useState<InventarioCotizacionProductoDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<ItemDTO>();
  const [addingColor, setAddingColor] = useState('');
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  // Qué recuadro está subiendo, para pintar "Subiendo…" EN la foto: Clarity
  // (2026-09-22) mostró clics repetidos en "Subir imagen" sin ninguna señal de
  // que la subida iba en camino ni de que terminó.
  const [subiendo, setSubiendo] = useState<Record<string, 'mexico' | 'usa'>>({});
  const [error, setError] = useState<string>();
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getCatalogoProductos(), getInventarioCotizacion(oppId)])
      .then(([products, entries]) => { if (!cancelled) { setCatalogo(products); setSaved(entries); } })
      .catch(() => { if (!cancelled) setError('No se pudo cargar el inventario de esta cotización.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [oppId]);

  const rows = useMemo(() => armarTarjetas(quoteLines, catalogo, saved), [catalogo, quoteLines, saved]);
  // TODO el catálogo 5.11, incluidos los que ya están en la cotización: agregar
  // otro color del mismo SKU es justo lo que se buscaba y no salía.
  const catalogo511 = useMemo(() => catalogo.filter(es511), [catalogo]);
  const coloresDe = (p?: ItemDTO) => (p?.cols[CATALOGO_COLOR_COL]?.text ?? '').split(',').map((c) => c.trim()).filter(Boolean);

  const replace = (next: InventarioCotizacionProductoDTO, previo?: string) => setSaved((prev) => [
    ...prev.filter((p) => claveInv(p.productoId, p.color) !== claveInv(next.productoId, next.color) && !(previo !== undefined && claveInv(p.productoId, p.color) === claveInv(next.productoId, previo))),
    next,
  ]);

  const persist = async (row: ProductRow, files?: { mexico?: File; usa?: File }) => {
    if (readOnly) return;
    const key = claveInv(row.productoId, row.color);
    const place = files?.mexico ? 'mexico' : files?.usa ? 'usa' : undefined;
    setSaving((p) => ({ ...p, [key]: true }));
    if (place) setSubiendo((p) => ({ ...p, [key]: place }));
    setError(undefined);
    const result = await saveInventarioCotizacion(oppId, row, files).catch(() => ({ ok: false as const, producto: undefined, error: 'No se pudo guardar: revisa tu conexión.' }));
    setSaving((p) => ({ ...p, [key]: false }));
    setSubiendo((p) => { const { [key]: _, ...rest } = p; return rest; });
    if (!result.ok || !result.producto) {
      const msg = result.error ?? 'No se pudo guardar el producto.';
      setError(msg);
      toast(msg, 'error');
      return;
    }
    replace(result.producto, row.colorGuardado);
    toast(place ? `Imagen ${place === 'mexico' ? 'MEX' : 'USA'} guardada` : 'Guardado');
  };

  const onImage = (row: ProductRow, place: 'mexico' | 'usa', file: File) => {
    if (!file.type.startsWith('image/')) { setError('Solo se pueden subir imágenes.'); return; }
    void persist(row, { [place]: file });
  };

  const addProduct = () => {
    if (!adding) return;
    const color = colorInventario(addingColor);
    if (rows.some((r) => r.productoId === adding.id && r.color === color)) {
      setError(`${adding.name}${color ? ` · ${color}` : ''} ya está en la lista.`);
      return;
    }
    void persist({ productoId: adding.id, productoNombre: adding.name, color, comentarios: '', agregadoManualmente: true, fromQuote: false });
    setAdding(undefined);
    setAddingColor('');
  };

  const exportPdf = async () => {
    setExporting(true);
    setError(undefined);
    try {
      const { blob, filename } = await inventarioCotizacionPdf(oppId, rows.map((r) => ({ productoId: r.productoId, productoNombre: r.productoNombre, color: r.color, colorGuardado: r.colorGuardado })));
      downloadBlob(blob, filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el PDF del inventario.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ padding: '24px 32px 40px', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)', marginBottom: 4 }}>Inventario 5.11</div>
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>Los productos 5.11 de la cotización aparecen aquí automáticamente, uno por color. Pega (⌘V / Ctrl+V), arrastra o sube la captura del inventario en México y USA, más comentarios.</div>
        </div>
        <Button variant={loading || exporting || rows.length === 0 ? 'disabled' : 'secondary'} title={exporting ? 'Generando el PDF…' : !loading && rows.length === 0 ? 'No hay productos 5.11 para exportar' : undefined} onClick={() => void exportPdf()}>{exporting ? 'Generando…' : 'Exportar PDF'}</Button>
      </div>
      {!readOnly && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end', padding: 14, border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', background: 'var(--bg-raised)', marginBottom: 18 }}>
          <label style={{ flex: '3 1 260px', minWidth: 0 }}>
            <span style={labelStyle}>Agregar producto 5.11</span>
            <ProductPicker
              value={adding?.name ?? ''}
              catalog={catalogo511}
              catalogLoading={loading}
              allowFreeText={false}
              placeholder="Escribe el código o el nombre…"
              style={inputStyle}
              onPick={(choice) => { if ('item' in choice) { setAdding(choice.item); setAddingColor(''); } }}
            />
          </label>
          <label style={{ flex: '1 1 140px', minWidth: 0 }}>
            <span style={labelStyle}>Color</span>
            <input value={addingColor} onChange={(e) => setAddingColor(e.target.value)} list="inventario-511-colores" placeholder="Opcional" style={inputStyle} />
            <datalist id="inventario-511-colores">{coloresDe(adding).map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <Button variant={!adding ? 'disabled' : 'secondary'} title={!adding ? 'Elige primero un producto 5.11 del catálogo' : undefined} onClick={addProduct}>Agregar</Button>
        </div>
      )}
      {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)', marginBottom: 12 }}>{error}</div>}
      {loading ? <div style={{ color: 'var(--ink-tertiary)', font: 'var(--text-label)' }}>Cargando inventario…</div> : rows.length === 0 ? (
        <div style={{ padding: 24, border: '1px dashed var(--border)', borderRadius: 'var(--radius-xl)', color: 'var(--ink-tertiary)', font: 'var(--text-label)' }}>Esta cotización todavía no tiene productos 5.11. Puedes agregar uno del catálogo.</div>
      ) : <div style={{ display: 'grid', gap: 10 }}>{rows.map((row) => (
        <ProductCard key={claveInv(row.productoId, row.color)} row={row} disabled={readOnly || !!saving[claveInv(row.productoId, row.color)]} subiendo={subiendo[claveInv(row.productoId, row.color)]} onImage={onImage} onComments={(comentarios) => void persist({ ...row, comentarios })} />
      ))}</div>}
    </div>
  );
}

// Las fotos son capturas anchas de tablas de tallas: MEX y USA lado a lado,
// COMPLETAS (`contain`, nunca `cover` — así se recortaban) en una caja baja
// para que la tab no se vuelva un muro de imágenes. Para leerlas: clic = visor
// a pantalla completa. Cambiarla va por su botón aparte.
function ProductCard({ row, disabled, subiendo, onImage, onComments }: { row: ProductRow; disabled: boolean; subiendo?: 'mexico' | 'usa'; onImage: (row: ProductRow, place: 'mexico' | 'usa', file: File) => void; onComments: (comments: string) => void }) {
  const [zoom, setZoom] = useState<{ url: string; title: string }>();
  const isMobile = useIsMobile();
  return <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 12, background: 'var(--bg-raised)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
      <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{row.productoNombre}</div>
      {row.color && <span style={{ font: 'var(--text-eyebrow)', color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: 999, padding: '3px 8px' }}>{row.color}</span>}
      {row.fromQuote && <span style={{ font: 'var(--text-eyebrow)', color: 'var(--accent)', background: 'var(--status-ganada-tint)', borderRadius: 999, padding: '3px 7px' }}>En cotización</span>}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
      <PhotoBox title="Inventario MEX" url={row.imagenMexicoUrl} disabled={disabled} uploading={subiendo === 'mexico'} onFile={(f) => onImage(row, 'mexico', f)} onZoom={setZoom} />
      <PhotoBox title="Inventario USA" url={row.imagenUsaUrl} disabled={disabled} uploading={subiendo === 'usa'} onFile={(f) => onImage(row, 'usa', f)} onZoom={setZoom} />
    </div>
    <label style={{ display: 'block', marginTop: 10 }}><span style={labelStyle}>Comentarios</span><textarea defaultValue={row.comentarios} disabled={disabled} onBlur={(e) => { if (e.target.value !== row.comentarios) onComments(e.target.value); }} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Agrega comentarios de disponibilidad, tallas o tiempos…" /></label>
    {zoom && <ImageZoom url={zoom.url} title={zoom.title} onClose={() => setZoom(undefined)} />}
  </div>;
}

/** Imagen del portapapeles o de lo arrastrado; captura de pantalla = image/png. */
function imagenDe(data: DataTransfer | null): File | undefined {
  const file = Array.from(data?.files ?? []).find((f) => f.type.startsWith('image/'));
  if (file) return file;
  const item = Array.from(data?.items ?? []).find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  const blob = item?.getAsFile();
  if (!blob) return undefined;
  const ext = blob.type.split('/')[1] || 'png';
  return blob.name && blob.name !== 'image.png' ? blob : new File([blob], `captura-${Date.now()}.${ext}`, { type: blob.type });
}

// Recuadro de una foto. Tres caminos para subirla: PEGAR (clic en el recuadro
// y ⌘V/Ctrl+V — la captura va directo al portapapeles, sin archivo de por
// medio; lo pidió Lili 2026-09-22), arrastrar, o elegir archivo. El pegado se
// escucha en `document` mientras el recuadro tiene el foco: un div no editable
// no recibe `paste` igual en todos los navegadores, el documento sí.
// En celular pegar no aplica: el recuadro vacío abre el selector de archivo.
function PhotoBox({ title, url, disabled, uploading = false, onFile, onZoom }: { title: string; url?: string; disabled: boolean; uploading?: boolean; onFile: (file: File) => void; onZoom: (z: { url: string; title: string }) => void }) {
  const isMobile = useIsMobile();
  const boxRef = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!armed || disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      if (!boxRef.current?.contains(document.activeElement)) return;
      const file = imagenDe(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      boxRef.current?.blur();
      setArmed(false);
      onFile(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [armed, disabled, onFile]);

  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setArmed(false);
    if (file) onFile(file);
  };
  const fileLink = (text: string) => (
    <label onMouseDown={(e) => e.preventDefault()} style={{ font: 'var(--text-label)', color: 'var(--accent)', cursor: 'pointer' }}>
      {text}<input aria-label={title} type="file" accept="image/*" disabled={disabled} onChange={pickFile} style={{ display: 'none' }} />
    </label>
  );
  const dropProps = disabled ? {} : {
    onDragOver: (e: DragEvent) => { e.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop: (e: DragEvent) => { e.preventDefault(); setDragging(false); const f = imagenDe(e.dataTransfer); if (f) onFile(f); },
  };
  const hot = armed || dragging;
  const frame: React.CSSProperties = {
    position: 'relative', display: 'flex', height: PHOTO_H, boxSizing: 'border-box', borderRadius: 'var(--radius-lg)', background: 'var(--bg)',
    border: hot ? '2px dashed var(--accent)' : `1px ${url ? 'solid' : 'dashed'} var(--border)`, outline: 'none',
  };
  const hint = <span style={{ margin: 'auto', textAlign: 'center', color: 'var(--ink-tertiary)', font: 'var(--text-label)', padding: 8 }}>
    {dragging ? 'Suelta la imagen aquí' : armed ? <>Pega la imagen con <b>⌘V</b> / <b>Ctrl+V</b><br />{fileLink('o elige un archivo')}</> : <>Clic aquí y pega la captura (⌘V)<br />o arrástrala · {fileLink('elegir archivo')}</>}
  </span>;

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div style={{ ...labelStyle, marginBottom: 0 }}>{title}</div>
        {url && !disabled && !isMobile && !armed && <button type="button" onClick={() => boxRef.current?.focus()} style={{ background: 'none', border: 0, padding: 0, font: 'var(--text-label)', color: 'var(--accent)', cursor: 'pointer' }}>Cambiar imagen</button>}
        {url && !disabled && isMobile && fileLink('Cambiar imagen')}
      </div>
      {isMobile && !url ? (
        <label style={{ ...frame, cursor: disabled ? 'default' : 'pointer' }}>
          <span style={{ margin: 'auto', color: 'var(--ink-tertiary)', font: 'var(--text-label)' }}>{disabled ? (uploading ? '' : 'Sin imagen') : 'Subir imagen'}</span>
          {uploading && subiendoOverlay}
          <input aria-label={title} type="file" accept="image/*" disabled={disabled} onChange={pickFile} style={{ display: 'none' }} />
        </label>
      ) : (
        <div
          ref={boxRef}
          tabIndex={disabled ? -1 : 0}
          aria-label={`${title}: clic y pega la imagen`}
          onFocus={() => { if (!disabled) setArmed(true); }}
          // Con foto, el clic es para verla en grande: no debe tomar el foco
          // (armaría el pegado y se comería el zoom). Se arma con "Cambiar imagen".
          onMouseDown={(e) => { if (url && !armed) e.preventDefault(); }}
          onBlur={(e) => { if (!boxRef.current?.contains(e.relatedTarget as Node)) setArmed(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') boxRef.current?.blur(); }}
          {...dropProps}
          style={{ ...frame, cursor: url && !armed ? 'zoom-in' : disabled ? 'default' : 'pointer', padding: url ? 4 : 0 }}
          onClick={() => { if (url && !armed) onZoom({ url, title }); }}
        >
          {url && <img src={url} alt={title} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', opacity: hot ? 0.25 : 1 }} />}
          {!uploading && (!url || hot) && (url ? <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>{hint}</div> : disabled ? <span style={{ margin: 'auto', color: 'var(--ink-tertiary)', font: 'var(--text-label)' }}>Sin imagen</span> : hint)}
          {uploading && subiendoOverlay}
        </div>
      )}
    </div>
  );
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

const subiendoOverlay = (
  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(255,255,255,.8)', borderRadius: 'var(--radius-lg)', color: 'var(--accent)', font: 'var(--text-label-strong)', cursor: 'progress' }}>
    <span aria-hidden>⏳</span> Subiendo imagen…
  </div>
);

const PHOTO_H = 150;
const labelStyle: React.CSSProperties = { display: 'block', font: 'var(--text-eyebrow)', color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '.45px', marginBottom: 6 };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg)', color: 'var(--ink)', padding: '8px 10px', font: 'var(--text-label)' };
