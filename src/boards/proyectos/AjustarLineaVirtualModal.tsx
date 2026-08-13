// "Ajustar línea" desde el Proyecto (Efraín, 2026-08-10). Calcado de
// AjustarLineaModal.tsx (Oportunidades) pero sobre datos planos
// (QuoteLineSnapshot) en vez de columnas de Monday (ItemDTO); guarda vía
// ajustarLineaVirtual, que desde 2026-08-13 SÍ escribe a Monday (reusa el
// motor de "Ajustar línea" — worker/lib/proyectoCotizacionVirtual.ts). El
// precio de venta NUNCA se toca aquí, por eso ni siquiera se muestra el campo.
import { useState } from 'react';
import type { CostoDivergenciaDTO, ItemDTO, QuoteLineSnapshot } from '../../lib/api';
import { ajustarLineaVirtual } from '../../lib/apiClient';
import { Button } from '../../components/core/Button';
import { Modal } from '../../components/core/Modal';
import { ProductPicker, type ProductoChoice } from '../../components/forms/ProductPicker';

const EMB_LABEL_CON = 'Con Embellecimiento';
const EMB_LABEL_SIN = 'Sin Embellecimiento';

const fieldInputStyle: React.CSSProperties = {
  width: '100%', font: 'var(--text-label)', color: 'var(--ink)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
  padding: '7px 9px', boxSizing: 'border-box',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        font: '700 10px \'Inter\', sans-serif', color: 'var(--ink-tertiary)',
        textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 4,
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, padding: '8px 10px', borderRadius: 'var(--radius-md)',
        border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? 'var(--ink-on-accent)' : 'var(--ink)',
        font: 'var(--text-label-strong)', cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export function AjustarLineaVirtualModal({
  proyectoId, lineaId, linea, catalog, catalogLoading, onClose, onSaved,
}: {
  proyectoId: string;
  lineaId: number;
  linea: QuoteLineSnapshot;
  catalog: ItemDTO[];
  catalogLoading: boolean;
  onClose: () => void;
  onSaved: (divergencia?: CostoDivergenciaDTO) => void;
}) {
  const cantidadActual = linea.cantidad;
  const [modo, setModo] = useState<'editar' | 'dividir'>('editar');
  const [cantidad, setCantidad] = useState(String(cantidadActual || ''));
  const [producto, setProducto] = useState<ProductoChoice | null>(null);
  const [color, setColor] = useState(linea.color ?? '');
  const [conEmbellecimiento, setConEmbellecimiento] = useState(linea.embellecimiento);
  const [descripcion, setDescripcion] = useState(linea.descripcionEmbellecimiento ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const cantidadNum = Number(cantidad);
  const cantidadValida = Number.isFinite(cantidadNum) && cantidadNum > 0
    && (modo === 'editar' || cantidadNum < cantidadActual);

  const onSubmit = async () => {
    if (!cantidadValida) { setError('Cantidad inválida.'); return; }
    setSaving(true);
    setError(undefined);
    try {
      const res = await ajustarLineaVirtual(proyectoId, lineaId, {
        modo,
        cantidad: cantidadNum,
        productoId: producto && 'item' in producto ? Number(producto.item.id) : undefined,
        productoNombre: producto && 'item' in producto ? producto.item.name : undefined,
        color,
        embellecimiento: { estado: conEmbellecimiento ? 'con' : 'sin', descripcion },
      });
      if (!res.ok) { setError(res.error ?? 'No se pudo guardar.'); return; }
      onSaved(res.costoDivergente);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Ajustar línea"
      onClose={onClose}
      width={440}
      footer={(
        <>
          <Button variant="secondary" onClick={saving ? undefined : onClose}>Cancelar</Button>
          <Button variant={saving || !cantidadValida ? 'disabled' : 'primary'} onClick={saving ? undefined : onSubmit}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </>
      )}
    >
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 16 }}>
        Cambia producto, color, embellecimiento o cantidad — escribe en Monday,
        igual que "Ajustar línea" en la Oportunidad.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <ModeButton active={modo === 'editar'} onClick={() => setModo('editar')}>Editar esta línea</ModeButton>
        <ModeButton active={modo === 'dividir'} onClick={() => setModo('dividir')}>Dividir en dos</ModeButton>
      </div>

      <Field label="Producto (SKU)">
        <ProductPicker
          value={producto ? ('item' in producto ? producto.item.name : producto.freeText) : linea.producto}
          catalog={catalog}
          catalogLoading={catalogLoading}
          allowFreeText={false}
          onPick={setProducto}
          style={fieldInputStyle}
        />
      </Field>

      <Field label="Color">
        <input value={color} onChange={(e) => setColor(e.target.value)} style={fieldInputStyle} />
      </Field>

      <Field label={modo === 'dividir' ? `Cantidad que se va a la línea nueva (de ${cantidadActual})` : 'Cantidad'}>
        <input type="number" value={cantidad} onChange={(e) => setCantidad(e.target.value)} style={fieldInputStyle} />
      </Field>

      <Field label="Embellecimiento">
        <select
          value={conEmbellecimiento ? EMB_LABEL_CON : EMB_LABEL_SIN}
          onChange={(e) => setConEmbellecimiento(e.target.value === EMB_LABEL_CON)}
          style={fieldInputStyle}
        >
          <option value={EMB_LABEL_SIN}>{EMB_LABEL_SIN}</option>
          <option value={EMB_LABEL_CON}>{EMB_LABEL_CON}</option>
        </select>
      </Field>

      {conEmbellecimiento && (
        <Field label="Descripción de embellecimiento">
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            style={{ ...fieldInputStyle, minHeight: 60, resize: 'vertical' }}
          />
        </Field>
      )}

      {modo === 'dividir' && (
        <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 4 }}>
          La línea origen se queda con {Number.isFinite(cantidadNum) ? Math.max(cantidadActual - cantidadNum, 0) : cantidadActual} unidades;
          se crea una línea nueva con los cambios de arriba.
        </div>
      )}

      {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-caption)', marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}
