// "Crear orden de compra" — la OC manual de un jalón (Efraín, 2026-09-21: "debe
// tener una opción fácil… solo: CREAR orden de compra"). Antes había que abrir
// "+ Agregar producto (otro proveedor)" UNA VEZ POR LÍNEA, con el proveedor
// vuelto a buscar en cada vuelta. Aquí: un proveedor, N renglones de texto
// libre, guardar. No hay endpoint nuevo: cada renglón es el mismo alta de línea
// manual (`POST /api/proyectos/:id/lineas`), de a una y en orden, para que la
// OC salga en el orden en que se capturó. La tarjeta del proveedor aparece con
// sus líneas y de ahí se genera el PDF como siempre.
//
// Producto o concepto es texto libre, pero al teclear sugiere del catálogo y de
// lo que ya se capturó a mano en otras OC (caché D1 `oc_concepto`, Efraín
// 2026-09-21) — elegir una sugerencia llena SKU/costo/etc. sin pisar lo tecleado.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '../../components/core/Modal';
import { Button } from '../../components/core/Button';
import { MonoTag } from '../../components/core/Badges';
import { SearchInput } from '../../components/forms/SearchInput';
import {
  usePoll, addProyectoLinea, getCatalogoProductos, getOcConceptos, SOLO_NOMBRE,
  type ItemDTO, type OcConcepto,
} from '../../lib/api';
import { searchProductos, productoSku, productoNombreCorto, productoMarca, norm, alnum } from '../../lib/productSearch';
import { fmtMoney } from '../../lib/format';
import { pctToFraccion } from '../../../shared/descuento';
import type { ProveedorRef } from './AgregarLineaModal';

interface Renglon {
  key: number;
  producto: string; sku: string; color: string; talla: string; unidad: string;
  cantidad: string; costo: string; descuento: string;
  /** Proveedor del producto elegido de una sugerencia (catálogo o caché) —
   * para marcar en naranja el renglón que no es del proveedor de la orden. */
  proveedorOrigen?: ProveedorRef | null;
}

let siguienteKey = 1;
const renglonVacio = (): Renglon => ({
  key: siguienteKey++, producto: '', sku: '', color: '', talla: '', unidad: '',
  cantidad: '', costo: '', descuento: '',
});

// Naranja CMP (el mismo del encabezado de la OC en PDF, worker/lib/pdf/logo.ts).
const NARANJA = '#f49e09';
const NARANJA_TINT = '#fef3e0';

const tieneAlgo = (r: Renglon) =>
  [r.producto, r.sku, r.color, r.talla, r.unidad, r.cantidad, r.costo, r.descuento].some(v => v.trim() !== '');

type Campo = Exclude<keyof Renglon, 'key' | 'proveedorOrigen'>;

const CAMPOS: { campo: Campo; label: string; flex: string; type?: 'number'; placeholder?: string }[] = [
  { campo: 'producto', label: 'Producto o concepto *', flex: '3 1 220px', placeholder: 'Ej. Aplicación planchado camisas' },
  { campo: 'sku', label: 'Modelo / SKU', flex: '1.5 1 120px' },
  { campo: 'color', label: 'Color', flex: '1 1 90px' },
  { campo: 'talla', label: 'Talla', flex: '1 1 80px' },
  { campo: 'unidad', label: 'Unidad', flex: '1 1 80px', placeholder: 'PIEZA' },
  { campo: 'cantidad', label: 'Cant.', flex: '1 1 80px', type: 'number' },
  { campo: 'costo', label: 'Costo C/U', flex: '1 1 90px', type: 'number' },
  { campo: 'descuento', label: 'Desc. %', flex: '1 1 70px', type: 'number', placeholder: '0' },
];

interface Props {
  proyectoId: string;
  onClose: () => void;
  onCreated: () => void;
}

