// Alta / edición de una solicitud de muestras (Efraín, 2026-09-21): "BASTANTE
// similar a una cotización… cantidad, color y TALLA, que puedan elegir el
// producto del catálogo pero mucho más simple", más comentarios por línea.
// Reemplaza el Excel "SOLICITUD DE MUESTRAS": el solicitante es quien la crea
// y el proyecto/cliente/folio salen del item ligado, así que aquí solo se
// captura lo que el Excel pedía a mano.
//
// El producto se elige del catálogo (ProductPicker: SKU y marca salen de ahí)
// o se deja como texto libre — una muestra puede ser de algo que todavía no
// está en Productos. Color y talla sugieren lo que el catálogo tiene para ese
// producto, sin obligar (la marca a veces lo nombra distinto: "STORM").
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Modal } from '../../components/core/Modal';
import { Button } from '../../components/core/Button';
import { ProductPicker } from '../../components/forms/ProductPicker';
import { getCatalogoProductos, type ItemDTO } from '../../lib/api';
import { productoMarca, productoNombreCorto, productoSku } from '../../lib/productSearch';
import { crearMuestra, editarMuestra } from '../../lib/muestrasApi';
import type { MuestraPadre, MuestraSolicitudDTO } from '../../../shared/muestras';

const CATALOGO_COLOR_COL = 'dropdown_mkztty4b';
const CATALOGO_TALLAS_COL = 'text_mm5v6jhj';

interface Renglon {
  key: number;
  producto: string; productoId: string | null; sku: string; marca: string;
  color: string; talla: string; cantidad: string; comentarios: string;
}

let siguienteKey = 1;
const renglonVacio = (): Renglon => ({
  key: siguienteKey++, producto: '', productoId: null, sku: '', marca: '', color: '', talla: '', cantidad: '1', comentarios: '',
});
const tieneAlgo = (r: Renglon) => [r.producto, r.color, r.talla, r.comentarios].some(v => v.trim() !== '');

const lista = (s: string | null | undefined) => (s ?? '').split(',').map(x => x.trim()).filter(Boolean);

const labelStyle: CSSProperties = { font: 'var(--text-micro)', color: 'var(--ink-quiet)', marginBottom: 4 };
const inputStyle: CSSProperties = {
  width: '100%', height: 36, font: 'var(--text-body)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '0 10px', boxSizing: 'border-box', background: '#fff',
};

interface Props {
  /** Alta: a qué item cuelga. */
  padre: MuestraPadre;
  itemId: string;
  /** Edición: la solicitud existente. */
  solicitud?: MuestraSolicitudDTO;
  onClose: () => void;
  onSaved: () => void;
}

