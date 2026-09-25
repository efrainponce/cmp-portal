// Proponer nuevo producto (2026-07-30): persiste en D1 vía worker/lib/
// productosPropuestos.ts — no hay board de Monday detrás (nombre+descripción+
// imagen no encajan en ninguna columna existente). El POST también avisa a
// Compras (update de Monday con @mención + notificación del portal).
// Desde 2026-09-25 (pedido de un vendedor) cada propuesta se EDITA (nombre,
// descripción, cambiar/quitar imagen) y se ELIMINA, y la imagen se abre en
// grande en el visor del portal (FilePreviewModal).
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  addProposedProduct, deleteProposedProduct, getProposedProducts, updateProposedProduct, type ProposedProductDTO,
} from '../../../lib/apiClient';
import { Button } from '../../../components/core/Button';
import { ConfirmButton } from '../../../components/core/ConfirmButton';
import { FilePreviewModal } from '../../../components/core/FilePreviewModal';

const fieldStyle: React.CSSProperties = {
  width: '100%', font: 'var(--text-body)', color: 'var(--ink)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '8px 10px', boxSizing: 'border-box', background: 'var(--bg-raised)',
};

const ImageIcon = ({ size = 16, color = 'var(--ink-tertiary)' }: { size?: number; color?: string }) => (
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
  const [editingId, setEditingId] = useState<string | undefined>();
  const [viewer, setViewer] = useState<{ url: string; name: string } | undefined>();

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
    readPreview(file, setImagePreview);
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
              {imagePreview && imageFile && (
                <img
                  src={imagePreview} alt="" title="Ver en grande"
                  onClick={() => setViewer({ url: imagePreview, name: imageFile.name })}
                  style={{ marginTop: 10, maxHeight: 120, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', cursor: 'zoom-in' }}
                />
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
              <PropuestaRow
                key={p.id}
                oppId={oppId}
                producto={p}
                first={i === 0}
                readOnly={readOnly}
                editing={editingId === p.id}
                onEdit={() => setEditingId(p.id)}
                onCancel={() => setEditingId(undefined)}
                onSaved={(np) => { setProducts((ps) => ps.map((x) => (x.id === np.id ? np : x))); setEditingId(undefined); }}
                onDeleted={() => setProducts((ps) => ps.filter((x) => x.id !== p.id))}
                onOpenImage={(url) => setViewer({ url, name: imageName(p) })}
              />
            ))}
          </div>
        ) : (
          <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', padding: '14px 16px' }}>
            Ventas aún no ha propuesto productos nuevos para esta oportunidad.
          </div>
        )}
      </div>

      {viewer && <FilePreviewModal url={viewer.url} name={viewer.name} onClose={() => setViewer(undefined)} />}
    </div>
  );
}

function readPreview(file: File, set: (url: string | undefined) => void) {
  const reader = new FileReader();
  reader.onload = () => set(typeof reader.result === 'string' ? reader.result : undefined);
  reader.readAsDataURL(file);
}

/** Nombre para el visor: el del producto + la extensión de la imagen (el
 * visor decide por la extensión si la dibuja como imagen). */
function imageName(p: ProposedProductDTO): string {
  const ext = p.imageUrl?.split('?')[0].split('.').pop()?.toLowerCase() ?? 'jpg';
  return `${p.nombre}.${ext}`;
}

function PropuestaRow({ oppId, producto: p, first, readOnly, editing, onEdit, onCancel, onSaved, onDeleted, onOpenImage }: {
  oppId: string;
  producto: ProposedProductDTO;
  first: boolean;
  readOnly: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: (p: ProposedProductDTO) => void;
  onDeleted: () => void;
  onOpenImage: (url: string) => void;
}) {
  const [nombre, setNombre] = useState(p.nombre);
  const [descripcion, setDescripcion] = useState(p.descripcion);
  const [file, setFile] = useState<File | undefined>();
  const [preview, setPreview] = useState<string | undefined>();
  const [quitar, setQuitar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Cada vez que se abre la edición arranca de lo guardado.
  useEffect(() => {
    if (!editing) return;
    setNombre(p.nombre);
    setDescripcion(p.descripcion);
    setFile(undefined);
    setPreview(undefined);
    setQuitar(false);
    setError(undefined);
  }, [editing, p]);

  const shownImage = editing ? (preview ?? (quitar ? undefined : p.imageUrl)) : p.imageUrl;

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f);
    setQuitar(false);
    readPreview(f, setPreview);
  };

  const save = async () => {
    if (!nombre.trim() || saving) return;
    setSaving(true);
    setError(undefined);
    const r = await updateProposedProduct(oppId, p.id, nombre.trim(), descripcion.trim(), { file, quitar });
    setSaving(false);
    if (!r.ok || !r.producto) { setError(r.error ?? 'No se pudo guardar el producto.'); return; }
    onSaved(r.producto);
  };

  const remove = async () => {
    const r = await deleteProposedProduct(oppId, p.id);
    if (!r.ok) { setError(r.error); return; }
    onDeleted();
  };

  return (
    <div style={{
      display: 'flex', gap: 12, padding: '14px 16px', background: 'var(--bg-raised)',
      borderTop: first ? 'none' : '1px solid var(--border-subtle)', alignItems: 'flex-start',
    }}>
      {shownImage ? (
        <img
          src={shownImage} alt="" title="Ver en grande"
          onClick={() => onOpenImage(shownImage)}
          style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', flex: 'none', cursor: 'zoom-in' }}
        />
      ) : editing ? (
        <div style={{ width: 64, height: 64, borderRadius: 'var(--radius-lg)', border: '1px dashed var(--ink-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <ImageIcon size={20} />
        </div>
      ) : null}

      {editing ? (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} style={fieldStyle} placeholder="Nombre del producto" disabled={saving} />
          <textarea
            value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3}
            style={{ ...fieldStyle, resize: 'vertical' }} placeholder="Descripción" disabled={saving}
          />
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ font: 'var(--text-label)', color: 'var(--accent)', cursor: saving ? 'default' : 'pointer' }}>
              {shownImage ? 'Cambiar imagen' : 'Subir imagen'}
              <input type="file" accept="image/*" onChange={onPick} style={{ display: 'none' }} disabled={saving} />
            </label>
            {shownImage && (
              <span
                onClick={() => { if (!saving) { setFile(undefined); setPreview(undefined); setQuitar(true); } }}
                style={{ font: 'var(--text-label)', color: 'var(--status-perdida)', cursor: saving ? 'default' : 'pointer' }}
              >
                Quitar imagen
              </span>
            )}
          </div>
          {error && <div style={{ font: 'var(--text-label)', color: 'var(--status-perdida)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant={saving || !nombre.trim() ? 'disabled' : 'primary'} onClick={save}>{saving ? 'Guardando…' : 'Guardar'}</Button>
            <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{p.nombre}</div>
            {p.descripcion && (
              <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{p.descripcion}</div>
            )}
            {error && <div style={{ font: 'var(--text-label)', color: 'var(--status-perdida)', marginTop: 4 }}>{error}</div>}
          </div>
          {!readOnly && (
            <div style={{ display: 'flex', gap: 6, flex: 'none', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={onEdit}>Editar</Button>
              <ConfirmButton label="Eliminar" confirmLabel="¿Eliminar?" busyLabel="Eliminando…" variant="danger" onConfirm={remove} />
            </div>
          )}
        </>
      )}
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
