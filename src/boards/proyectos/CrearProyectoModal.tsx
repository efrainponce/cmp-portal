// Formulario "Nuevo proyecto" — un Proyecto que nace SIN Oportunidad ligada
// (Efraín, 2026-08-26: "que todos puedan hacer proyectos sin necesidad de tener
// una oportunidad, para poder hacer órdenes de compra from scratch"). Hasta
// ahora el único camino era GANAR una oportunidad (worker/lib/ganarOportunidad.ts),
// así que una compra sin venta detrás no tenía dónde vivir.
//
// Deliberadamente mínimo, igual que "Nueva oportunidad": las líneas de la OC se
// capturan después con "+ Agregar producto" del tab Órdenes de compra. La
// columna Oportunidad no está en el form a propósito — ligar se hace ganando la
// oportunidad (ver shared/createFields.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../components/core/Modal';
import { Button } from '../../components/core/Button';
import { SearchableSelect, type SearchableOption } from '../../components/forms/SearchableSelect';
import { useMe } from '../../lib/useMe';
import {
  apiFetch, useBoards, colForBoard, createItem, getVendedores, vendedorKey, vendedorIdFromKey,
  type ColMeta, type ItemDTO, type ListResponse, type VendedorDTO,
} from '../../lib/api';

// Ids reales de Monday (docs/monday-column-map.md) — nunca fabricar.
const COL_VENDEDOR = 'multiple_person_mm0hrnqq';
const COL_COMPRAS = 'project_owner';
const COL_CONTACTO = 'board_relation_mm0hb0gy';
const COL_ZONA = 'dropdown_mm0hnyv';
const COL_FECHA_ENTREGA = 'date_mm0m1vfv';

// Vendedor del board Contactos — el mismo filtro que usa "Nueva oportunidad".
const COL_CONTACTO_VENDEDOR = 'multiple_person_mm03vqwx';

const fieldStyle = {
  width: '100%', font: 'var(--text-body)', color: 'var(--ink)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: '8px 10px', boxSizing: 'border-box',
} as const;

function labelOptions(cols: ColMeta[], id: string): { value: string; label: string }[] {
  const labels = cols.find((c) => c.id === id)?.labels ?? {};
  return Object.values(labels).map((l) => ({ value: l.label, label: l.label }));
}

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

export default function CrearProyectoModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  /** Llamado con el id del Proyecto nuevo (el folio lo asigna Monday aparte). */
  onCreated: (itemId: string) => void;
}) {
  const me = useMe();
  const { boards } = useBoards();
  const proyectoCols = colForBoard(boards, 'proyectos');

  const [name, setName] = useState('');
  const [cols, setCols] = useState<Record<string, string>>({});
  const [vendedores, setVendedores] = useState<VendedorDTO[]>([]);
  const [compras, setCompras] = useState<VendedorDTO[]>([]);
  const [contactos, setContactos] = useState<ItemDTO[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fechaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getVendedores('vendedor').then(setVendedores);
    getVendedores('compras').then(setCompras);
    apiFetch('/boards/contactos/items')
      .then((r) => (r.ok ? (r.json() as Promise<ListResponse>) : Promise.reject()))
      .then((json) => setContactos(json.items))
      .catch(() => setContactos([]));
  }, []);

  // Vendedor y Compras son las DOS llaves de scoping del board (worker/lib/dal.ts:
  // authzCols = Vendedor para el rol vendedor, comprasCol = Compras para el rol
  // compras), así que quien crea se prellena en la que le toca — si no, el
  // proyecto nacería invisible para él mismo. Empareja por email además de por
  // id: dos personas pueden compartir monday_user_id ("Actuar en Monday como",
  // ver vendedorKey).
  useEffect(() => {
    const propio = vendedores.find((v) => v.id === me?.mondayUserId && v.email === me?.email);
    if (propio && !cols[COL_VENDEDOR]) setCols((c) => ({ ...c, [COL_VENDEDOR]: vendedorKey(propio) }));
  }, [me, vendedores]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const propio = compras.find((v) => v.id === me?.mondayUserId && v.email === me?.email);
    if (propio && !cols[COL_COMPRAS]) setCols((c) => ({ ...c, [COL_COMPRAS]: vendedorKey(propio) }));
  }, [me, compras]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mismo criterio que "Nueva oportunidad" (Efraín, 2026-07-17): un contacto es
  // "de" un vendedor, así que la lista se acota al vendedor elegido y el
  // contacto ya elegido se limpia si deja de pertenecerle.
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
    if (!(cols[COL_COMPRAS] ?? '').trim()) { setError('Falta elegir el responsable de compras.'); return; }
    setSaving(true);
    setError(null);
    try {
      const nonEmpty = Object.fromEntries(Object.entries(cols).filter(([, v]) => v.trim() !== ''));
      // Las columnas de personas viajan como `id::email` en el estado del form
      // (ver vendedorKey) — Monday solo entiende el id numérico.
      for (const id of [COL_VENDEDOR, COL_COMPRAS]) {
        if (nonEmpty[id]) nonEmpty[id] = vendedorIdFromKey(nonEmpty[id]);
      }
      const result = await createItem('proyectos', name.trim(), nonEmpty);
      if (!result.ok || !result.id) throw new Error('No se asignó ID al proyecto.');
      onCreated(result.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el proyecto.');
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Nuevo proyecto"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={saving ? undefined : onSubmit}>{saving ? 'Creando…' : 'Crear proyecto'}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>
          Nace sin Oportunidad ligada: sirve para levantar una orden de compra desde cero. Los
          productos se capturan después, en el tab «Órdenes de compra».
        </div>
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
        <Field label="Compras" required>
          <SearchableSelect
            value={cols[COL_COMPRAS] ?? ''} onChange={set(COL_COMPRAS)}
            options={compras.map((v) => ({ value: vendedorKey(v), label: v.nombre }))}
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
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)', marginTop: 4 }}>
            De aquí sale la Institución que se ve en la lista de proyectos.
          </div>
        </Field>
        <Field label="Zona">
          <SearchableSelect
            value={cols[COL_ZONA] ?? ''} onChange={set(COL_ZONA)}
            options={labelOptions(proyectoCols, COL_ZONA)} placeholder="Buscar zona…"
          />
        </Field>
        <Field label="Fecha de entrega">
          <input
            ref={fechaRef}
            type="date"
            value={cols[COL_FECHA_ENTREGA] ?? ''}
            onChange={(e) => set(COL_FECHA_ENTREGA)(e.target.value)}
            onClick={() => fechaRef.current?.showPicker?.()}
            style={fieldStyle}
          />
        </Field>
        {error && <div style={{ color: 'var(--status-perdida)', font: 'var(--text-label)' }}>{error}</div>}
      </div>
    </Modal>
  );
}
