// Formulario "Nueva oportunidad" — deliberadamente mínimo (Efraín 2026-07-15):
// nombre, vendedor, compras, contacto, zona, tipo de cotización, ¿nuevos
// productos? y fecha límite. Las líneas de producto se capturan después; la
// validación de enviar-costeo impide avanzar sin ellas. Cargado lazy desde
// OportunidadesBoard para no pesar en el bundle inicial.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../components/core/Modal';
import { Button } from '../../components/core/Button';
import { SearchableSelect, type SearchableOption } from '../../components/forms/SearchableSelect';
import { ChipSelect } from '../../components/forms/ChipSelect';
import { useMe } from '../../lib/useMe';
import {
  apiFetch, useBoards, colForBoard, createItem, getVendedores, vendedorKey, vendedorIdFromKey,
  type ColMeta, type ItemDTO, type ListResponse, type VendedorDTO,
} from '../../lib/api';

// Ids reales de Monday (docs/monday-column-map.md) — nunca fabricar.
const COL_VENDEDOR = 'deal_owner';
const COL_VENDEDOR_SECUNDARIO = 'multiple_person_mm0wt53c';
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

// Contactos board's "Vendedor" people column — no está en shared/column-meta ids
// de oportunidades, es propia del board Contactos (docs/monday-column-map.md).
const COL_CONTACTO_VENDEDOR = 'multiple_person_mm03vqwx';

