// Tab "Logística" de la sección Proyecto — encargado/guías/evidencia de la
// recolección con el transportista, capturado por Compras a partir de la
// vista que ya usaban en Monday. Mismo agrupado por producto+color que
// TallasSection/EjecucionSection (groupByProductoColor/TallaGroup), tarjetas
// con contenido propio: por línea, un resumen compacto visible a todos
// (Estado, Producción/Aplicación, Unidad — ya eran `vis: V`) y, solo para
// Compras/Admin, un detalle expandible con los campos de recolección
// (Encargado, # de recolección, guías, evidencia, confirmación y fecha —
// ya eran `vis: AC`, ahora también `w: AC`, shared/visibility.ts 2026-08-17).
import { useState, type ChangeEvent } from 'react';
import {
  patchItem, getVendedores, uploadLogisticaArchivo, vendedorKey, vendedorIdFromKey,
  type ItemDTO, type VendedorDTO,
} from '../../../lib/api';
import { useMe } from '../../../lib/useMe';
import { Button } from '../../../components/core/Button';
import { MonoTag } from '../../../components/core/Badges';
import { Select } from '../../../components/forms/Select';
import {
  type ProyectoState, Shell, ESTADO_PRODUCTO_COLORS, FileList, parseFiles, toR2Files,
  S_ESTADO, S_TALLA, S_CANTIDAD,
} from './shared';
import { groupByProductoColor, type TallaGroup } from './TallasSection';

const S_PRODUCCION = 'text_mm52x1bx';       // solo lectura (vis V, sin w)
const S_UNIDAD = 'text_mm56dbkm';           // solo lectura (vis V, sin w)
const S_ENCARGADO = 'multiple_person_mm4pc2ns';
const S_RECOLECCION = 'text_mm4ph3a9';      // "# DE RECOLECCION"
const S_COMENTARIOS = 'text_mm6aapc8';
const S_GUIA_CLIENTE = 'text_mm4pywyx';     // "Guia EMB o Cliente Final"
const S_GUIA_EMPRESA = 'file_mm4pz90b';     // "# Guia - empresa"
const S_EVIDENCIA = 'file_mm4pc4tj';        // "Evidencia recolección"
const S_CONFIRMAR = 'boolean_mm4p7eqb';
const S_FECHA_CONF = 'date_mm4p59q2';

const fieldBtnStyle = { padding: '6px 14px', font: 'var(--text-label)' } as const;

/** Popover de texto (una línea o textarea) — mismo idiom que ResumenBlock de
 * EjecucionSection.tsx: un solo popover abierto a la vez en todo el tab
 * (Efraín, 2026-08-06), el estado `isOpen`/`onOpen`/`onClose` vive arriba. */
