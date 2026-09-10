// Formulario "Nueva oportunidad" — deliberadamente mínimo (Efraín 2026-07-15):
// nombre, vendedor, compras, contacto, zona, tipo de cotización, ¿nuevos
// productos? y fecha límite. Las líneas de producto se capturan después; la
// validación de enviar-costeo impide avanzar sin ellas. Cargado lazy desde
// OportunidadesBoard para no pesar en el bundle inicial.
// Contacto e Institución se dan de alta aquí mismo con «+ Nuevo» (Efraín,
// 2026-09-10): abre encima el form de los catálogos (CreateRecordModal).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../components/core/Modal';
import { Button } from '../../components/core/Button';
import { SearchableSelect, type SearchableOption } from '../../components/forms/SearchableSelect';
import { ChipSelect } from '../../components/forms/ChipSelect';
import { CreateRecordModal, type RecordCreado } from '../generic/CreateRecordModal';
import { useMe } from '../../lib/useMe';
import {
  apiFetch, useBoards, colForBoard, createItem, getVendedores, patchItem, vendedorKey, vendedorIdFromKey,
  type ColMeta, type ItemDTO, type ListResponse, type VendedorDTO,
} from '../../lib/api';
import { isNativeId } from '../../../shared/nativeId';

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
// Institución del CONTACTO (board Contactos). La oportunidad no tiene columna
// propia: la suya es un espejo de esta (docs/monday-column-map.md), así que
// elegirla en este form escribe el contacto — ver onSubmit.
const COL_CONTACTO_INSTITUCION = 'contact_account';

/** Primer id ligado de un board_relation ya serializado en el DTO. */
function linkedId(item: ItemDTO | undefined, colId: string): string {
  const value = item?.cols[colId]?.value as { linked_item_ids?: unknown[] } | undefined;
  const id = value?.linked_item_ids?.[0];
  return id == null ? '' : String(id);
}

function personIds(item: ItemDTO, colId: string): number[] {
  const value = item.cols[colId]?.value as { personsAndTeams?: { id: number }[] } | undefined;
  return value?.personsAndTeams?.map((p) => p.id) ?? [];
}

/** Renglón armado en el cliente para lo que se acaba de dar de alta en este
 * form: las listas se bajan una vez al abrirlo y no se vuelven a pedir
 * (Instituciones son 3k registros). Solo trae lo que este form lee. */
function itemLocal(id: string, name: string, cols: ItemDTO['cols'] = {}): ItemDTO {
  return { id, name, cols, syncedAt: new Date().toISOString(), mondayUpdatedAt: null };
}

/** Lo del server más lo dado de alta aquí que el server aún no traía — por si
 * la lista llega después del alta. */
