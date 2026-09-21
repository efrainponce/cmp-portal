// "Crear orden de compra" — la OC manual de un jalón (Efraín, 2026-09-21: "debe
// tener una opción fácil… solo: CREAR orden de compra"). Antes había que abrir
// "+ Agregar producto (otro proveedor)" UNA VEZ POR LÍNEA, con el proveedor
// vuelto a buscar en cada vuelta. Aquí: un proveedor, N renglones de texto
// libre, guardar. No hay endpoint nuevo: cada renglón es el mismo alta de línea
// manual (`POST /api/proyectos/:id/lineas`), de a una y en orden, para que la
// OC salga en el orden en que se capturó. La tarjeta del proveedor aparece con
// sus líneas y de ahí se genera el PDF como siempre.
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Modal } from '../../components/core/Modal';
import { Button } from '../../components/core/Button';
import { SearchInput } from '../../components/forms/SearchInput';
import { usePoll, addProyectoLinea, SOLO_NOMBRE } from '../../lib/api';
import { fmtMoney } from '../../lib/format';
import { pctToFraccion } from '../../../shared/descuento';
import type { ProveedorRef } from './AgregarLineaModal';

interface Renglon {
  key: number;
  producto: string; sku: string; color: string; talla: string; unidad: string;
  cantidad: string; costo: string; descuento: string;
}

let siguienteKey = 1;
const renglonVacio = (): Renglon => ({
  key: siguienteKey++, producto: '', sku: '', color: '', talla: '', unidad: '',
  cantidad: '', costo: '', descuento: '',
});

const tieneAlgo = (r: Renglon) =>
  [r.producto, r.sku, r.color, r.talla, r.unidad, r.cantidad, r.costo, r.descuento].some(v => v.trim() !== '');

const CAMPOS: { campo: keyof Omit<Renglon, 'key'>; label: string; flex: string; type?: 'number'; placeholder?: string }[] = [
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
  const { data } = usePoll('proveedores', q, SOLO_NOMBRE);
  const opciones = data?.items ?? [];
  const [moneda, setMoneda] = useState('MXN');
  const [renglones, setRenglones] = useState<Renglon[]>(() => [renglonVacio()]);
  const [saving, setSaving] = useState(false);
  const [progreso, setProgreso] = useState('');
  const [error, setError] = useState<string | null>(null);

  const set = (key: number, campo: keyof Omit<Renglon, 'key'>, v: string) =>
    setRenglones(rs => rs.map(r => (r.key === key ? { ...r, [campo]: v } : r)));

  const llenos = renglones.filter(tieneAlgo);
  const subtotal = llenos.reduce((s, r) => {
    const desc = Number(pctToFraccion(r.descuento || '0')) || 0;
    return s + (Number(r.cantidad) || 0) * (Number(r.costo) || 0) * (1 - desc);
  }, 0);

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
      onClose={saving ? () => { /* a medio guardar no se cierra */ } : onClose}
      width={1080}
      footer={
        <>
          <span style={{ marginRight: 'auto', font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>
            {progreso || (llenos.length > 0
              ? `${llenos.length} ${llenos.length === 1 ? 'línea' : 'líneas'} · subtotal ${fmtMoney(subtotal)} ${moneda}`
              : '')}
          </span>
          <Button variant="ghost" onClick={saving ? undefined : onClose}>Cancelar</Button>
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
                <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor…" style={{ maxWidth: 'none' }} />
                <div style={{ maxHeight: 140, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginTop: 6 }}>
                  {opciones.length === 0 ? (
                    <div style={{ padding: 10, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin resultados.</div>
                  ) : opciones.map((p) => (
                    <div
                      key={p.id}
                      className="row-hover"
                      onClick={() => setProveedor(p)}
                      style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', font: 'var(--text-label)', color: 'var(--ink)', cursor: 'pointer' }}
                    >
                      {p.name}
                    </div>
                  ))}
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
          {renglones.map((r, n) => (
            <div
              key={r.key}
              style={{
                display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end',
                border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 8,
                background: 'var(--bg-sunken)',
              }}
            >
              {CAMPOS.map(c => (
                <label key={c.campo} style={{ flex: c.flex, minWidth: 0, display: 'block' }}>
                  <div style={labelStyle}>{c.label}</div>
                  <input
                    autoFocus={n === renglones.length - 1 && c.campo === 'producto' && n > 0}
                    value={r[c.campo]}
                    type={c.type ?? 'text'}
                    min={c.type === 'number' ? 0 : undefined}
                    placeholder={c.placeholder}
                    onChange={(e) => set(r.key, c.campo, e.target.value)}
                    style={inputStyle}
                  />
                </label>
              ))}
              <span
                onClick={saving ? undefined : () => setRenglones(rs => (rs.length > 1 ? rs.filter(x => x.key !== r.key) : [renglonVacio()]))}
                title="Quitar este renglón"
                style={{ cursor: 'pointer', color: 'var(--status-perdida)', font: 'var(--text-label)', padding: '8px 4px' }}
              >
                ✕
              </span>
            </div>
          ))}
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

const labelStyle: CSSProperties = { font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 4 };

const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', font: 'var(--text-label)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '8px 10px',
  background: 'var(--bg-raised)',
};
