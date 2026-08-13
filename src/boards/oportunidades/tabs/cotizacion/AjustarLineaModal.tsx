// "Ajustar línea" (Efraín, 2026-07-31, WhatsApp con Ricardo/Pam): modal para
// cambiar producto (género)/color/embellecimiento/cantidad de una línea sin
// crear una versión nueva ni volver a costear — funciona incluso con la
// Oportunidad Ganada (worker/lib/lineaAjustes.ts). El precio de venta NUNCA se
// toca aquí, por eso ni siquiera se muestra el campo.
import { useState } from 'react';
import type { CostoDivergenciaDTO, ItemDTO, QuoteVersionDTO } from '../../../../lib/api';
import { ajustarLinea } from '../../../../lib/apiClient';
import { Button } from '../../../../components/core/Button';
import { Modal } from '../../../../components/core/Modal';
import { ProductPicker, type ProductoChoice } from '../../../../components/forms/ProductPicker';
import { displayProducto, COLOR_COL, EMB_STATUS_COL, EMB_LABEL_CON, EMB_LABEL_SIN } from './gridMeta';
import { COL } from '../../../../lib/costeoCalc';

const EMB_DESC_COL = 'long_text_mm1bj4pt'; // Descripción Embellecimientos (oportunidades_sub)

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

export function AjustarLineaModal({
  linea, catalog, catalogLoading, onClose, onSaved, onVersioned, canEliminar = true,
}: {
  linea: ItemDTO;
  catalog: ItemDTO[];
  catalogLoading: boolean;
  onClose: () => void;
  onSaved: (divergencia?: CostoDivergenciaDTO) => void;
  /** Solo modo 'eliminar': el server archivó la vigente como versión nueva
   * antes de borrar la línea — el drawer necesita refrescar `versions`, no
   * solo el item (onSaved), para que el chip "V{n} · vigente" y el historial
   * queden correctos (Efraín, 2026-08-13). */
  onVersioned?: (versions: QuoteVersionDTO[]) => void;
  /** false en Ganada/Perdida (mismo `editable` de CotizacionTab): a diferencia
   * de editar/dividir, eliminar SÍ pasa por "+ Nueva versión" y el server la
   * bloquea ahí — se oculta el modo en vez de dejar que el usuario la elija y
   * se tope con un error. */
  canEliminar?: boolean;
}) {
  const cantidadActual = Number(linea.cols[COL.cantidad]?.text ?? 0) || 0;
  const [modo, setModo] = useState<'editar' | 'dividir' | 'eliminar'>('editar');
  const [cantidad, setCantidad] = useState(String(cantidadActual || ''));
  const [producto, setProducto] = useState<ProductoChoice | null>(null);
  const [color, setColor] = useState(linea.cols[COLOR_COL]?.text ?? '');
  const [conEmbellecimiento, setConEmbellecimiento] = useState(linea.cols[EMB_STATUS_COL]?.text === EMB_LABEL_CON);
  const [descripcion, setDescripcion] = useState(linea.cols[EMB_DESC_COL]?.text ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const cantidadNum = Number(cantidad);
  const cantidadValida = modo === 'eliminar' || (Number.isFinite(cantidadNum) && cantidadNum > 0
    && (modo === 'editar' || cantidadNum < cantidadActual));

  const onSubmit = async () => {
    if (!cantidadValida) { setError('Cantidad inválida.'); return; }
    setSaving(true);
    setError(undefined);
    try {
      const res = await ajustarLinea(linea.id, modo === 'eliminar' ? { modo } : {
        modo,
        cantidad: cantidadNum,
        productoId: producto && 'item' in producto ? Number(producto.item.id) : undefined,
        productoNombre: producto && 'item' in producto ? producto.item.name : undefined,
        color,
        embellecimiento: { estado: conEmbellecimiento ? 'con' : 'sin', descripcion },
      });
      if (!res.ok) { setError(res.error ?? 'No se pudo guardar.'); return; }
      if (res.versions) onVersioned?.(res.versions);
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
          <Button
            variant={saving || !cantidadValida ? 'disabled' : (modo === 'eliminar' ? 'danger' : 'primary')}
            onClick={saving ? undefined : onSubmit}
          >
            {saving ? (modo === 'eliminar' ? 'Eliminando…' : 'Guardando…') : (modo === 'eliminar' ? 'Eliminar línea' : 'Guardar')}
          </Button>
        </>
      )}
    >
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 16 }}>
        {modo === 'eliminar'
          ? 'Elimina la línea por completo — a diferencia de editar/dividir, esto SÍ crea una versión nueva (la vigente actual queda archivada) y la cotización vuelve a costeo.'
          : 'Cambia producto, color, embellecimiento o cantidad sin crear una versión nueva ni volver a costear — el precio de venta no se toca.'}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <ModeButton active={modo === 'editar'} onClick={() => setModo('editar')}>Editar esta línea</ModeButton>
        <ModeButton active={modo === 'dividir'} onClick={() => setModo('dividir')}>Dividir en dos</ModeButton>
        {canEliminar && (
          <ModeButton active={modo === 'eliminar'} onClick={() => setModo('eliminar')}>Eliminar línea</ModeButton>
        )}
      </div>

      {modo === 'eliminar' ? (
        <div style={{ font: 'var(--text-label)', color: 'var(--ink)', marginBottom: 4 }}>
          Se eliminará <strong>{displayProducto(linea)}</strong> ({cantidadActual} uds) de la cotización. Esto crea una <strong>versión nueva</strong> sin esa línea y la manda de vuelta a costeo — no se puede deshacer.
        </div>
      ) : (
        <>
          <Field label="Producto (SKU)">
            <ProductPicker
              value={producto ? ('item' in producto ? producto.item.name : producto.freeText) : displayProducto(linea)}
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
        </>
      )}

      {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-caption)', marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}
