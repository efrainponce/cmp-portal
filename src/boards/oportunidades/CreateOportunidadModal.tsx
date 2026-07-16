// Formulario "Nueva oportunidad" — deliberadamente mínimo (Efraín 2026-07-15):
// nombre, vendedor, compras, contacto, zona, tipo de cotización, ¿nuevos
// productos? y fecha límite. Las líneas de producto se capturan después; la
// validación de enviar-costeo impide avanzar sin ellas. Cargado lazy desde
// OportunidadesBoard para no pesar en el bundle inicial.
import { useEffect, useState } from 'react';
import { Modal } from '../../components/core/Modal';
import { Button } from '../../components/core/Button';
import { Select } from '../../components/forms/Select';
import { useMe } from '../../lib/useMe';
import {
  apiFetch, useBoards, colForBoard, createItem, getVendedores, getItemDetail,
  type ColMeta, type ListResponse, type VendedorDTO,
} from '../../lib/api';

// Ids reales de Monday (docs/monday-column-map.md) — nunca fabricar.
const COL_VENDEDOR = 'deal_owner';
const COL_COMPRAS = 'multiple_person_mm03qyw9';
const COL_CONTACTO = 'deal_contact';
const COL_ZONA = 'dropdown_mm03g067';
const COL_TIPO = 'color_mm47f0ca';
const COL_NUEVOS = 'color_mm0ex0ed';
const COL_FECHA_LIMITE = 'deal_expected_close_date';

const fieldStyle = {
  width: '100%', font: 'var(--text-body)', color: 'var(--ink)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '8px 10px', boxSizing: 'border-box',
} as const;

function labelOptions(cols: ColMeta[], id: string): { value: string; label: string }[] {
  const labels = cols.find((c) => c.id === id)?.labels ?? {};
  return Object.values(labels).map((l) => ({ value: l.label, label: l.label }));
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

export default function CreateOportunidadModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  /** Llamado cuando la opp está lista (folio asignado). Pasa el ID Monday y el folio. */
  onCreated: (itemId: number, folio: string) => void;
}) {
  const me = useMe();
  const { boards } = useBoards();
  const oppCols = colForBoard(boards, 'oportunidades');

  const [name, setName] = useState('');
  const [cols, setCols] = useState<Record<string, string>>({});
  const [vendedores, setVendedores] = useState<VendedorDTO[]>([]);
  const [compras, setCompras] = useState<VendedorDTO[]>([]);
  const [contactos, setContactos] = useState<{ value: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getVendedores('vendedor').then(setVendedores);
    getVendedores('compras').then(setCompras);
    apiFetch('/boards/contactos/items')
      .then((r) => (r.ok ? (r.json() as Promise<ListResponse>) : Promise.reject()))
      .then((json) => setContactos(json.items.map((it) => ({ value: it.id, label: it.name }))))
      .catch(() => setContactos([]));
  }, []);

  // El vendedor que crea es el dueño por default (igual que el bot de WhatsApp).
  useEffect(() => {
    if (me?.role === 'vendedor' && me.mondayUserId && !cols[COL_VENDEDOR]) {
      setCols((c) => ({ ...c, [COL_VENDEDOR]: String(me.mondayUserId) }));
    }
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (id: string) => (value: string) => setCols((c) => ({ ...c, [id]: value }));

  const onSubmit = async () => {
    if (!name.trim()) { setError('El nombre es obligatorio.'); return; }
    if (!(cols[COL_VENDEDOR] ?? '').trim()) { setError('Falta elegir el vendedor.'); return; }
    setSaving(true);
    setError(null);
    try {
      const nonEmpty = Object.fromEntries(Object.entries(cols).filter(([, v]) => v.trim() !== ''));
      const result = await createItem('oportunidades', name.trim(), nonEmpty);
      if (!result.ok || !result.id) throw new Error('No se asignó ID a la oportunidad.');

      setError(null); // limpiar antes de polling para que se vea "Esperando folio…"
      // Polling: esperar a que Monday asigne el folio (pulse_id_mm0qcq0m)
      let folio: string | undefined;
      let attempts = 0;
      const maxAttempts = 30; // 30 intentos = ~6 segundos con delay 200ms
      while (!folio && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 200));
        try {
          const detail = await getItemDetail('oportunidades', String(result.id));
          folio = detail.item.cols.pulse_id_mm0qcq0m?.text;
          if (folio) break;
        } catch {
          // Ignorar errores de fetch, reintentar
        }
        attempts++;
      }

      if (!folio) throw new Error('No se pudo asignar el folio. Refresca la página.');
      onCreated(result.id, folio);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la oportunidad.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Nueva oportunidad"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={saving ? undefined : onSubmit}>{saving ? 'Creando…' : 'Crear oportunidad'}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Nombre" required>
          <input value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} autoFocus />
        </Field>
        <Field label="Vendedor" required>
          <Select
            value={cols[COL_VENDEDOR] ?? ''} onChange={set(COL_VENDEDOR)}
            options={vendedores.map((v) => ({ value: String(v.id), label: v.nombre }))}
            placeholder="Elegir vendedor…"
          />
        </Field>
        <Field label="Compras">
          <Select
            value={cols[COL_COMPRAS] ?? ''} onChange={set(COL_COMPRAS)}
            options={compras.map((v) => ({ value: String(v.id), label: v.nombre }))}
            placeholder="Elegir responsable de compras…"
          />
        </Field>
        <Field label="Contacto (cliente)">
          <Select value={cols[COL_CONTACTO] ?? ''} onChange={set(COL_CONTACTO)} options={contactos} placeholder="Elegir contacto…" />
        </Field>
        <Field label="Zona">
          <Select value={cols[COL_ZONA] ?? ''} onChange={set(COL_ZONA)} options={labelOptions(oppCols, COL_ZONA)} />
        </Field>
        <Field label="Tipo de cotización">
          <Select value={cols[COL_TIPO] ?? ''} onChange={set(COL_TIPO)} options={labelOptions(oppCols, COL_TIPO)} />
        </Field>
        <Field label="¿Quieres cotizar nuevos productos?">
          <Select value={cols[COL_NUEVOS] ?? ''} onChange={set(COL_NUEVOS)} options={labelOptions(oppCols, COL_NUEVOS)} />
        </Field>
        <Field label="Fecha límite">
          <input type="date" value={cols[COL_FECHA_LIMITE] ?? ''} onChange={(e) => set(COL_FECHA_LIMITE)(e.target.value)} style={fieldStyle} />
        </Field>
        {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
      </div>
    </Modal>
  );
}
