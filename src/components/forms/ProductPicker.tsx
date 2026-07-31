// Picker de producto del catálogo para las líneas de cotización. Reemplaza al
// <input list="datalist"> nativo, que dependía del filtrado del navegador
// (inexistente en Android) y solo servía si lo tecleado empezaba igual que el
// nombre completo: teclear un SKU ("72002") no resolvía a un producto y la
// línea se guardaba como texto libre, sin SKU/descripción/colores
// (Efraín, 2026-07-30: "tenemos que poder buscar por SKU, nombre o ambos").
//
// El filtrado real vive en src/lib/productSearch.ts (puro, con tests). Aquí
// solo va la UI: lista en portal fijo (para que no la recorte el overflow del
// drawer), navegación con teclado y filas cómodas para dedo en mobile.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ItemDTO } from '../../lib/api';
import { MonoTag } from '../core/Badges';
import { searchProductos, exactProducto, productoSku, productoMarca } from '../../lib/productSearch';

/** Un producto real del catálogo (se escribe la relación) o texto libre
 * (producto que todavía no existe en Productos). */
export type ProductoChoice = { item: ItemDTO } | { freeText: string };

interface Props {
  /** Nombre del producto ya guardado en la línea. */
  value: string;
  catalog: ItemDTO[];
  catalogLoading?: boolean;
  /** PATCH en vuelo — bloquea el campo igual que el resto de la grid. */
  saving?: boolean;
  /** Permitir guardar lo tecleado aunque no exista en el catálogo. */
  allowFreeText?: boolean;
  placeholder?: string;
  style?: React.CSSProperties;
  onPick: (choice: ProductoChoice) => void;
}

const MAX_RESULTS = 60;

export function ProductPicker({
  value, catalog, catalogLoading = false, saving = false,
  allowFreeText = true, placeholder = 'Buscar por nombre o SKU…', style, onPick,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () => searchProductos(catalog, query, MAX_RESULTS),
    [catalog, query],
  );
  // "Usar «x» como texto libre" solo cuando lo tecleado no ES ya un producto
  // (por nombre completo o por SKU) — si existe, elegirlo del catálogo es
  // siempre lo correcto: es lo que trae SKU, descripción y colores.
  const freeText = allowFreeText && query.trim() !== '' && !exactProducto(catalog, query)
    ? query.trim()
    : null;
  const optionCount = results.length + (freeText ? 1 : 0);

  useEffect(() => { setActiveIndex(0); }, [query, open]);

  // La lista se ancla al input pero se dibuja en un portal fijo. En mobile el
  // teclado se come la mitad inferior de la pantalla, así que si abajo no cabe
  // y arriba hay más aire, se abre hacia arriba.
  const updateRect = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const openUp = below < 180 && above > below;
    const maxHeight = Math.min(300, Math.max(120, openUp ? above : below));
    // En la grid de desktop la columna Producto es angosta (170-340px) y los
    // nombres del catálogo son largos: la lista se ensancha hasta donde quepa
    // en pantalla, nunca menos que el input.
    const width = Math.min(Math.max(r.width, 320), window.innerWidth - r.left - 8);
    setRect({
      top: openUp ? r.top - maxHeight - 4 : r.bottom + 4,
      left: r.left,
      width,
      maxHeight,
    });
  };

  const openList = () => {
    if (saving) return;
    updateRect();
    setQuery('');
    setOpen(true);
  };

  const close = () => { setOpen(false); setQuery(''); };

  useEffect(() => {
    if (!open) return;
    updateRect();
    const onScroll = () => updateRect();
    const onOutside = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('mousedown', onOutside);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('mousedown', onOutside);
    };
  }, [open]);

  const choose = (choice: ProductoChoice) => {
    close();
    inputRef.current?.blur();
    onPick(choice);
  };

  const chooseIndex = (i: number) => {
    if (i < results.length) { choose({ item: results[i] }); return; }
    if (freeText) choose({ freeText });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { openList(); return; }
      setActiveIndex((i) => Math.min(i + 1, optionCount - 1));
      return;
    }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (open && optionCount > 0) chooseIndex(activeIndex); return; }
  };

  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8, minHeight: 40,
    padding: '8px 12px', cursor: 'pointer', font: 'var(--text-label)', color: 'var(--ink)',
    background: active ? 'var(--bg-sunken)' : 'transparent',
    borderBottom: '1px solid var(--border-subtle)',
  });

  return (
    <div ref={rootRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <input
        ref={inputRef}
        value={open ? query : value}
        onFocus={openList}
        onClick={openList}
        onChange={(e) => { setQuery(e.target.value); if (!open) { updateRect(); setOpen(true); } }}
        onKeyDown={onKeyDown}
        disabled={saving}
        autoComplete="off"
        placeholder={catalogLoading ? 'Cargando catálogo…' : placeholder}
        style={{ ...style, color: open || value ? 'var(--ink)' : 'var(--ink-quiet)' }}
      />
      {open && rect && createPortal(
        <div
          style={{
            position: 'fixed', top: rect.top, left: rect.left, width: rect.width,
            maxHeight: rect.maxHeight, overflowY: 'auto', background: 'var(--bg-raised)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-modal)', zIndex: 300,
          }}
        >
          {results.length === 0 && !freeText && (
            <div style={{ padding: '10px 12px', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
              {catalogLoading ? 'Cargando catálogo…' : 'Ningún producto coincide.'}
            </div>
          )}
          {results.map((p, i) => {
            const sku = productoSku(p);
            const marca = productoMarca(p);
            return (
              <div
                key={p.id}
                className="row-hover"
                onMouseDown={(e) => { e.preventDefault(); chooseIndex(i); }}
                onMouseEnter={() => setActiveIndex(i)}
                style={rowStyle(i === activeIndex)}
              >
                {sku && <MonoTag style={{ flex: 'none' }}>{sku}</MonoTag>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </div>
                  {marca && (
                    <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>{marca}</div>
                  )}
                </div>
              </div>
            );
          })}
          {freeText && (
            <div
              className="row-hover"
              onMouseDown={(e) => { e.preventDefault(); chooseIndex(results.length); }}
              onMouseEnter={() => setActiveIndex(results.length)}
              style={{
                ...rowStyle(activeIndex === results.length),
                color: 'var(--ink-secondary)', fontStyle: 'italic', borderBottom: 'none',
              }}
              title="El producto se guarda como texto libre — sin SKU, descripción ni colores del catálogo"
            >
              Usar «{freeText}» como texto libre
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
