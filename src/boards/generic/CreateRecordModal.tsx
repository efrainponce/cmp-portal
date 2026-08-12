// Generic "create record" form, driven by shared/createFields.ts's whitelist +
// the role-scoped ColMeta[] already returned by GET /api/boards — same generic-by-
// metadata philosophy as BoardTable/CellContent use for reading.
import { useEffect, useState } from 'react';
import { Modal } from '../../components/core/Modal';
import { Button } from '../../components/core/Button';
import { FormField } from '../../components/forms/FormField';
import { SearchInput } from '../../components/forms/SearchInput';
import { PickerRow } from '../../components/forms/PickerRow';
import { IconBack } from '../../components/icons';
import {
  useBoards, usePoll, colForBoard, createItem, getVendedores, vendedorKey, vendedorIdFromKey,
  type BoardSlug, type VendedorDTO,
} from '../../lib/api';
import { useMe } from '../../lib/useMe';
import { CREATE_FIELDS } from '../../../shared/createFields';

const CONTACTO_VENDEDOR = 'multiple_person_mm03vqwx';
const CONTACTO_INSTITUCION = 'contact_account';

interface Props {
  slug: 'instituciones' | 'contactos';
  title: string;
  onClose: () => void;
  // El quick-create de Institución (abajo) necesita el id/nombre recién creado
  // para autoseleccionarlo en el combobox — GenericBoardView le pasa `refetch`,
  // que ignora argumentos de sobra, así que este parámetro no rompe ese uso.
  onCreated: (created?: { id: string; name: string }) => void;
}

export function CreateRecordModal({ slug, title, onClose, onCreated }: Props) {
  const me = useMe();
  const { boards } = useBoards();
  const allCols = colForBoard(boards, slug as BoardSlug);
  // Institución (contact_account) tiene su propio bloque siempre visible más
  // abajo — es un board_relation que necesita buscar en vivo sobre
  // `instituciones`, no el <input>/<select> genérico de FormField.
  const allFields = CREATE_FIELDS[slug].filter((f) => f.id !== 'name' && f.id !== CONTACTO_INSTITUCION);
  const requiredFields = allFields.filter((f) => f.required);
  const optionalFields = allFields.filter((f) => !f.required);

  const [name, setName] = useState('');
  const [cols, setCols] = useState<Record<string, string>>({});
  const [vendedores, setVendedores] = useState<VendedorDTO[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(optionalFields.length === 0);

  const [instQ, setInstQ] = useState('');
  const { data: instData } = usePoll('instituciones', instQ);
  const institucionOptions = instData?.items ?? [];
  const [institucionLabel, setInstitucionLabel] = useState('');
  const [showInstModal, setShowInstModal] = useState(false);

  const selectInstitucion = (id: string, label: string) => {
    setCol(CONTACTO_INSTITUCION)(id);
    setInstitucionLabel(label);
    setInstQ('');
  };
  const clearInstitucion = () => {
    setCol(CONTACTO_INSTITUCION)('');
    setInstitucionLabel('');
    setInstQ('');
  };

  // Sin condicionar al tipo de columna: `allCols` depende de que useBoards()
  // ya haya resuelto su fetch, y en el primer render siempre viene vacío —
  // condicionar aquí dejaba el fetch de vendedores sin disparar nunca
  // (mismo patrón sin condición que ya usa EditContactoModal).
  useEffect(() => { getVendedores().then(setVendedores); }, []);

  // Contactos se leen scopeados por Vendedor (shared/boards.ts): un contacto sin
  // vendedor no lo vería ni quien lo creó. El server estampa al creador cuando el
  // campo va vacío — aquí se prellena para que el form muestre lo que va a pasar.
  // Empareja por email (no solo por id) para no autoseleccionar a la persona
  // equivocada cuando dos comparten monday_user_id ("Actuar en Monday como" —
  // ver vendedorKey en lib/apiClient.ts).
  useEffect(() => {
    const propio = vendedores.find((v) => v.id === me?.mondayUserId && v.email === me?.email);
    if (slug === 'contactos' && propio && !cols[CONTACTO_VENDEDOR]) {
      setCols((c) => ({ ...c, [CONTACTO_VENDEDOR]: vendedorKey(propio) }));
    }
  }, [me, vendedores]); // eslint-disable-line react-hooks/exhaustive-deps

  const setCol = (id: string) => (value: string) => {
    setCols((c) => ({ ...c, [id]: value }));
  };

  const onSubmit = async () => {
    if (!name.trim()) { setError('El nombre es obligatorio.'); return; }
    if (slug === 'contactos' && !(cols[CONTACTO_INSTITUCION] ?? '').trim()) {
      setError('Falta completar: Institución.');
      return;
    }
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
      // Los campos tipo 'people' viajan como `id::email` en el estado del form
      // (FormField + vendedorKey) — Monday solo entiende el id numérico.
      for (const f of allFields) {
        if (nonEmpty[f.id] && allCols.find((c) => c.id === f.id)?.type === 'people') {
          nonEmpty[f.id] = vendedorIdFromKey(nonEmpty[f.id]);
        }
      }
      const res = await createItem(slug, name.trim(), nonEmpty);
      onCreated(res.id ? { id: res.id, name: name.trim() } : undefined);
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

        {slug === 'contactos' && (
          <div>
            <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink-secondary)', marginBottom: 6 }}>Institución *</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {institucionLabel ? (
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '8px 10px',
                  background: 'var(--bg-sunken)', font: 'var(--text-body)', color: 'var(--ink)', boxSizing: 'border-box',
                }}>
                  <span>{institucionLabel}</span>
                  <button
                    type="button"
                    onClick={clearInstitucion}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-tertiary)', font: 'var(--text-label-strong)', padding: 4 }}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <SearchInput value={instQ} onChange={(e) => setInstQ(e.target.value)} placeholder="Buscar institución…" style={{ flex: 1, maxWidth: 'none' }} />
              )}
              <Button variant="secondary" onClick={() => setShowInstModal(true)}>+ Nueva</Button>
            </div>
            {!institucionLabel && instQ.trim() !== '' && (
              <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginTop: 6 }}>
                {institucionOptions.length === 0 && (
                  <div style={{ padding: 12, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
                    Sin resultados. Usa «+ Nueva» para crearla.
                  </div>
                )}
                {institucionOptions.map((inst) => (
                  <PickerRow key={inst.id} onClick={() => selectInstitucion(inst.id, inst.name)}>
                    {inst.name}
                  </PickerRow>
                ))}
              </div>
            )}
          </div>
        )}

        {showInstModal && (
          <CreateRecordModal
            slug="instituciones"
            title="Nueva institución"
            onClose={() => setShowInstModal(false)}
            onCreated={(created) => { if (created) selectInstitucion(created.id, created.name); }}
          />
        )}

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

        {optionalFields.length > 0 && (
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'var(--text-label-strong)', color: 'var(--ink-secondary)', alignSelf: 'flex-start' }}
          >
            <IconBack style={{ transform: showMore ? 'rotate(90deg)' : 'rotate(-90deg)' }} />
            {showMore ? 'Menos campos' : 'Más campos (opcional)'}
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
