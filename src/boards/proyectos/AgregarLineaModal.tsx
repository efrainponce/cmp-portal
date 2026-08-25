// Línea manual del Proyecto — Compras agrega un producto que faltó en el
// desglose de tallas o una compra independiente, sin tocar el Sheet importado.
// Se abre desde dos lados (Efraín, 2026-08-25): el botón de arriba del tab
// (sin proveedor, para levantar la tarjeta de uno que todavía no tiene
// líneas) y el de CADA tarjeta de proveedor, que llega con `proveedorInicial`
// puesto — es ahí, viendo la OC de ese proveedor, donde salta la necesidad de
// pedirle una aplicación, una maquila o un flete que la cotización no traía.
// Con Proveedor puesto, "Generar OC por proveedor" (only_proveedor) ya la
// toma para una OC real (Efraín, 2026-07-17). Desde 2026-08-18 el alta lleva
// también costo/descuento/moneda: es el camino para levantar una OC de un
// producto que NUNCA estuvo en la cotización, y sin costo el PDF de la OC
// saldría en ceros.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Modal } from '../../components/core/Modal';
import { Button } from '../../components/core/Button';
import { SearchInput } from '../../components/forms/SearchInput';
import { usePoll, addProyectoLinea, SOLO_NOMBRE } from '../../lib/api';
import { pctToFraccion } from '../../../shared/descuento';

/** Solo id+nombre: la tarjeta de la OC agrupa por proveedor y no tiene el
 * ItemDTO completo del catálogo a la mano, solo esos dos datos. */
export interface ProveedorRef { id: string; name: string }

interface Props {
  proyectoId: string;
  /** Proveedor ya elegido (alta desde la tarjeta de ese proveedor). */
  proveedorInicial?: ProveedorRef;
  onClose: () => void;
  onCreated: () => void;
}

export function AgregarLineaModal({ proyectoId, proveedorInicial, onClose, onCreated }: Props) {
  const [producto, setProducto] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [talla, setTalla] = useState('');
  const [color, setColor] = useState('');
  const [sku, setSku] = useState('');
  const [costo, setCosto] = useState('');
  const [descuento, setDescuento] = useState('');
  const [moneda, setMoneda] = useState('');
  const [proveedor, setProveedor] = useState<ProveedorRef | null>(proveedorInicial ?? null);
  const [q, setQ] = useState('');
  const { data } = usePoll('proveedores', q, SOLO_NOMBRE);
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
      costo: costo.trim() ? Number(costo) : undefined,
      // La columna guarda FRACCIÓN 0-1 y aquí se teclea el porcentaje: sin
      // esta conversión un "10" salía como 1000% y el PDF de la OC daba
      // importes negativos (shared/descuento.ts).
      descuento: descuento.trim() ? Number(pctToFraccion(descuento)) : undefined,
      moneda: moneda.trim() || undefined,
    });
    setSaving(false);
    if (!res.ok) { setError(res.error ?? 'No se pudo guardar.'); return; }
    onCreated();
    onClose();
  };

  return (
    <Modal
      title={proveedorInicial ? `Agregar línea — ${proveedorInicial.name}` : 'Agregar línea manual'}
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
          Para lo que no venía en la cotización — una aplicación, una maquila, un flete o un producto que faltó en el desglose de tallas.
          El nombre es texto libre (no sale del catálogo) y no toca el archivo de tallas ni sus cantidades.
          {proveedorInicial
            ? ` Entra en la OC de ${proveedorInicial.name} con el costo que captures aquí.`
            : ' Con Proveedor puesto aparece en la OC de ese proveedor; si es uno que no tenía líneas, se abre una tarjeta nueva.'}
        </div>
        <Field label="Producto o concepto *">
          <input
            value={producto} onChange={(e) => setProducto(e.target.value)}
            placeholder="Ej. Aplicación de logo bordado"
            title="Texto libre — no tiene que existir en el catálogo"
            style={inputStyle}
          />
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Cantidad"><input value={cantidad} onChange={(e) => setCantidad(e.target.value)} type="number" style={inputStyle} /></Field>
          <Field label="Talla"><input value={talla} onChange={(e) => setTalla(e.target.value)} style={inputStyle} /></Field>
          <Field label="Color"><input value={color} onChange={(e) => setColor(e.target.value)} style={inputStyle} /></Field>
        </div>
        <Field label="SKU">
          <input value={sku} onChange={(e) => setSku(e.target.value)} style={inputStyle} />
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Costo Distr. C/U"><input value={costo} onChange={(e) => setCosto(e.target.value)} type="number" style={inputStyle} /></Field>
          <Field label="Descuento %"><input value={descuento} onChange={(e) => setDescuento(e.target.value)} type="number" placeholder="0" title="En porcentaje: 18 = 18%" style={inputStyle} /></Field>
          <Field label="Moneda"><input value={moneda} onChange={(e) => setMoneda(e.target.value)} placeholder="MXN" style={inputStyle} /></Field>
        </div>

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