export function CrearOcModal({ proyectoId, onClose, onCreated }: Props) {
  const [proveedor, setProveedor] = useState<ProveedorRef | null>(null);
  const [q, setQ] = useState('');
  // La lista de proveedores flota sobre el formulario y solo mientras el
  // buscador tiene el foco: abierta en línea empujaba los renglones y el modal
  // cambiaba de alto con cada tecla ("Sin resultados" vs. 5 opciones).
  const [provAbierto, setProvAbierto] = useState(false);
  const [catalogo, setCatalogo] = useState<ItemDTO[]>([]);
  const [conceptos, setConceptos] = useState<OcConcepto[]>([]);
  useEffect(() => {
    let vivo = true;
    getCatalogoProductos().then(items => { if (vivo) setCatalogo(items); }).catch(() => { /* sin sugerencias del catálogo */ });
    getOcConceptos().then(items => { if (vivo) setConceptos(items); }).catch(() => { /* sin sugerencias previas */ });
    return () => { vivo = false; };
  }, []);
  const { data } = usePoll('proveedores', q, SOLO_NOMBRE);
  const opciones = data?.items ?? [];
  const [moneda, setMoneda] = useState('MXN');
  const [renglones, setRenglones] = useState<Renglon[]>(() => [renglonVacio()]);
  const [saving, setSaving] = useState(false);
  const [progreso, setProgreso] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Teclear otro producto a mano descarta el proveedor de la sugerencia: ya
  // no se sabe de quién es.
  const set = (key: number, campo: Campo, v: string) =>
    setRenglones(rs => rs.map(r => (r.key === key
      ? { ...r, [campo]: v, ...(campo === 'producto' ? { proveedorOrigen: null } : {}) }
      : r)));

  // Producto y SKU se toman de la sugerencia; el resto solo llena lo vacío
  // (lo que Compras ya tecleó en el renglón manda).
  const aplicar = (key: number, s: Sugerencia) => {
    setRenglones(rs => rs.map(r => {
      if (r.key !== key) return r;
      const llena = (actual: string, nuevo: string | null | undefined) => (actual.trim() ? actual : (nuevo ?? ''));
      return {
        ...r,
        producto: s.producto,
        sku: s.sku || r.sku,
        color: llena(r.color, s.color),
        talla: llena(r.talla, s.talla),
        unidad: llena(r.unidad, s.unidad),
        costo: llena(r.costo, s.costo != null && s.costo > 0 ? String(s.costo) : null),
        proveedorOrigen: s.proveedorId ? { id: s.proveedorId, name: s.proveedorName || `Proveedor ${s.proveedorId}` } : null,
      };
    }));
    if (!proveedor && s.proveedorId && s.proveedorName) setProveedor({ id: s.proveedorId, name: s.proveedorName });
  };

  const llenos = renglones.filter(tieneAlgo);
  const subtotal = llenos.reduce((s, r) => {
    const desc = Number(pctToFraccion(r.descuento || '0')) || 0;
    return s + (Number(r.cantidad) || 0) * (Number(r.costo) || 0) * (1 - desc);
  }, 0);

  // Cerrar con algo capturado pide confirmación (Efraín, 2026-09-21): un clic
  // fuera del modal, Escape o la ✕ tiraban todos los renglones sin aviso.
  const hayCaptura = llenos.length > 0 || proveedor !== null;
  const cerrar = () => {
    if (saving) return; // a medio guardar no se cierra
    if (hayCaptura && !window.confirm('¿Cerrar sin crear la orden? Se pierde lo que capturaste.')) return;
    onClose();
  };

  const submit = async () => {
    if (!proveedor) { setError('Elige el proveedor de la orden.'); return; }
    if (llenos.length === 0) { setError('Captura al menos un producto.'); return; }
    if (llenos.some(r => !r.producto.trim())) { setError('Cada renglón necesita su producto o concepto.'); return; }
    setSaving(true);
    setError(null);
    // De a una y en orden: el orden de alta es el orden del PDF. Lo que ya se
    // guardó se quita de la tabla, así un fallo a medias no duplica al reintentar.
    let creadas = 0;
    for (const r of llenos) {
      setProgreso(`Guardando ${creadas + 1} de ${llenos.length}…`);
      const res = await addProyectoLinea(proyectoId, {
        producto: r.producto.trim(),
        proveedorId: proveedor.id,
        sku: r.sku.trim() || undefined,
        color: r.color.trim() || undefined,
        talla: r.talla.trim() || undefined,
        unidad: r.unidad.trim() || undefined,
        cantidad: r.cantidad.trim() ? Number(r.cantidad) : undefined,
        costo: r.costo.trim() ? Number(r.costo) : undefined,
        descuento: r.descuento.trim() ? Number(pctToFraccion(r.descuento)) : undefined,
        moneda: moneda.trim() || undefined,
      });
      if (!res.ok) {
        setSaving(false);
        setProgreso('');
        setError(`${creadas > 0 ? `Se guardaron ${creadas}; ` : ''}falló "${r.producto.trim()}": ${res.error ?? 'no se pudo guardar'}. Corrige y vuelve a guardar — lo ya guardado no se repite.`);
        if (creadas > 0) onCreated();
        return;
      }
      creadas++;
      setRenglones(rs => rs.filter(x => x.key !== r.key));
    }
    setSaving(false);
    onCreated();
    onClose();
  };

  return (
    <Modal
      title="Crear orden de compra"
      onClose={cerrar}
      width={1080}
      footer={
        <>
          <span style={{ marginRight: 'auto', font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>
            {progreso || (llenos.length > 0
              ? `${llenos.length} ${llenos.length === 1 ? 'línea' : 'líneas'} · subtotal ${fmtMoney(subtotal)} ${moneda}`
              : '')}
          </span>
          <Button variant="ghost" onClick={saving ? undefined : cerrar}>Cancelar</Button>
          <Button variant="primary" onClick={saving ? undefined : submit} style={saving ? { opacity: .6 } : undefined}>
            {saving ? 'Guardando…' : 'Crear orden'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
          Una orden a mano: elige el proveedor y captura sus productos, todo texto libre (no tiene que existir en el
          catálogo). Al guardar aparece la tarjeta del proveedor con estas líneas — ahí las sigues editando y generas el PDF.
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '3 1 280px', minWidth: 0 }}>
            <div style={labelStyle}>Proveedor *</div>
            {proveedor ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '8px 12px',
              }}>
                <span style={{ font: 'var(--text-label)', color: 'var(--ink)' }}>{proveedor.name}</span>
                <span onClick={() => setProveedor(null)} style={{ cursor: 'pointer', color: 'var(--accent)', font: 'var(--text-caption)' }}>Cambiar</span>
              </div>
            ) : (
              <>
                <div
                  style={{ position: 'relative' }}
                  onFocus={() => setProvAbierto(true)}
                  onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setProvAbierto(false); }}
                >
                  <SearchInput value={q} onChange={(e) => { setQ(e.target.value); setProvAbierto(true); }} placeholder="Buscar proveedor…" style={{ maxWidth: 'none' }} />
                  {provAbierto && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4,
                      maxHeight: 220, overflowY: 'auto', background: 'var(--bg-raised)',
                      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)',
                    }}>
                      {opciones.length === 0 ? (
                        <div style={{ padding: 10, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin resultados.</div>
                      ) : opciones.map((p) => (
                        <div
                          key={p.id}
                          className="row-hover"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { setProveedor(p); setProvAbierto(false); setQ(''); }}
                          style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', font: 'var(--text-label)', color: 'var(--ink)', cursor: 'pointer' }}
                        >
                          {p.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div style={{ flex: '1 1 100px' }}>
            <div style={labelStyle}>Moneda</div>
            <input value={moneda} onChange={(e) => setMoneda(e.target.value.toUpperCase())} placeholder="MXN" style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {renglones.map((r, n) => {
            const ajeno = !!(proveedor && r.proveedorOrigen && r.proveedorOrigen.id !== proveedor.id);
            return (
            <div
              key={r.key}
              style={{
                display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end',
                border: `1px solid ${ajeno ? NARANJA : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-lg)', padding: 8,
                background: ajeno ? NARANJA_TINT : 'var(--bg-sunken)',
              }}
            >
              {CAMPOS.map(c => (
                <label key={c.campo} style={{ flex: c.flex, minWidth: 0, display: 'block' }}>
                  <div style={labelStyle}>{c.label}</div>
                  {c.campo === 'producto' ? (
                    <ConceptoInput
                      value={r.producto}
                      autoFocus={n === renglones.length - 1 && n > 0}
                      placeholder={c.placeholder}
                      catalogo={catalogo}
                      conceptos={conceptos}
                      onChange={(v) => set(r.key, 'producto', v)}
                      onPick={(sug) => aplicar(r.key, sug)}
                    />
                  ) : <input
                    value={r[c.campo]}
                    type={c.type ?? 'text'}
                    min={c.type === 'number' ? 0 : undefined}
                    placeholder={c.placeholder}
                    onChange={(e) => set(r.key, c.campo, e.target.value)}
                    style={inputStyle}
                  />}
                </label>
              ))}
              <span
                onClick={saving ? undefined : () => setRenglones(rs => (rs.length > 1 ? rs.filter(x => x.key !== r.key) : [renglonVacio()]))}
                title="Quitar este renglón"
                style={{ cursor: 'pointer', color: 'var(--status-perdida)', font: 'var(--text-label)', padding: '8px 4px' }}
              >
                ✕
              </span>
              {ajeno && (
                <div style={{ flexBasis: '100%', font: 'var(--text-caption)', color: '#b86e00' }}>
                  En el catálogo este producto es de <b>{r.proveedorOrigen!.name}</b>, no de {proveedor!.name}.
                </div>
              )}
            </div>
            );
          })}
          <div>
            <Button variant="secondary" onClick={saving ? undefined : () => setRenglones(rs => [...rs, renglonVacio()])}>
              + Otro producto
            </Button>
          </div>
        </div>

        {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
      </div>
    </Modal>
  );
}

/** Lo que llena un renglón al elegir una sugerencia (catálogo o caché). */
interface Sugerencia {
  producto: string;
  sku: string | null;
  color?: string | null;
  talla?: string | null;
  unidad?: string | null;
  costo?: number | null;
  proveedorId?: string | null;
  proveedorName?: string | null;
}

type Opcion =
  | { tipo: 'previo'; c: OcConcepto }
  | { tipo: 'catalogo'; item: ItemDTO };

const MAX_PREVIOS = 8;
const MAX_CATALOGO = 20;
// Columna Costo Distribuidor del board Productos (viaja en CATALOGO_COLS; el
// server la filtra por rol, a compras/admin sí les llega).
const PRODUCTO_COSTO_COL = 'numeric_mkzpx7eb';
const PRODUCTO_PROVEEDOR_COL = 'board_relation_mm1cwqky';

/** Proveedor asignado al producto en el catálogo (mismo criterio que
 * CambiarProductoModal). */
function proveedorDelCatalogo(p: ItemDTO): ProveedorRef | null {
  const val = p.cols[PRODUCTO_PROVEEDOR_COL]?.value as { linked_item_ids?: unknown[] } | undefined;
  const id = (val?.linked_item_ids ?? []).map(String).find(x => x && x !== 'undefined');
  if (!id) return null;
  return { id, name: p.cols[PRODUCTO_PROVEEDOR_COL]?.text?.trim() || `Proveedor ${id}` };
}

/** Cada palabra de la búsqueda debe aparecer (en cualquier orden) en producto,
 * SKU o proveedor — mismo criterio flexible que searchProductos. */
function buscarPrevios(conceptos: OcConcepto[], query: string): OcConcepto[] {
  const palabras = norm(query).split(' ').filter(Boolean);
  if (palabras.length === 0) return [];
  const out: OcConcepto[] = [];
  for (const c of conceptos) {
    const raw = [c.producto, c.sku, c.proveedorName].filter(Boolean).join(' ');
    const hay = norm(raw);
    const hayAlnum = alnum(raw);
    if (palabras.every(p => hay.includes(p) || (alnum(p) !== '' && hayAlnum.includes(alnum(p))))) {
      out.push(c);
      if (out.length >= MAX_PREVIOS) break;
    }
  }
  return out;
}

/** Input de texto libre con sugerencias: lo tecleado ES el valor; la lista
 * (portal fijo, para no mover el alto del modal) solo propone. */
function ConceptoInput({ value, onChange, onPick, catalogo, conceptos, placeholder, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  onPick: (s: Sugerencia) => void;
  catalogo: ItemDTO[];
  conceptos: OcConcepto[];
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const opciones = useMemo<Opcion[]>(() => {
    if (!value.trim()) return [];
    return [
      ...buscarPrevios(conceptos, value).map(c => ({ tipo: 'previo' as const, c })),
      ...searchProductos(catalogo, value, MAX_CATALOGO).map(item => ({ tipo: 'catalogo' as const, item })),
    ];
  }, [value, catalogo, conceptos]);

  const updateRect = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const openUp = below < 180 && above > below;
    const maxHeight = Math.min(320, Math.max(120, openUp ? above : below));
    const width = Math.min(Math.max(r.width, 420), window.innerWidth - r.left - 8);
    setRect({ top: openUp ? r.top - maxHeight - 4 : r.bottom + 4, left: r.left, width, maxHeight });
  };

  useEffect(() => {
    if (!open) return;
    updateRect();
    const onMove = () => updateRect();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  const elegir = (o: Opcion) => {
    setOpen(false);
    if (o.tipo === 'previo') {
      onPick({ ...o.c });
      return;
    }
    const costo = Number((o.item.cols[PRODUCTO_COSTO_COL]?.text ?? '').replace(/,/g, ''));
    const prov = proveedorDelCatalogo(o.item);
    onPick({
      producto: productoNombreCorto(o.item),
      sku: productoSku(o.item) || null,
      costo: Number.isFinite(costo) && costo > 0 ? costo : null,
      proveedorId: prov?.id ?? null,
      proveedorName: prov?.name ?? null,
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || opciones.length === 0) return;
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, opciones.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, -1)); return; }
    // Enter sin opción marcada = se queda el texto libre tal cual.
    if (e.key === 'Enter' && active >= 0) { e.preventDefault(); elegir(opciones[active]); }
  };

  const fila = (i: number): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '6px 12px', cursor: 'pointer',
    font: 'var(--text-label)', color: 'var(--ink)', borderBottom: '1px solid var(--border-subtle)',
    background: i === active ? 'var(--bg-sunken)' : 'transparent',
  });
  const seccion: CSSProperties = {
    padding: '6px 12px', font: 'var(--text-caption)', color: 'var(--ink-tertiary)', background: 'var(--bg-sunken)',
  };
  const nPrevios = opciones.filter(o => o.tipo === 'previo').length;

  return (
    <>
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setActive(-1); if (!open) setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        style={inputStyle}
      />
      {open && rect && opciones.length > 0 && createPortal(
        <div style={{
          position: 'fixed', top: rect.top, left: rect.left, width: rect.width, maxHeight: rect.maxHeight,
          overflowY: 'auto', background: 'var(--bg-raised)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', zIndex: 300,
        }}>
          {opciones.map((o, i) => (
            <div key={o.tipo === 'previo' ? `p-${o.c.producto}-${o.c.sku ?? ''}` : `c-${o.item.id}`}>
              {i === 0 && nPrevios > 0 && <div style={seccion}>Capturados antes en otras órdenes</div>}
              {i === nPrevios && <div style={seccion}>Catálogo de productos</div>}
              <div
                className="row-hover"
                onMouseDown={(e) => { e.preventDefault(); elegir(o); }}
                onMouseEnter={() => setActive(i)}
                style={fila(i)}
              >
                {o.tipo === 'previo' ? (
                  <>
                    {o.c.sku && <MonoTag style={{ flex: 'none' }}>{o.c.sku}</MonoTag>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.c.producto}</div>
                      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
                        {[o.c.proveedorName, o.c.costo != null ? `$${o.c.costo}` : null, `${o.c.usos} ${o.c.usos === 1 ? 'vez' : 'veces'}`].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {productoSku(o.item) && <MonoTag style={{ flex: 'none' }}>{productoSku(o.item)}</MonoTag>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.item.name}</div>
                      {productoMarca(o.item) && <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>{productoMarca(o.item)}</div>}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

const labelStyle: CSSProperties = { font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 4 };

const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', font: 'var(--text-label)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '8px 10px',
  background: 'var(--bg-raised)',
};