function TextField({ label, value, colId, rowId, multiline, isOpen, onOpen, onClose, onSaved }: {
  label: string; value: string; colId: string; rowId: string; multiline?: boolean;
  isOpen: boolean; onOpen: () => void; onClose: () => void; onSaved: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const abrir = () => { setDraft(value); setError(undefined); onOpen(); };
  const guardar = async () => {
    setSaving(true); setError(undefined);
    try {
      await patchItem('proyectos_sub', rowId, { [colId]: draft.trim() });
      setSaving(false);
      onSaved();
      onClose();
    } catch {
      setSaving(false);
      setError('No se pudo guardar');
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ font: 'var(--text-caption-strong)', color: 'var(--ink-tertiary)' }}>{label}</div>
      <div
        onClick={abrir}
        title="Editar"
        style={{
          font: 'var(--text-label)', color: value ? 'var(--ink)' : 'var(--ink-quiet)',
          padding: '4px 6px', marginTop: 2, borderRadius: 'var(--radius-md)', cursor: 'pointer',
          background: 'var(--bg-sunken)', minHeight: 20, wordBreak: 'break-word',
        }}
      >
        {value || 'Sin capturar — click para agregar'}
      </div>
      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 5, width: 260,
          background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)',
          boxShadow: '0 6px 20px rgba(0,0,0,.15)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {multiline ? (
            <textarea
              value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus
              style={{ font: 'var(--text-label)', padding: '7px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', resize: 'vertical' }}
            />
          ) : (
            <input
              value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
              style={{ font: 'var(--text-label)', padding: '7px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}
            />
          )}
          {error && <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" style={fieldBtnStyle} onClick={saving ? undefined : onClose}>Cancelar</Button>
            <Button style={fieldBtnStyle} onClick={saving ? undefined : guardar}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Encargado Logística — mismo roster que EditPersonaModal (compras), popover
 * en vez de modal para quedarse en el mismo idiom que el resto de la fila. */
function PersonField({ label, value, rowId, isOpen, onOpen, onClose, onSaved }: {
  label: string; value: string; rowId: string;
  isOpen: boolean; onOpen: () => void; onClose: () => void; onSaved: () => void;
}) {
  const [options, setOptions] = useState<VendedorDTO[]>([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const abrir = () => {
    setDraft(''); setError(undefined);
    getVendedores('compras').then(setOptions);
    onOpen();
  };
  const guardar = async () => {
    if (!draft) { setError('Falta elegir a alguien'); return; }
    setSaving(true); setError(undefined);
    try {
      await patchItem('proyectos_sub', rowId, { [S_ENCARGADO]: vendedorIdFromKey(draft) });
      setSaving(false);
      onSaved();
      onClose();
    } catch {
      setSaving(false);
      setError('No se pudo guardar');
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ font: 'var(--text-caption-strong)', color: 'var(--ink-tertiary)' }}>{label}</div>
      <div
        onClick={abrir}
        title="Editar"
        style={{
          font: 'var(--text-label)', color: value ? 'var(--ink)' : 'var(--ink-quiet)',
          padding: '4px 6px', marginTop: 2, borderRadius: 'var(--radius-md)', cursor: 'pointer', background: 'var(--bg-sunken)',
        }}
      >
        {value || 'Sin asignar — click para elegir'}
      </div>
      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 5, width: 240,
          background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)',
          boxShadow: '0 6px 20px rgba(0,0,0,.15)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <Select
            value={draft} onChange={setDraft}
            options={options.map((v) => ({ value: vendedorKey(v), label: v.nombre }))}
            placeholder="Elegir encargado…"
          />
          {error && <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" style={fieldBtnStyle} onClick={saving ? undefined : onClose}>Cancelar</Button>
            <Button style={fieldBtnStyle} onClick={saving ? undefined : guardar}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Checkbox y fecha se guardan directo al cambiar — sin popover, mismo idiom
 * que FechaEntregaField (DocumentacionTab.tsx): un solo control atómico no
 * necesita confirmar/cancelar. */
function CheckboxField({ label, checked, rowId, onSaved }: { label: string; checked: boolean; rowId: string; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const toggle = async () => {
    setSaving(true);
    try {
      await patchItem('proyectos_sub', rowId, { [S_CONFIRMAR]: checked ? '' : 'true' });
      onSaved();
    } finally {
      setSaving(false);
    }
  };
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: saving ? 'default' : 'pointer' }}>
      <input type="checkbox" checked={checked} disabled={saving} onChange={() => void toggle()} />
      <span style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)' }}>{label}</span>
    </label>
  );
}

function DateField({ label, value, rowId, onSaved }: { label: string; value: string; rowId: string; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const save = async (raw: string) => {
    if (raw === value) return;
    setSaving(true);
    try {
      await patchItem('proyectos_sub', rowId, { [S_FECHA_CONF]: raw });
      onSaved();
    } finally {
      setSaving(false);
    }
  };
  return (
    <div>
      <div style={{ font: 'var(--text-caption-strong)', color: 'var(--ink-tertiary)' }}>{label}</div>
      <input
        type="date" defaultValue={value} key={value} disabled={saving}
        onChange={(e) => void save(e.target.value)}
        style={{
          marginTop: 2, padding: '5px 7px', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', background: 'var(--bg)', color: 'var(--ink)', font: 'var(--text-label)',
        }}
      />
    </div>
  );
}

/** # Guia - empresa / Evidencia recolección — mismo dropzone real que
 * OcContratoSection (DocumentacionTab.tsx), apuntando al endpoint nuevo
 * POST /api/proyectos_sub/:id/logistica/:field (worker/routes/oportunidades.ts). */
function FileField({ label, field, colId, row, oppId, onSaved }: {
  label: string; field: 'guia-empresa' | 'evidencia-recoleccion'; colId: string;
  row: ItemDTO; oppId: string | null; onSaved: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    const res = await uploadLogisticaArchivo(row.id, field, file);
    setUploading(false);
    if (!res.ok) { setError(res.error ?? 'No se pudo subir el archivo.'); return; }
    onSaved();
  };

  const files = oppId ? toR2Files(parseFiles(row.cols[colId]?.text), oppId, `logistica/${row.id}/${field}`) : parseFiles(row.cols[colId]?.text);

  return (
    <div>
      <div style={{ font: 'var(--text-caption-strong)', color: 'var(--ink-tertiary)', marginBottom: 4 }}>{label}</div>
      <label style={{
        display: 'flex', alignItems: 'center', gap: 8, border: `1px dashed ${error ? 'var(--status-perdida)' : 'var(--ink-faint)'}`,
        borderRadius: 'var(--radius-lg)', padding: '7px 10px', cursor: uploading ? 'default' : 'pointer', background: 'var(--bg)',
      }}>
        <span style={{ font: 'var(--text-caption)', color: error ? 'var(--status-perdida)' : 'var(--ink-secondary)' }}>
          {uploading ? 'Subiendo…' : error ? `Error — reintentar (${error})` : 'Subir archivo'}
        </span>
        <input type="file" onChange={handleFile} style={{ display: 'none' }} disabled={uploading} />
      </label>
      {files.length > 0 && <div style={{ marginTop: 6 }}><FileList label="" files={files} /></div>}
    </div>
  );
}

/** Fila compacta (Talla/Cantidad/Estado/Producción/Unidad, visible a todos) +
 * detalle expandible (Compras/Admin) con los campos de recolección. */
function LogisticaLineaRow({ row, canEdit, oppId, expanded, onToggleExpand, openPopover, setOpenPopover, onChanged }: {
  row: ItemDTO; canEdit: boolean; oppId: string | null; expanded: boolean; onToggleExpand: () => void;
  openPopover: string | null; setOpenPopover: (key: string | null) => void; onChanged: () => void;
}) {
  const estado = row.cols[S_ESTADO]?.text || '';
  const color = ESTADO_PRODUCTO_COLORS[estado] ?? '#9aa5b1';
  const popKey = (name: string) => `${row.id}:${name}`;

  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '8px 10px' }}>
      <div
        onClick={canEdit ? onToggleExpand : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', cursor: canEdit ? 'pointer' : 'default' }}
      >
        <span style={{ font: 'var(--text-label-strong)', color: 'var(--ink)', minWidth: 36 }}>{row.cols[S_TALLA]?.text || '—'}</span>
        <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>× {row.cols[S_CANTIDAD]?.text || '0'}</span>
        {estado && (
          <span style={{
            font: 'var(--text-caption-strong)', color, background: color + '22',
            border: `1px solid ${color}66`, borderRadius: 'var(--radius-pill)', padding: '2px 8px',
          }}>
            {estado}
          </span>
        )}
        {row.cols[S_PRODUCCION]?.text && (
          <span style={{ font: 'var(--text-caption)', color: 'var(--ink-secondary)' }}>{row.cols[S_PRODUCCION]?.text}</span>
        )}
        {row.cols[S_UNIDAD]?.text && (
          <span style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>{row.cols[S_UNIDAD]?.text}</span>
        )}
        {canEdit && <span style={{ marginLeft: 'auto', font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>{expanded ? '▾' : '▸'}</span>}
      </div>

      {canEdit && expanded && (
        <div style={{
          marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-subtle)',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
        }}>
          <PersonField
            label="Encargado Logística" value={row.cols[S_ENCARGADO]?.text || ''} rowId={row.id}
            isOpen={openPopover === popKey('encargado')} onOpen={() => setOpenPopover(popKey('encargado'))}
            onClose={() => setOpenPopover(null)} onSaved={onChanged}
          />
          <TextField
            label="# de recolección" value={row.cols[S_RECOLECCION]?.text || ''} colId={S_RECOLECCION} rowId={row.id}
            isOpen={openPopover === popKey('recoleccion')} onOpen={() => setOpenPopover(popKey('recoleccion'))}
            onClose={() => setOpenPopover(null)} onSaved={onChanged}
          />
          <TextField
            label="Guía EMB o Cliente Final" value={row.cols[S_GUIA_CLIENTE]?.text || ''} colId={S_GUIA_CLIENTE} rowId={row.id}
            isOpen={openPopover === popKey('guiaCliente')} onOpen={() => setOpenPopover(popKey('guiaCliente'))}
            onClose={() => setOpenPopover(null)} onSaved={onChanged}
          />
          <TextField
            label="Comentarios" value={row.cols[S_COMENTARIOS]?.text || ''} colId={S_COMENTARIOS} rowId={row.id} multiline
            isOpen={openPopover === popKey('comentarios')} onOpen={() => setOpenPopover(popKey('comentarios'))}
            onClose={() => setOpenPopover(null)} onSaved={onChanged}
          />
          <DateField label="Fecha confirmación" value={row.cols[S_FECHA_CONF]?.text || ''} rowId={row.id} onSaved={onChanged} />
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <CheckboxField label="Confirmar tallas completas" checked={!!row.cols[S_CONFIRMAR]?.text} rowId={row.id} onSaved={onChanged} />
          </div>
          <FileField label="# Guía - empresa" field="guia-empresa" colId={S_GUIA_EMPRESA} row={row} oppId={oppId} onSaved={onChanged} />
          <FileField label="Evidencia recolección" field="evidencia-recoleccion" colId={S_EVIDENCIA} row={row} oppId={oppId} onSaved={onChanged} />
        </div>
      )}
    </div>
  );
}

function LogisticaCard({ group, canEdit, oppId, expandedRows, setExpandedRows, openPopover, setOpenPopover, onChanged }: {
  group: TallaGroup; canEdit: boolean; oppId: string | null;
  expandedRows: Record<string, boolean>; setExpandedRows: (r: Record<string, boolean>) => void;
  openPopover: string | null; setOpenPopover: (key: string | null) => void; onChanged: () => void;
}) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 14, background: '#fff' }}>
      <div>
        <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{group.producto}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
          {group.sku && <MonoTag>{group.sku}</MonoTag>}
          {group.color && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>{group.color}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        {group.rows.map((r) => (
          <LogisticaLineaRow
            key={r.id} row={r} canEdit={canEdit} oppId={oppId}
            expanded={!!expandedRows[r.id]}
            onToggleExpand={() => setExpandedRows({ ...expandedRows, [r.id]: !expandedRows[r.id] })}
            openPopover={openPopover} setOpenPopover={setOpenPopover} onChanged={onChanged}
          />
        ))}
      </div>
    </div>
  );
}

