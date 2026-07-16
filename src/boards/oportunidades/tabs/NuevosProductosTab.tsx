// Proponer nuevo producto: no "productos propuestos por ventas" data source
// exists on the board yet, so this is a client-side-only placeholder — entries
// live in local state and are lost on refresh until a real endpoint exists.
import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { Button } from '../../../components/core/Button';

interface ProposedProduct {
  id: string;
  nombre: string;
  descripcion: string;
  imageUrl?: string;
}

const fieldStyle: React.CSSProperties = {
  width: '100%', font: 'var(--text-body)', color: 'var(--ink)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '8px 10px', boxSizing: 'border-box', background: 'var(--bg-raised)',
};

const ImageIcon = ({ size = 16, color = '#918b7c' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="1.8" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);

export function NuevosProductosTab() {
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [imageUrl, setImageUrl] = useState<string | undefined>();
  const [products, setProducts] = useState<ProposedProduct[]>([]);

  const onImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImageUrl(typeof reader.result === 'string' ? reader.result : undefined);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const addProduct = () => {
    if (!nombre.trim()) return;
    setProducts((ps) => [...ps, { id: `${Date.now()}`, nombre: nombre.trim(), descripcion: descripcion.trim(), imageUrl }]);
    setNombre('');
    setDescripcion('');
    setImageUrl(undefined);
  };

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-2xl)', background: 'var(--bg-raised)', padding: 20 }}>
        <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)', marginBottom: 16 }}>Proponer nuevo producto</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Producto">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} style={fieldStyle} placeholder="Nombre del producto" />
          </Field>

          <Field label="Descripción de nuevo producto">
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={4}
              style={{ ...fieldStyle, resize: 'vertical' }}
              placeholder="Describe el producto, características y por qué lo propones…"
            />
          </Field>

          <Field label="Imagen">
            <label style={{
              display: 'flex', alignItems: 'center', gap: 10, border: '1px dashed var(--ink-faint)', borderRadius: 'var(--radius-lg)',
              padding: '10px 12px', cursor: 'pointer', background: 'var(--bg)',
            }}>
              <ImageIcon />
              <span style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>{imageUrl ? 'Imagen seleccionada — cambiar' : 'Subir imagen'}</span>
              <input type="file" accept="image/*" onChange={onImageChange} style={{ display: 'none' }} />
            </label>
            {imageUrl && (
              <img src={imageUrl} alt="" style={{ marginTop: 10, maxHeight: 120, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }} />
            )}
          </Field>

          <div>
            <Button variant="primary" onClick={addProduct}>Agregar producto</Button>
          </div>
        </div>
      </div>

      <div>
        <div style={{
          font: 'var(--text-eyebrow)', color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '.5px',
          background: 'var(--bg-sunken)', padding: '10px 16px', borderRadius: products.length > 0 ? 'var(--radius-xl) var(--radius-xl) 0 0' : 'var(--radius-xl)',
        }}>
          Productos propuestos
        </div>

        {products.length > 0 ? (
          <div style={{ border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 var(--radius-xl) var(--radius-xl)', overflow: 'hidden' }}>
            {products.map((p, i) => (
              <div key={p.id} style={{
                display: 'flex', gap: 12, padding: '14px 16px', background: 'var(--bg-raised)',
                borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)',
              }}>
                {p.imageUrl && (
                  <img src={p.imageUrl} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', flex: 'none' }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{p.nombre}</div>
                  {p.descripcion && (
                    <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', marginTop: 2 }}>{p.descripcion}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', padding: '14px 16px' }}>
            Ventas aún no ha propuesto productos nuevos para esta oportunidad.
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ font: 'var(--text-eyebrow)', color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}