export function MuestraModal({ padre, itemId, solicitud, onClose, onSaved }: Props) {
  const [catalogo, setCatalogo] = useState<ItemDTO[]>([]);
  const [catalogoCargando, setCatalogoCargando] = useState(true);
  useEffect(() => {
    let vivo = true;
    getCatalogoProductos()
      .then(items => { if (vivo) setCatalogo(items); })
      .catch(() => { /* sin catálogo: queda el texto libre */ })
      .finally(() => { if (vivo) setCatalogoCargando(false); });
    return () => { vivo = false; };
  }, []);

  const [fechaEntrega, setFechaEntrega] = useState(solicitud?.fechaEntrega ?? '');
  const [diasRetorno, setDiasRetorno] = useState(solicitud?.diasRetorno != null ? String(solicitud.diasRetorno) : '');
  const [notas, setNotas] = useState(solicitud?.notas ?? '');
  const [renglones, setRenglones] = useState<Renglon[]>(() => (solicitud?.lineas.length
    ? solicitud.lineas.map(l => ({
      key: siguienteKey++, producto: l.producto, productoId: l.productoId, sku: l.sku, marca: l.marca,
      color: l.color, talla: l.talla, cantidad: String(l.cantidad), comentarios: l.comentarios,
    }))
    : [renglonVacio()]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: number, cambios: Partial<Renglon>) =>
    setRenglones(rs => rs.map(r => (r.key === key ? { ...r, ...cambios } : r)));

  const porId = (id: string | null) => (id ? catalogo.find(p => p.id === id) : undefined);

  const llenos = renglones.filter(tieneAlgo);
  const piezas = llenos.reduce((s, r) => s + (Number(r.cantidad) || 0), 0);
  const hayCaptura = llenos.length > 0 || !!fechaEntrega || !!notas.trim();
  const cerrar = () => {
    if (saving) return;
    if (!solicitud && hayCaptura && !window.confirm('¿Cerrar sin guardar la solicitud? Se pierde lo que capturaste.')) return;
    onClose();
  };

  const submit = async () => {
    if (llenos.length === 0) { setError('Agrega al menos un producto.'); return; }
    if (llenos.some(r => !r.producto.trim())) { setError('Cada renglón necesita su producto.'); return; }
    if (llenos.some(r => !(Number(r.cantidad) > 0))) { setError('Cada renglón necesita una cantidad mayor a 0.'); return; }
    setSaving(true);
    setError(null);
    const input = {
      fechaEntrega: fechaEntrega || null,
      diasRetorno: diasRetorno.trim() ? Number(diasRetorno) : null,
      notas: notas.trim() || null,
      lineas: llenos.map(r => ({
        producto: r.producto.trim(), productoId: r.productoId, sku: r.sku || null, marca: r.marca || null,
        color: r.color.trim() || null, talla: r.talla.trim() || null, cantidad: Number(r.cantidad), comentarios: r.comentarios.trim() || null,
      })),
    };
    const res = solicitud ? await editarMuestra(solicitud.id, input) : await crearMuestra({ padre, itemId, ...input });
    setSaving(false);
    if (!res.ok) { setError(res.error ?? 'No se pudo guardar.'); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal
      title={solicitud ? `Editar solicitud ${solicitud.folio}` : 'Nueva solicitud de muestras'}
      onClose={cerrar}
      width={1080}
      closeOnBackdrop={false}
      footer={
        <>
          <span style={{ marginRight: 'auto', font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>
            {llenos.length > 0 ? `${llenos.length} ${llenos.length === 1 ? 'producto' : 'productos'} · ${piezas} ${piezas === 1 ? 'pieza' : 'piezas'}` : ''}
          </span>
          <Button variant="ghost" onClick={saving ? undefined : cerrar}>Cancelar</Button>
          <Button variant="primary" onClick={saving ? undefined : submit} style={saving ? { opacity: .6 } : undefined}>
            {saving ? 'Guardando…' : solicitud ? 'Guardar cambios' : 'Crear solicitud'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ flex: '1 1 160px' }}>
            <div style={labelStyle}>Fecha de entrega de muestras</div>
            <input type="date" value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ flex: '1 1 140px' }}>
            <div style={labelStyle}>Tiempo de retorno (días)</div>
            <input type="number" min={0} max={365} value={diasRetorno} placeholder="Ej. 7" onChange={(e) => setDiasRetorno(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ flex: '3 1 300px' }}>
            <div style={labelStyle}>Notas</div>
            <input value={notas} placeholder="Ej. # de procedimiento, a quién se entregan…" onChange={(e) => setNotas(e.target.value)} style={inputStyle} />
          </label>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {renglones.map((r, n) => {
            const prod = porId(r.productoId);
            const colores = lista(prod?.cols[CATALOGO_COLOR_COL]?.text);
            const tallas = lista(prod?.cols[CATALOGO_TALLAS_COL]?.text);
            return (
              <div
                key={r.key}
                style={{
                  display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end',
                  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 8, background: 'var(--bg-sunken)',
                }}
              >
                <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', fontWeight: 600, padding: '10px 2px', flex: 'none' }}>{n + 1}</div>
                <div style={{ flex: '3 1 260px', minWidth: 0 }}>
                  <div style={labelStyle}>Producto *{r.sku ? <span style={{ color: 'var(--ink-tertiary)' }}> · {r.sku}{r.marca ? ` · ${r.marca}` : ''}</span> : null}</div>
                  <ProductPicker
                    value={r.producto}
                    catalog={catalogo}
                    catalogLoading={catalogoCargando}
                    style={inputStyle}
                    onPick={(choice) => {
                      if ('item' in choice) {
                        set(r.key, {
                          producto: productoNombreCorto(choice.item), productoId: choice.item.id,
                          sku: productoSku(choice.item), marca: productoMarca(choice.item),
                        });
                      } else {
                        set(r.key, { producto: choice.freeText, productoId: null, sku: '', marca: '' });
                      }
                    }}
                  />
                </div>
                <label style={{ flex: '1 1 110px', minWidth: 0 }}>
                  <div style={labelStyle}>Color</div>
                  <input list={`muestra-colores-${r.key}`} value={r.color} onChange={(e) => set(r.key, { color: e.target.value })} style={inputStyle} />
                  <datalist id={`muestra-colores-${r.key}`}>{colores.map(c => <option key={c} value={c} />)}</datalist>
                </label>
                <label style={{ flex: '1 1 90px', minWidth: 0 }}>
                  <div style={labelStyle}>Talla</div>
                  <input list={`muestra-tallas-${r.key}`} value={r.talla} placeholder="Ej. L, 32X30" onChange={(e) => set(r.key, { talla: e.target.value })} style={inputStyle} />
                  <datalist id={`muestra-tallas-${r.key}`}>{tallas.map(t => <option key={t} value={t} />)}</datalist>
                </label>
                <label style={{ flex: '0 1 80px', minWidth: 0 }}>
                  <div style={labelStyle}>Cant.</div>
                  <input type="number" min={1} value={r.cantidad} onChange={(e) => set(r.key, { cantidad: e.target.value })} style={inputStyle} />
                </label>
                <label style={{ flex: '3 1 240px', minWidth: 0 }}>
                  <div style={labelStyle}>Comentarios</div>
                  <input value={r.comentarios} placeholder="Logo, sector, bordados, parche…" onChange={(e) => set(r.key, { comentarios: e.target.value })} style={inputStyle} />
                </label>
                <span
                  onClick={saving ? undefined : () => setRenglones(rs => (rs.length > 1 ? rs.filter(x => x.key !== r.key) : [renglonVacio()]))}
                  title="Quitar este renglón"
                  style={{ cursor: 'pointer', color: 'var(--status-perdida)', font: 'var(--text-label)', padding: '8px 4px' }}
                >
                  ✕
                </span>
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