function juntar(delServer: ItemDTO[], locales: ItemDTO[]): ItemDTO[] {
  const ids = new Set(delServer.map((i) => i.id));
  return [...delServer, ...locales.filter((i) => !ids.has(i.id))];
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

/** Picker + botón de alta en el mismo renglón — el acomodo del «+ Nueva» de
 * Institución en CreateRecordModal. */
function ConAlta({ label, activo, onClick, children }: {
  label: string; activo: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      <Button variant={activo ? 'secondary' : 'disabled'} onClick={onClick} style={{ flex: 'none', whiteSpace: 'nowrap' }}>
        {label}
      </Button>
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
  const [instituciones, setInstituciones] = useState<ItemDTO[]>([]);
  // Fuera de `cols`: no es una columna de la oportunidad (se escribe en el
  // contacto) y el create fail-closed rechazaría cualquier id que no esté en
  // shared/createFields.ts.
  const [institucionId, setInstitucionId] = useState('');
  // Alta en línea abierta encima de este form (CreateRecordModal).
  const [alta, setAlta] = useState<'contacto' | 'institucion' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fechaLimiteRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getVendedores('vendedor').then(setVendedores);
    getVendedores('compras').then(setCompras);
    apiFetch('/boards/contactos/items')
      .then((r) => (r.ok ? (r.json() as Promise<ListResponse>) : Promise.reject()))
      .then((json) => setContactos((locales) => juntar(json.items, locales)))
      .catch(() => {});
    // Solo nombre (?cols=): el picker no pinta nada más y el board completo
    // pesa de más — misma proyección que usePoll(SOLO_NOMBRE).
    apiFetch('/boards/instituciones/items?cols=')
      .then((r) => (r.ok ? (r.json() as Promise<ListResponse>) : Promise.reject()))
      .then((json) => setInstituciones((locales) => juntar(json.items, locales)))
      .catch(() => {});
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

  // La Institución arranca en la que ya trae el contacto (lo normal: no se
  // toca). Cambiarla aquí RELIGA al contacto — el aviso de abajo lo dice.
  const contactoSeleccionado = contactos.find((c) => c.id === cols[COL_CONTACTO]);
  const institucionDelContacto = linkedId(contactoSeleccionado, COL_CONTACTO_INSTITUCION);
  useEffect(() => {
    setInstitucionId(institucionDelContacto);
  }, [institucionDelContacto]);

  const set = (id: string) => (value: string) => setCols((c) => ({ ...c, [id]: value }));

  const agregarInstitucion = (inst: { id: string; name: string }) => {
    setInstituciones((is) => juntar(is, [itemLocal(inst.id, inst.name)]));
  };

  // El contacto nuevo entra a la lista con lo que este form lee de él —su
  // vendedor, para el filtro de arriba, y su institución— y queda elegido; la
  // Institución la toma de ahí como con cualquier otro contacto.
  const onContactoCreado = (creado?: RecordCreado) => {
    if (!creado) return;
    const inst = creado.institucion;
    const nuevo = itemLocal(creado.id, creado.name, {
      [COL_CONTACTO_VENDEDOR]: {
        type: 'people', text: '',
        value: { personsAndTeams: [{ id: Number(creado.cols[COL_CONTACTO_VENDEDOR]), kind: 'person' }] },
      },
      ...(inst && {
        [COL_CONTACTO_INSTITUCION]: { type: 'board_relation', text: inst.name, value: { linked_item_ids: [inst.id] } },
      }),
    });
    setContactos((cs) => juntar(cs, [nuevo]));
    if (inst) agregarInstitucion(inst);
    setCols((c) => ({ ...c, [COL_CONTACTO]: creado.id }));
  };

  const onInstitucionCreada = (creada?: RecordCreado) => {
    if (!creada) return;
    agregarInstitucion(creada);
    setInstitucionId(creada.id);
  };

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
      // Primero el contacto, después la oportunidad: la Institución de la
      // oportunidad es un espejo del contacto y en una oportunidad NATIVA se
      // copia en el momento de crearla (worker/lib/createRecord.ts) — al revés
      // nacería con la institución vieja.
      const contactoId = nonEmpty[COL_CONTACTO];
      if (contactoId && institucionId && institucionId !== institucionDelContacto) {
        const res = await patchItem('contactos', contactoId, { [COL_CONTACTO_INSTITUCION]: institucionId });
        if (!res.ok) throw new Error(res.error ?? 'No se pudo ligar la institución al contacto.');
      }
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
          <ConAlta label="+ Nuevo" activo={!!selectedVendedorKey} onClick={() => setAlta('contacto')}>
            <SearchableSelect
              value={cols[COL_CONTACTO] ?? ''} onChange={set(COL_CONTACTO)} options={contactOptions}
              placeholder="Buscar contacto…"
              disabled={!selectedVendedorKey}
              disabledMessage="Elige primero un vendedor…"
              emptyMessage="Sin contactos de este vendedor. Usa «+ Nuevo» para darlo de alta."
            />
          </ConAlta>
        </Field>
        <Field label="Institución">
          <ConAlta label="+ Nueva" activo={!!cols[COL_CONTACTO]} onClick={() => setAlta('institucion')}>
            <SearchableSelect
              value={institucionId} onChange={setInstitucionId}
              options={instituciones.map((i) => ({ value: i.id, label: i.name }))}
              placeholder="Buscar institución…"
              disabled={!cols[COL_CONTACTO]}
              disabledMessage="Elige primero un contacto…"
              emptyMessage="Sin resultados. Usa «+ Nueva» para crearla."
            />
          </ConAlta>
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)', marginTop: 4 }}>
            {institucionId && institucionDelContacto && institucionId !== institucionDelContacto
              ? '⚠ También cambia la institución del contacto (de ahí la toma la oportunidad).'
              : 'Se guarda en el contacto: la oportunidad la hereda de él.'}
          </div>
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

        {/* El contacto nace donde vive la oportunidad: una de Monday no puede
            ligar uno nativo (assertNoNativeLink) y el de una nativa no debe
            existir en Monday (worker/lib/zonas.ts catalogoNaceNativo). Es del
            vendedor de la oportunidad — si no, el filtro de arriba lo escondería. */}
        {alta === 'contacto' && (
          <CreateRecordModal
            slug="contactos"
            title={native ? 'Nuevo contacto (Zona Efrain — nativo)' : 'Nuevo contacto'}
            native={!!native}
            fijos={{ cols: { [COL_CONTACTO_VENDEDOR]: selectedVendedorKey }, motivo: 'Es el vendedor de la oportunidad.' }}
            onClose={() => setAlta(null)}
            onCreated={onContactoCreado}
          />
        )}
        {/* La institución se liga desde el contacto: si el contacto vive en
            Monday, ella también; si es nativo, decide el server. */}
        {alta === 'institucion' && (
          <CreateRecordModal
            slug="instituciones"
            title="Nueva institución"
            native={isNativeId(Number(cols[COL_CONTACTO])) ? undefined : false}
            onClose={() => setAlta(null)}
            onCreated={onInstitucionCreada}
          />
        )}
      </div>
    </Modal>
  );
}
