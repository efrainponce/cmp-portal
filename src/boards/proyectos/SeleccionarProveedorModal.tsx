// Buscador de proveedores en modal — un solo componente para los dos lugares
// donde se elige proveedor de una línea del Proyecto: el ⇄ de Órdenes de compra
// (mover la línea de OC) y el selector por línea de embellecimiento
// (EmbellecimientosVirtualTab, Efraín 2026-08-25). Antes vivía dentro de
// OrdenesSection.tsx; se extrajo tal cual para no importar ese archivo de 1100
// líneas (y su pdfjs lazy) desde la tab de Embellecimientos.
//
// Solo dibuja y espera: quién escribe qué (patch de la línea, alta de una línea
// nueva) lo decide `onPick`, que recibe el id del proveedor — o '' cuando el
// usuario elige quitarlo.
import { useState } from 'react';
import { Modal } from '../../components/core/Modal';
import { SearchInput } from '../../components/forms/SearchInput';
import { usePoll, SOLO_NOMBRE } from '../../lib/api';

export function SeleccionarProveedorModal({ titulo, ayuda, etiquetaQuitar, onPick, onClose }: {
  titulo: string;
  ayuda: string;
  /** Si se pasa, se ofrece dejar la línea sin proveedor (`onPick('')`). */
  etiquetaQuitar?: string;
  /** Lanza para que el modal muestre el error y no se cierre. */
  onPick: (proveedorId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data } = usePoll('proveedores', q, SOLO_NOMBRE);
  const opciones = data?.items ?? [];

  const elegir = async (proveedorId: string) => {
    setSaving(true);
    setError(null);
    try {
      await onPick(proveedorId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
      setSaving(false);
    }
  };

  return (
    <Modal title={titulo} onClose={onClose} width={440}>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 10 }}>{ayuda}</div>
      <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor…" style={{ maxWidth: 'none' }} />
      <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginTop: 8 }}>
        {opciones.length === 0 ? (
          <div style={{ padding: 10, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin resultados.</div>
        ) : opciones.map((p) => (
          <div
            key={p.id}
            className="row-hover"
            onClick={saving ? undefined : () => elegir(p.id)}
            style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', font: 'var(--text-label)', color: 'var(--ink)', cursor: saving ? 'default' : 'pointer' }}
          >
            {p.name}
          </div>
        ))}
      </div>
      {etiquetaQuitar && (
        <div
          onClick={saving ? undefined : () => elegir('')}
          style={{ marginTop: 10, font: 'var(--text-label)', color: 'var(--accent)', cursor: saving ? 'default' : 'pointer' }}
        >
          {etiquetaQuitar}
        </div>
      )}
      {error && <div style={{ marginTop: 8, color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
    </Modal>
  );
}
