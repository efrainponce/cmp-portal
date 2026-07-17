// Línea manual del Proyecto — Compras agrega un producto que faltó en el
// desglose de tallas o una compra independiente, sin tocar el Sheet importado.
// Con Proveedor puesto, "Generar OC por proveedor" (only_proveedor) ya la
// toma para una OC real (Efraín, 2026-07-17).
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Modal } from '../../components/core/Modal';
import { Button } from '../../components/core/Button';
import { SearchInput } from '../../components/forms/SearchInput';
import { usePoll, addProyectoLinea, type ItemDTO } from '../../lib/api';

interface Props {
  proyectoId: string;
  onClose: () => void;
  onCreated: () => void;
}

export function AgregarLineaModal({ proyectoId, onClose, onCreated }: Props) {
  const [producto, setProducto] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [talla, setTalla] = useState('');
  const [color, setColor] = useState('');
  const [sku, setSku] = useState('');
  const [proveedor, setProveedor] = useState<ItemDTO | null>(null);
  const [q, setQ] = useState('');
  const { data } = usePoll('proveedores', q);
  const opciones = data?.items ?? [];
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!producto.trim()) { setError('El producto es obligatorio.'); return; }
    setSaving(true);
    setError(null);
    const res = await addProyectoLinea(proyectoId, {
      producto: producto.trim(),
      proveedorId: proveedor?.id,
      cantidad: cantidad.trim() ? Number(cantidad) : undefined,
      talla: talla.trim() || undefined,
      color: color.trim() || undefined,
      sku: sku.trim() || undefined,
    });
    setSaving(false);
    if (!res.ok) { setError(res.error ?? 'No se pudo guardar.'); return; }
    onCreated();
    onClose();
  };

  return (
    <Modal
      title="Agregar línea manual"
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={saving ? undefined : onClose}>Cancelar</Button>
          <Button variant="primary" onClick={saving ? undefined : submit} style={saving ? { opacity: .6 } : undefined}>
            {saving ? 'Guardando…' : 'Agregar línea'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
          Para un producto que faltó en el desglose de tallas o una compra independiente — no toca el archivo de tallas ni sus cantidades.
        </div>
        <Field label="Producto *">
          <input value={producto} onChange={(e) => setProducto(e.target.value)} style={inputStyle} />
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Cantidad"><input value={cantidad} onChange={(e) => setCantidad(e.target.value)} type="number" style={inputStyle} /></Field>
          <Field label="Talla"><input value={talla} onChange={(e) => setTalla(e.target.value)} style={inputStyle} /></Field>
          <Field label="Color"><input value={color} onChange={(e) => setColor(e.target.value)} style={inputStyle} /></Field>
        </div>
        <Field label="SKU">
          <input value={sku} onChange={(e) => setSku(e.target.value)} style={inputStyle} />
        </Field>

        <div>
          <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink)', marginBottom: 6 }}>Proveedor</div>
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
              <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginTop: 6 }}>
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

        {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', font: 'var(--text-label)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '8px 10px',
};
