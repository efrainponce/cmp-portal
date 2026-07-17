// "Nueva versión" — draft editor de líneas de una cotización ya vigente. Precarga
// las líneas actuales, permite editar color/cantidad/embellecimiento, agregar o
// quitar líneas, y al confirmar manda todo el draft a POST /oportunidades/:id/version
// — el worker decide si algo cambió y archiva/escribe (worker/lib/quoteVersions.ts).
import { useEffect, useState } from 'react';
import type { ItemDTO, QuoteLineInput, QuoteLineSnapshot } from '../../../lib/api';
import { listItems, submitVersion } from '../../../lib/apiClient';
import { Modal } from '../../../components/core/Modal';
import { Button } from '../../../components/core/Button';

interface DraftLine extends QuoteLineInput {
  key: string;   // React key estable — subitemId o un id local para líneas nuevas
}

function toDraft(lines: QuoteLineSnapshot[]): DraftLine[] {
  return lines.map((l) => ({
    key: String(l.subitemId),
    subitemId: l.subitemId,
    producto: l.producto,
    color: l.color,
    cantidad: l.cantidad,
    embellecimiento: l.embellecimiento,
    descripcionEmbellecimiento: l.descripcionEmbellecimiento ?? '',
  }));
}

const fieldStyle: React.CSSProperties = {
  width: '100%', font: 'var(--text-body)', color: 'var(--ink)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '7px 9px', boxSizing: 'border-box',
};

export function NuevaVersionForm({
  itemId, currentProducts, onClose, onSaved,
}: {
  itemId: string; currentProducts: QuoteLineSnapshot[]; onClose: () => void;
  onSaved: (label: string) => void;
}) {
  const [lines, setLines] = useState<DraftLine[]>(() => toDraft(currentProducts));
  const [catalog, setCatalog] = useState<ItemDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => { listItems('productos').then(setCatalog).catch(() => {}); }, []);

  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const addLine = () => setLines((ls) => [...ls, {
    key: `new-${Date.now()}-${ls.length}`, producto: '', color: '', cantidad: 1, embellecimiento: false,
  }]);

  const onProductoChange = (key: string, raw: string) => {
    const match = catalog.find((c) => c.name.trim().toLowerCase() === raw.trim().toLowerCase());
    updateLine(key, { producto: raw, productoItemId: match ? Number(match.id) : undefined });
  };

  const onSubmit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await submitVersion(itemId, lines.map(({ key: _key, ...rest }) => rest));
      if (!res.ok) { setError(res.error ?? 'No se pudo guardar.'); return; }
      if (!res.changed) { setError('Sin cambios respecto a la versión vigente.'); return; }
      const nueva = res.versions?.[res.versions.length - 1];
      onSaved(nueva?.label ?? 'nueva versión');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Nueva versión de la cotización"
      onClose={onClose}
      width={720}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={busy ? undefined : onSubmit} style={busy ? { opacity: 0.6 } : undefined}>
            {busy ? 'Guardando…' : 'Guardar como nueva versión'}
          </Button>
        </>
      }
    >
      <datalist id="productos-catalogo">
        {catalog.map((p) => <option key={p.id} value={p.name} />)}
      </datalist>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {lines.map((l) => (
          <div key={l.key} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 2 }}>
                <input
                  list="productos-catalogo"
                  value={l.producto}
                  placeholder="Producto"
                  onChange={(e) => onProductoChange(l.key, e.target.value)}
                  style={fieldStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <input
                  value={l.color}
                  placeholder="Color"
                  onChange={(e) => updateLine(l.key, { color: e.target.value })}
                  style={fieldStyle}
                />
              </div>
              <div style={{ flex: '0 0 80px' }}>
                <input
                  type="number"
                  min={1}
                  value={l.cantidad}
                  onChange={(e) => updateLine(l.key, { cantidad: Number(e.target.value) || 0 })}
                  style={fieldStyle}
                />
              </div>
              <div onClick={() => removeLine(l.key)} title="Quitar línea" style={{ cursor: 'pointer', color: 'var(--ink-tertiary)', padding: '7px 4px' }}>✕</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>
              <input
                type="checkbox"
                checked={l.embellecimiento}
                onChange={(e) => updateLine(l.key, { embellecimiento: e.target.checked })}
              />
              Con embellecimiento
            </label>
            {l.embellecimiento && (
              <textarea
                value={l.descripcionEmbellecimiento ?? ''}
                onChange={(e) => updateLine(l.key, { descripcionEmbellecimiento: e.target.value })}
                placeholder="Descripción del embellecimiento (zona, técnica, referencia)…"
                rows={2}
                style={fieldStyle}
              />
            )}
          </div>
        ))}
        <div onClick={addLine} style={{ cursor: 'pointer', font: 'var(--text-label-strong)', color: 'var(--accent)' }}>
          + Agregar línea
        </div>
        {error && <div style={{ font: 'var(--text-label)', color: 'var(--status-perdida)' }}>{error}</div>}
      </div>
    </Modal>
  );
}
