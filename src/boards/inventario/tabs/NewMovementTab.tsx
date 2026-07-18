// Nuevo movimiento: Origin/Destination show/hide per shared/inventory.ts's
// movementFieldVisibility. Consolidación is bidirectional (2026-07-15 decision) — an
// extra "Dirección" choice decides whether it's Origin (ajuste a la baja) or
// Destination (ajuste al alza) that's actually shown, since the type alone doesn't say.
import { useEffect, useState } from 'react';
import { Select } from '../../../components/forms/Select';
import { SearchInput } from '../../../components/forms/SearchInput';
import { Button } from '../../../components/core/Button';
import {
  MOVEMENT_TYPES, movementFieldVisibility, validateMovementEndpoints,
  type MovementType,
} from '../../../../shared/inventory';
import { createMovement, getWarehouses, type WarehouseDTO } from '../../../lib/inventoryApi';
import { usePoll, type ItemDTO } from '../../../lib/api';

const fieldStyle: React.CSSProperties = {
  width: '100%', font: 'var(--text-body)', color: 'var(--ink)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '8px 10px', boxSizing: 'border-box',
};

const TYPE_OPTIONS = MOVEMENT_TYPES.map((t) => ({ value: t, label: t }));
const DIRECTION_OPTIONS = [
  { value: 'up', label: 'Ajuste al alza (entra stock)' },
  { value: 'down', label: 'Ajuste a la baja (sale stock)' },
];

export function NewMovementTab({ onCreated }: { onCreated: () => void }) {
  const [warehouses, setWarehouses] = useState<WarehouseDTO[]>([]);
  const [type, setType] = useState<MovementType>('Entrada');
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [producto, setProducto] = useState<ItemDTO | null>(null);
  const [productQuery, setProductQuery] = useState('');
  const { data: productData } = usePoll('productos', productQuery);
  const productOptions = productData?.items ?? [];
  const [quantity, setQuantity] = useState('');
  const [originId, setOriginId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [capturedBy, setCapturedBy] = useState('');
  const [folio, setFolio] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getWarehouses().then(setWarehouses).catch(() => setWarehouses([])); }, []);

  const isConsolidacion = type === 'Consolidación';
  const visibility = movementFieldVisibility(type);
  const showOrigin = isConsolidacion ? direction === 'down' : visibility.origin;
  const showDestination = isConsolidacion ? direction === 'up' : visibility.destination;
  const warehouseOptions = warehouses.map((w) => ({ value: String(w.id), label: `${w.name} · ${w.type === 'bodega' ? 'Bodega' : 'Vendedor'}` }));

  const resetEndpoints = () => { setOriginId(''); setDestinationId(''); };

  const onSubmit = async () => {
    setError(null);
    const qty = Number(quantity);
    if (!producto) return setError('El producto es requerido.');
    if (!Number.isFinite(qty) || qty <= 0) return setError('La cantidad debe ser mayor a 0.');
    if (!capturedBy.trim()) return setError('Falta quién captura el movimiento.');

    const origin = showOrigin && originId ? Number(originId) : null;
    const destination = showDestination && destinationId ? Number(destinationId) : null;
    const shapeError = validateMovementEndpoints(type, origin, destination);
    if (shapeError) return setError(shapeError);

    setSaving(true);
    try {
      const res = await createMovement({
        type, productName: producto!.name, quantity: qty, originId: origin, destinationId: destination,
        capturedBy: capturedBy.trim(), folio: folio.trim() || undefined, notes: notes.trim() || undefined,
      });
      if (!res.ok) { setError(res.error ?? 'No se pudo guardar el movimiento.'); return; }
      setProducto(null);
      setProductQuery('');
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el movimiento.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '20px 32px 32px', maxWidth: 460 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Tipo" required>
          <Select
            value={type}
            onChange={(v) => { setType(v as MovementType); setDirection('up'); resetEndpoints(); }}
            options={TYPE_OPTIONS}
          />
        </Field>

        {isConsolidacion && (
          <Field label="Dirección del ajuste" required>
            <Select value={direction} onChange={(v) => { setDirection(v as 'up' | 'down'); resetEndpoints(); }} options={DIRECTION_OPTIONS} />
            <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)', marginTop: 6 }}>
              Consolidación corrige el conteo físico contra el sistema: usa "al alza" cuando encuentras más
              piezas de las que el sistema tiene registradas, y "a la baja" cuando encuentras menos.
            </div>
          </Field>
        )}

        <Field label="Producto" required>
          {producto ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '8px 12px',
            }}>
              <span style={{ font: 'var(--text-body)', color: 'var(--ink)' }}>{producto.name}</span>
              <span onClick={() => setProducto(null)} style={{ cursor: 'pointer', color: 'var(--accent)', font: 'var(--text-caption)' }}>Cambiar</span>
            </div>
          ) : (
            <>
              <SearchInput value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Buscar producto…" style={{ maxWidth: 'none' }} />
              <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginTop: 6 }}>
                {productOptions.length === 0 ? (
                  <div style={{ padding: 10, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin resultados.</div>
                ) : productOptions.map((p) => (
                  <div
                    key={p.id}
                    className="row-hover"
                    onClick={() => { setProducto(p); setProductQuery(''); }}
                    style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', font: 'var(--text-label)', color: 'var(--ink)', cursor: 'pointer' }}
                  >
                    {p.name}
                  </div>
                ))}
              </div>
            </>
          )}
        </Field>

        <Field label="Cantidad" required>
          <input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} style={fieldStyle} placeholder="0" />
        </Field>

        {showOrigin && (
          <Field label="Almacén de origen" required>
            <Select value={originId} onChange={setOriginId} options={warehouseOptions} placeholder="Elegir almacén de origen…" />
          </Field>
        )}

        {showDestination && (
          <Field label="Almacén de destino" required>
            <Select value={destinationId} onChange={setDestinationId} options={warehouseOptions} placeholder="Elegir almacén de destino…" />
          </Field>
        )}

        <Field label="Capturó" required>
          <input value={capturedBy} onChange={(e) => setCapturedBy(e.target.value)} style={fieldStyle} placeholder="Nombre de quien captura" />
        </Field>

        <Field label="Folio">
          <input value={folio} onChange={(e) => setFolio(e.target.value)} style={fieldStyle} placeholder="Opcional" />
        </Field>

        <Field label="Notas">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={fieldStyle} placeholder="Opcional" />
        </Field>

        {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}

        <div>
          <Button variant="primary" onClick={saving ? undefined : onSubmit}>{saving ? 'Guardando…' : 'Registrar movimiento'}</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink-secondary)', marginBottom: 6 }}>
        {label}{required ? ' *' : ''}
      </div>
      {children}
    </div>
  );
}
