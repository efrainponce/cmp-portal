// Generic "create record" form, driven by shared/createFields.ts's whitelist +
// the role-scoped ColMeta[] already returned by GET /api/boards — same generic-by-
// metadata philosophy as BoardTable/CellContent use for reading.
import { useEffect, useState } from 'react';
import { Modal } from '../../components/core/Modal';
import { Button } from '../../components/core/Button';
import { FormField } from '../../components/forms/FormField';
import { SearchInput } from '../../components/forms/SearchInput';
import { PickerRow } from '../../components/forms/PickerRow';
import { Select } from '../../components/forms/Select';
import { IconBack } from '../../components/icons';
import { useBoards, usePoll, colForBoard, createItem, getVendedores, type BoardSlug, type VendedorDTO } from '../../lib/api';
import { useMe } from '../../lib/useMe';
import { CREATE_FIELDS } from '../../../shared/createFields';

const CONTACTO_VENDEDOR = 'multiple_person_mm03vqwx';
const CONTACTO_INSTITUCION = 'contact_account';
// instituciones exige Tipo/Estado además de Nombre (CREATE_FIELDS.instituciones,
// `required: true`) — el quick-create de abajo los pide inline en vez de aflojar
// ese requisito para el flujo normal de "Nueva institución".
const INST_TIPO = 'dropdown_mm1bajsm';
const INST_ESTADO = 'dropdown_mm1b46m9';

interface Props {
  slug: 'instituciones' | 'contactos';
  title: string;
  onClose: () => void;
  onCreated: () => void;
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

  const institucionesCols = colForBoard(boards, 'instituciones');
  const instTipoCol = institucionesCols.find((c) => c.id === INST_TIPO);
  const instEstadoCol = institucionesCols.find((c) => c.id === INST_ESTADO);
  const instTipoOptions = Object.values(instTipoCol?.labels ?? {}).map((l) => ({ value: l.label, label: l.label }));
  const instEstadoOptions = Object.values(instEstadoCol?.labels ?? {}).map((l) => ({ value: l.label, label: l.label }));

  const [instQ, setInstQ] = useState('');
  const { data: instData } = usePoll('instituciones', instQ);
  const institucionOptions = instData?.items ?? [];
  const [institucionLabel, setInstitucionLabel] = useState('');
  const [instTipo, setInstTipo] = useState('');
  const [instEstado, setInstEstado] = useState('');
  const [creatingInst, setCreatingInst] = useState(false);
  const [instError, setInstError] = useState<string | null>(null);
  // "+ Crear institución «X»" solo cuando lo tecleado no es YA una institución
  // existente — si ya hay una coincidencia exacta, elegirla de la lista es lo
  // correcto (mismo criterio que el "texto libre" de ProductPicker).
  const instQTrim = instQ.trim();
  const instExactMatch = institucionOptions.some((i) => i.name.toLowerCase() === instQTrim.toLowerCase());
  const canQuickCreateInst = instQTrim !== '' && !instExactMatch;

  const onQuickCreateInstitucion = async () => {
    if (!instQTrim || creatingInst) return;
    if (!instTipo || !instEstado) { setInstError('Elige Tipo y Estado para crear la institución.'); return; }
    setCreatingInst(true);
    setInstError(null);
    try {
      const res = await createItem('instituciones', instQTrim, { [INST_TIPO]: instTipo, [INST_ESTADO]: instEstado });
      if (!res.id) throw new Error('No se pudo crear la institución.');
      setCol(CONTACTO_INSTITUCION)(res.id);
      setInstitucionLabel(instQTrim);
      setInstQ('');
      setInstTipo('');
      setInstEstado('');
    } catch (e) {
      setInstError(e instanceof Error ? e.message : 'No se pudo crear la institución.');
    } finally {
      setCreatingInst(false);
    }
  };

  // Sin condicionar al tipo de columna: `allCols` depende de que useBoards()
  // ya haya resuelto su fetch, y en el primer render siempre viene vacío —
  // condicionar aquí dejaba el fetch de vendedores sin disparar nunca
  // (mismo patrón sin condición que ya usa EditContactoModal).
  useEffect(() => { getVendedores().then(setVendedores); }, []);

  // Contactos se leen scopeados por Vendedor (shared/boards.ts): un contacto sin
  // vendedor no lo vería ni quien lo creó. El server estampa al creador cuando el
  // campo va vacío — aquí se prellena para que el form muestre lo que va a pasar.
  useEffect(() => {
    if (slug === 'contactos' && me?.mondayUserId && !cols[CONTACTO_VENDEDOR]
        && vendedores.some((v) => v.id === me.mondayUserId)) {
      setCols((c) => ({ ...c, [CONTACTO_VENDEDOR]: String(me.mondayUserId) }));
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

        {slug === 'contactos' && (
          <div>
            <div style={{ font: 'var(--text-label-strong)', color: 'var(--ink-secondary)', marginBottom: 6 }}>
              Institución *
              {institucionLabel && <span style={{ fontWeight: 400, color: 'var(--ink-tertiary)' }}> — elegida: {institucionLabel}</span>}
            </div>
            <SearchInput value={instQ} onChange={(e) => setInstQ(e.target.value)} placeholder="Buscar institución…" style={{ maxWidth: 'none' }} />
            <div style={{
              marginTop: 6, padding: '8px 10px', borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-sunken)', font: 'var(--text-caption)', color: 'var(--ink-tertiary)',
            }}>
              ¿No aparece la institución que buscas? Escribe el nombre completo y créala aquí mismo.
            </div>
            <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginTop: 6 }}>
              {institucionOptions.length === 0 && !canQuickCreateInst && (
                <div style={{ padding: 12, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>Sin resultados.</div>
              )}
              {institucionOptions.map((inst) => (
                <PickerRow key={inst.id} onClick={() => { setCol(CONTACTO_INSTITUCION)(inst.id); setInstitucionLabel(inst.name); }}>
                  {inst.name}
                </PickerRow>
              ))}
            </div>
            {canQuickCreateInst && (
              <div style={{
                marginTop: 6, padding: 10, border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>
                  Crear «{instQTrim}» como institución nueva:
                </div>
                <Select value={instTipo} onChange={setInstTipo} options={instTipoOptions} placeholder="Tipo…" />
                <Select value={instEstado} onChange={setInstEstado} options={instEstadoOptions} placeholder="Estado…" />
                <Button
                  variant="secondary"
                  onClick={creatingInst ? undefined : onQuickCreateInstitucion}
                  style={{ alignSelf: 'flex-start', opacity: creatingInst ? 0.6 : 1 }}
                >
                  {creatingInst ? 'Creando…' : '+ Crear institución'}
                </Button>
              </div>
            )}
            {instError && <div style={{ marginTop: 6, color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{instError}</div>}
          </div>
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
