// Catálogo de almacenes: lista los activos y permite agregar uno nuevo (nombre + tipo
// bodega/vendedor + ubicación opcional) sin tocar D1 a mano. Ver shared/inventory.ts.
import { useEffect, useState } from 'react';
import { Select } from '../../../components/forms/Select';
import { Button } from '../../../components/core/Button';
import type { WarehouseType } from '../../../../shared/inventory';
import { createWarehouse, getWarehouses, type WarehouseDTO } from '../../../lib/inventoryApi';

const fieldStyle: React.CSSProperties = {
  width: '100%', font: 'var(--text-body)', color: 'var(--ink)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '8px 10px', boxSizing: 'border-box',
};

const TYPE_OPTIONS: { value: WarehouseType; label: string }[] = [
  { value: 'bodega', label: 'Bodega' },
  { value: 'person', label: 'Vendedor' },
];

export function AlmacenesTab({ refreshToken }: { refreshToken: number }) {
  const [warehouses, setWarehouses] = useState<WarehouseDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [type, setType] = useState<WarehouseType>('bodega');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setLoading(true);
    getWarehouses().then(setWarehouses).catch(() => setWarehouses([])).finally(() => setLoading(false));
  }, [refreshToken, version]);

  const onSubmit = async () => {
    setError(null);
    if (!name.trim()) return setError('El nombre del almacén es requerido.');

    setSaving(true);
    try {
      const res = await createWarehouse({ name: name.trim(), type, location: location.trim() || undefined });
      if (!res.ok) { setError(res.error ?? 'No se pudo guardar el almacén.'); return; }
      setName('');
      setLocation('');
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el almacén.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '20px 32px 32px', maxWidth: 640 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 380, marginBottom: 28 }}>
        <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink)' }}>Agregar almacén</div>

        <Field label="Nombre" required>
          <input value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} placeholder="p. ej. Mérida" />
        </Field>

        <Field label="Tipo" required>
          <Select value={type} onChange={(v) => setType(v as WarehouseType)} options={TYPE_OPTIONS} />
        </Field>

        <Field label="Ubicación">
          <input value={location} onChange={(e) => setLocation(e.target.value)} style={fieldStyle} placeholder="Opcional" />
        </Field>

        {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}

        <div>
          <Button variant="primary" onClick={saving ? undefined : onSubmit}>{saving ? 'Guardando…' : 'Agregar almacén'}</Button>
        </div>
      </div>

      <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink)', marginBottom: 10 }}>Almacenes activos</div>
      {loading ? (
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Cargando…</div>
      ) : warehouses.length === 0 ? (
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin almacenes activos.</div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
          {warehouses.map((w) => (
            <div
              key={w.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', font: 'var(--text-label)',
              }}
            >
              <span style={{ color: 'var(--ink)' }}>{w.name}</span>
              <span style={{ color: 'var(--ink-tertiary)' }}>
                {w.type === 'bodega' ? 'Bodega' : 'Vendedor'}{w.location ? ` · ${w.location}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
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