function personIds(item: ItemDTO, colId: string): number[] {
  const value = item.cols[colId]?.value as { personsAndTeams?: { id: number }[] } | undefined;
  return value?.personsAndTeams?.map((p) => p.id) ?? [];
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
  onClose, onCreated, native,
}: {
  onClose: () => void;
  /** Llamado cuando la opp se crea. Pasa el ID Monday (folio se asigna async). */
  onCreated: (itemId: string) => void;
  /** "Salir de Monday" (Zona Efrain, test): nace y vive 100% en D1, nunca en
   * Monday — el server re-valida que el viewer esté en la whitelist. */
  native?: boolean;
}) {
  const me = useMe();
  const { boards } = useBoards();
  const oppCols = colForBoard(boards, 'oportunidades');

  const [name, setName] = useState('');
  const [cols, setCols] = useState<Record<string, string>>({});
  const [vendedores, setVendedores] = useState<VendedorDTO[]>([]);
  const [compras, setCompras] = useState<VendedorDTO[]>([]);
  const [contactos, setContactos] = useState<ItemDTO[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fechaLimiteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getVendedores('vendedor').then(setVendedores);
    getVendedores('compras').then(setCompras);
    apiFetch('/boards/contactos/items')
      .then((r) => (r.ok ? (r.json() as Promise<ListResponse>) : Promise.reject()))
      .then((json) => setContactos(json.items))
      .catch(() => setContactos([]));
  }, []);

  // El vendedor que crea es el dueño por default (igual que el bot de WhatsApp).
  // Se checa contra `vendedores` (no contra el role del viewer) porque admins
  // también pueden ser dueños de una oportunidad — worker/lib/dal.ts los
  // incluye en la lista (pedido de Efraín, 2026-07-20). Empareja por email (no
  // solo por id) para no autoseleccionar a la persona equivocada cuando dos
  // comparten monday_user_id (ver vendedorKey arriba).
  useEffect(() => {
    const propio = vendedores.find((v) => v.id === me?.mondayUserId && v.email === me?.email);
    if (propio && !cols[COL_VENDEDOR]) {
      setCols((c) => ({ ...c, [COL_VENDEDOR]: vendedorKey(propio) }));
    }
  }, [me, vendedores]); // eslint-disable-line react-hooks/exhaustive-deps

  // Un contacto es "de" un vendedor: la columna Vendedor del board Contactos debe
  // incluirlo. Filtra la lista al vendedor elegido en el form (pedido de Efraín,
  // 2026-07-17: "un vendedor solo puede poner un contacto SUYO") y limpia el
  // contacto ya elegido si deja de pertenecer al vendedor recién seleccionado.
  const selectedVendedorKey = cols[COL_VENDEDOR];
  const contactOptions: SearchableOption[] = useMemo(() => {
    if (!selectedVendedorKey) return [];
    const vid = Number(vendedorIdFromKey(selectedVendedorKey));
    return contactos
      .filter((it) => personIds(it, COL_CONTACTO_VENDEDOR).includes(vid))
      .map((it) => ({ value: it.id, label: it.name }));
  }, [contactos, selectedVendedorKey]);

  useEffect(() => {
    if (cols[COL_CONTACTO] && !contactOptions.some((o) => o.value === cols[COL_CONTACTO])) {
      setCols((c) => ({ ...c, [COL_CONTACTO]: '' }));
    }
  }, [contactOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (id: string) => (value: string) => setCols((c) => ({ ...c, [id]: value }));

  const onSubmit = async () => {
    if (!name.trim()) { setError('El nombre es obligatorio.'); return; }
    if (!(cols[COL_VENDEDOR] ?? '').trim()) { setError('Falta elegir el vendedor.'); return; }
    setSaving(true);
    setError(null);
    try {
      const nonEmpty = Object.fromEntries(Object.entries(cols).filter(([, v]) => v.trim() !== ''));
      // Vendedor/Vendedor secundario viajan como `id::email` en el estado del form
      // (ver vendedorKey) — Monday solo entiende el id numérico.
      if (nonEmpty[COL_VENDEDOR]) nonEmpty[COL_VENDEDOR] = vendedorIdFromKey(nonEmpty[COL_VENDEDOR]);
      if (nonEmpty[COL_VENDEDOR_SECUNDARIO]) nonEmpty[COL_VENDEDOR_SECUNDARIO] = vendedorIdFromKey(nonEmpty[COL_VENDEDOR_SECUNDARIO]);
      const result = await createItem('oportunidades', name.trim(), nonEmpty, { native });
      if (!result.ok || !result.id) throw new Error('No se asignó ID a la oportunidad.');

      onCreated(result.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la oportunidad.');
      setSaving(false);
    }
  };

  return (
    <Modal
      title={native ? 'Nueva oportunidad (Zona Efrain — nativa)' : 'Nueva oportunidad'}
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
          <SearchableSelect
            value={cols[COL_VENDEDOR] ?? ''} onChange={set(COL_VENDEDOR)}
            options={vendedores.map((v) => ({ value: vendedorKey(v), label: v.nombre }))}
            placeholder="Buscar vendedor…"
          />
        </Field>
        <Field label="Vendedor secundario">
          <SearchableSelect
            value={cols[COL_VENDEDOR_SECUNDARIO] ?? ''} onChange={set(COL_VENDEDOR_SECUNDARIO)}
            options={vendedores.map((v) => ({ value: vendedorKey(v), label: v.nombre }))}
            placeholder="Buscar vendedor secundario…"
          />
        </Field>
        <Field label="Compras">
          <SearchableSelect
            value={cols[COL_COMPRAS] ?? ''} onChange={set(COL_COMPRAS)}
            options={compras.map((v) => ({ value: String(v.id), label: v.nombre }))}
            placeholder="Buscar responsable de compras…"
          />
        </Field>
        <Field label="Contacto (cliente)">
          <SearchableSelect
            value={cols[COL_CONTACTO] ?? ''} onChange={set(COL_CONTACTO)} options={contactOptions}
            placeholder="Buscar contacto…"
            disabled={!selectedVendedorKey}
            disabledMessage="Elige primero un vendedor…"
            emptyMessage="Este vendedor no tiene contactos asignados."
          />
        </Field>
        <Field label="Zona">
          <SearchableSelect value={cols[COL_ZONA] ?? ''} onChange={set(COL_ZONA)} options={labelOptions(oppCols, COL_ZONA)} placeholder="Buscar zona…" />
        </Field>
        <Field label="Tipo de cotización">
          <ChipSelect value={cols[COL_TIPO] ?? ''} onChange={set(COL_TIPO)} options={labelOptions(oppCols, COL_TIPO)} />
        </Field>
        <Field label="¿Quieres cotizar nuevos productos?">
          <ChipSelect value={cols[COL_NUEVOS] ?? ''} onChange={set(COL_NUEVOS)} options={labelOptions(oppCols, COL_NUEVOS)} />
        </Field>
        <Field label="Fecha límite">
          <input
            ref={fechaLimiteRef}
            type="date"
            value={cols[COL_FECHA_LIMITE] ?? ''}
            onChange={(e) => set(COL_FECHA_LIMITE)(e.target.value)}
            onClick={() => fechaLimiteRef.current?.showPicker?.()}
            style={fieldStyle}
          />
        </Field>
        {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
      </div>
    </Modal>
  );
}
