// Proponer nuevo producto (2026-07-30): persiste en D1 vía worker/lib/
// productosPropuestos.ts — no hay board de Monday detrás (nombre+descripción+
// imagen no encajan en ninguna columna existente). El POST también avisa a
// Compras (update de Monday con @mención + notificación del portal).
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { addProposedProduct, getProposedProducts, type ProposedProductDTO } from '../../../lib/apiClient';
import { Button } from '../../../components/core/Button';

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

export function NuevosProductosTab({ oppId, readOnly = false }: { oppId: string; readOnly?: boolean }) {
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [imageFile, setImageFile] = useState<File | undefined>();
  const [imagePreview, setImagePreview] = useState<string | undefined>();
  const [products, setProducts] = useState<ProposedProductDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getProposedProducts(oppId)
      .then((ps) => { if (!cancelled) setProducts(ps); })
      .catch(() => { if (!cancelled) setError('No se pudieron cargar los productos propuestos.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [oppId]);

  const onImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(typeof reader.result === 'string' ? reader.result : undefined);
    reader.readAsDataURL(file);
  };

  const addProduct = async () => {
    if (!nombre.trim() || saving) return;
    setSaving(true);
    setError(undefined);
    const result = await addProposedProduct(oppId, nombre.trim(), descripcion.trim(), imageFile);
    setSaving(false);
    if (!result.ok || !result.producto) {
      setError(result.error ?? 'No se pudo guardar el producto.');
      return;
    }
    setProducts((ps) => [...ps, result.producto!]);
    setNombre('');
    setDescripcion('');
    setImageFile(undefined);
    setImagePreview(undefined);
  };

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {!readOnly && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-2xl)', background: 'var(--bg-raised)', padding: 20 }}>
          <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)', marginBottom: 16 }}>Proponer nuevo producto</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Producto">
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} style={fieldStyle} placeholder="Nombre del producto" disabled={saving} />
            </Field>

            <Field label="Descripción de nuevo producto">
              <textarea
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                rows={4}
                style={{ ...fieldStyle, resize: 'vertical' }}
                placeholder="Describe el producto, características y por qué lo propones…"
                disabled={saving}
              />
            </Field>

            <Field label="Imagen">
              <label style={{
                display: 'flex', alignItems: 'center', gap: 10, border: '1px dashed var(--ink-faint)', borderRadius: 'var(--radius-lg)',
                padding: '10px 12px', cursor: saving ? 'default' : 'pointer', background: 'var(--bg)', opacity: saving ? 0.6 : 1,
              }}>
                <ImageIcon />
                <span style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>{imagePreview ? 'Imagen seleccionada — cambiar' : 'Subir imagen'}</span>
                <input type="file" accept="image/*" onChange={onImageChange} style={{ display: 'none' }} disabled={saving} />
              </label>
              {imagePreview && (
                <img src={imagePreview} alt="" style={{ marginTop: 10, maxHeight: 120, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }} />
              )}
            </Field>

            {error && (
              <div style={{ font: 'var(--text-label)', color: 'var(--status-perdida)' }}>{error}</div>
            )}

            <div>
              <Button variant={saving || !nombre.trim() ? 'disabled' : 'primary'} onClick={addProduct}>
                {saving ? 'Guardando…' : 'Agregar producto'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div>
        <div style={{
          font: 'var(--text-eyebrow)', color: 'var(--ink-tertiary)', textTransform: 'uppercase', letterSpacing: '.5px',
          background: 'var(--bg-sunken)', padding: '10px 16px', borderRadius: products.length > 0 ? 'var(--radius-xl) var(--radius-xl) 0 0' : 'var(--radius-xl)',
        }}>
          Productos propuestos
        </div>

        {loading ? (
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', padding: '14px 16px' }}>Cargando…</div>
        ) : products.length > 0 ? (
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
