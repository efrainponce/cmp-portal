// Generic "create record" form, driven by shared/createFields.ts's whitelist +
// the role-scoped ColMeta[] already returned by GET /api/boards — same generic-by-
// metadata philosophy as BoardTable/CellContent use for reading.
import { useEffect, useState } from 'react';
import { Modal } from '../../components/core/Modal';
import { Button } from '../../components/core/Button';
import { FormField } from '../../components/forms/FormField';
import { IconBack } from '../../components/icons';
import { useBoards, colForBoard, createItem, getVendedores, type BoardSlug, type VendedorDTO } from '../../lib/api';
import { CREATE_FIELDS } from '../../../shared/createFields';

interface Props {
  slug: 'instituciones' | 'contactos';
  title: string;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateRecordModal({ slug, title, onClose, onCreated }: Props) {
  const { boards } = useBoards();
  const allCols = colForBoard(boards, slug as BoardSlug);
  const allFields = CREATE_FIELDS[slug].filter((f) => f.id !== 'name');
  const requiredFields = allFields.filter((f) => f.required);
  const optionalFields = allFields.filter((f) => !f.required);

  const [name, setName] = useState('');
  const [cols, setCols] = useState<Record<string, string>>({});
  const [vendedores, setVendedores] = useState<VendedorDTO[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(optionalFields.length === 0);

  useEffect(() => {
    if (allFields.some((f) => allCols.find((c) => c.id === f.id)?.type === 'people')) {
      getVendedores().then(setVendedores);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setCol = (id: string) => (value: string) => {
    setCols((c) => ({ ...c, [id]: value }));
  };

  const onSubmit = async () => {
    if (!name.trim()) { setError('El nombre es obligatorio.'); return; }
    const missing = requiredFields.filter((f) => !(cols[f.id] ?? '').trim());
    if (missing.length > 0) {
      const labels = missing.map((f) => allCols.find((c) => c.id === f.id)?.title ?? f.id).join(', ');
      setError(`Falta completar: ${labels}.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const nonEmpty = Object.fromEntries(Object.entries(cols).filter(([, v]) => v.trim() !== ''));
      await createItem(slug, name.trim(), nonEmpty);
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el registro.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={saving ? undefined : onSubmit}>{saving ? 'Creando…' : 'Crear'}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink-secondary)', marginBottom: 6 }}>Nombre *</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: '100%', font: 'var(--text-body)', color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '8px 10px', boxSizing: 'border-box' }}
            autoFocus
          />
        </div>

        {requiredFields.map((f) => {
          const col = allCols.find((c) => c.id === f.id);
          if (!col) return null;
          return (
            <div key={f.id}>
              <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink-secondary)', marginBottom: 6 }}>{col.title} *</div>
              <FormField col={col} value={cols[f.id] ?? ''} onChange={setCol(f.id)} vendedores={vendedores} />
            </div>
          );
        })}

        {optionalFields.length > 0 && !showMore && (
          <button
            type="button"
            onClick={() => setShowMore(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'var(--text-label-strong)', color: 'var(--ink-secondary)', alignSelf: 'flex-start' }}
          >
            <IconBack style={{ transform: 'rotate(-90deg)' }} />
            Más campos (opcional)
          </button>
        )}

        {optionalFields.length > 0 && showMore && optionalFields.map((f) => {
          const col = allCols.find((c) => c.id === f.id);
          if (!col) return null;
          return (
            <div key={f.id}>
              <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink-secondary)', marginBottom: 6 }}>{col.title}</div>
              <FormField col={col} value={cols[f.id] ?? ''} onChange={setCol(f.id)} vendedores={vendedores} />
            </div>
          );
        })}

        {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
      </div>
    </Modal>
  );
}