export function LogisticaSection({ state, oppId }: { state: ProyectoState; oppId: string | null }) {
  const me = useMe();
  const canEdit = me?.role === 'compras' || me?.role === 'admin';
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [openPopover, setOpenPopover] = useState<string | null>(null);

  if (state.loading) return <Shell hint="Buscando el proyecto ligado…" />;
  if (!state.proyecto) {
    return <Shell hint="Esta oportunidad aún no tiene Proyecto en Monday — la logística arranca cuando se generan las órdenes de compra a proveedor." />;
  }
  const lineas = state.proyecto.children ?? [];
  const grupos = groupByProductoColor(lineas);

  return (
    <div style={{ marginTop: 16 }}>
      {canEdit && lineas.length > 0 && (
        <div style={{ marginBottom: 10, font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>
          Toca una línea para capturar encargado, guías, evidencia y confirmación de la recolección.
        </div>
      )}
      {lineas.length === 0 ? (
        <div style={{ font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
          Aún no hay líneas en el proyecto — importa las tallas primero.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {grupos.map((g) => (
            <LogisticaCard
              key={`${g.producto}|${g.color}`} group={g} canEdit={canEdit} oppId={oppId}
              expandedRows={expandedRows} setExpandedRows={setExpandedRows}
              openPopover={openPopover} setOpenPopover={setOpenPopover} onChanged={state.reload}
            />
          ))}
        </div>
      )}
      {!canEdit && (
        <div style={{ marginTop: 14, font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>
          El encargado, las guías y la evidencia de recolección los captura Compras.
        </div>
      )}
      {openPopover && (
        <div onClick={() => setOpenPopover(null)} style={{ position: 'fixed', inset: 0, zIndex: 4 }} />
      )}
    </div>
  );
}
