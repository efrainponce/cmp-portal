// Tab "Ejecución" de la sección Proyecto — batería agregada + una tabla por
// producto+color con UN renglón por talla: estado, comentario y entrega del
// proveedor se editan AHÍ MISMO (select y texto en línea, como en Monday), y
// varias tallas se cambian de una vez (casillas + barra de abajo, o "Todas a…"
// en el encabezado del producto). Antes cada talla era un chip que abría un
// popover — Efraín, 2026-09-29: "tienes que darle click a cada talla, no es
// funcional". Reusa el agrupado de TallasSection.tsx (groupByProductoColor).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getEstadoHistorial, getProductoResumen, patchProductoResumen, patchItem, type EstadoHistorialEntryDTO, type ItemDTO } from '../../../lib/api';
import { useMe } from '../../../lib/useMe';
import { useIsMobile } from '../../../lib/useIsMobile';
import { Button } from '../../../components/core/Button';
import { MonoTag } from '../../../components/core/Badges';
import { ProgressBattery } from '../../../components/board/ProgressBattery';
import { batteryFromSubitems, ESTADO_PRODUCTO_ORDER } from '../../../lib/estadoProductoBuckets';
import { type ProyectoState, Shell, ESTADO_PRODUCTO_COLORS, S_ESTADO, S_CANTIDAD, S_TALLA, S_ENTREGA_PROV } from './shared';
import { groupByProductoColor, type TallaGroup } from './TallasSection';

// Comentario de Estado (proyectos_sub) — junto con S_ESTADO, editables solo por
// compras/admin (shared/visibility.ts, grupo AC) desde el tab Ejecución.
const S_COMENTARIO = 'text_mm20gzsb';
const INCIDENCIA = 'Incidencia/Retraso';
const ESTADO_DEFAULT = 'Pendiente OC al Prov';

/** Cambio de un renglón (lo que se manda a guardar). */
type Override = { estado?: string; comentario?: string; entrega?: string };
type Campo = keyof Override;
/** Lo recién guardado por renglón: el espejo D1 tarda en confirmar el write a
 * Monday, así que la tabla (y la batería) pinta `v` mientras el espejo siga en
 * `base` (lo que tenía al guardar). En cuanto el espejo cambia — a lo nuestro o
 * a lo que alguien más puso en Monday — manda el espejo. */
type Pendientes = Partial<Record<Campo, { v: string; base: string }>>;
const COL_DE: Record<Campo, string> = { estado: S_ESTADO, comentario: S_COMENTARIO, entrega: S_ENTREGA_PROV };
const espejo = (r: ItemDTO, campo: Campo) => r.cols[COL_DE[campo]]?.text || '';

const btnStyle = { padding: '6px 14px', font: 'var(--text-label)' } as const;
const inputStyle = {
  font: 'var(--text-label)', color: 'var(--ink)', padding: '5px 7px', boxSizing: 'border-box' as const,
  borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: '#fff', width: '100%',
};

const cantidadDe = (r: ItemDTO) => Number((r.cols[S_CANTIDAD]?.text || '0').replace(/,/g, '')) || 0;

/** Texto negro sobre los colores claros de Monday (En produccion, Pendiente de
 * Recolectar…) y blanco sobre los oscuros — si no, el label no se lee. */
function textoSobre(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? 'var(--ink)' : '#fff';
}

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

const quien = (changedBy: string | null) => (changedBy ? changedBy.split('@')[0] : '');

/** Select de estado pintado del color del estado — como la columna status de Monday. */
function EstadoSelect({ value, onChange, disabled, compact }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; compact?: boolean;
}) {
  const color = ESTADO_PRODUCTO_COLORS[value] ?? '#9aa5b1';
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      style={{
        width: '100%', font: compact ? 'var(--text-caption-strong)' : 'var(--text-label-strong)',
        padding: compact ? '4px 6px' : '5px 8px', borderRadius: 'var(--radius-md)', border: 'none',
        background: color, color: textoSobre(color), cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.9 : 1, appearance: disabled ? 'none' : undefined,
      }}
    >
      {!ESTADO_PRODUCTO_ORDER.includes(value) && <option value={value}>{value}</option>}
      {ESTADO_PRODUCTO_ORDER.map((l) => <option key={l} value={l} style={{ background: '#fff', color: '#111' }}>{l}</option>)}
    </select>
  );
}

/** Texto en línea que guarda al salir o con Enter (Escape descarta). `forzar`
 * abre el campo con foco — lo usa el renglón cuando elige Incidencia sin
 * comentario, que es obligatorio. */
function TextoEnLinea({ value, onSave, placeholder, disabled, forzar, requerido, onCancel, type = 'text' }: {
  value: string; onSave: (v: string) => void; placeholder: string; disabled?: boolean;
  forzar?: boolean; requerido?: boolean; onCancel?: () => void; type?: 'text' | 'date';
}) {
  // `forzar` llega con un `key` distinto desde el renglón, así que monta de nuevo
  // (vacío: es para escribir algo nuevo, no para retocar lo anterior).
  const [draft, setDraft] = useState<string | null>(forzar ? '' : null);

  if (disabled) {
    return <div style={{ font: 'var(--text-label)', color: value ? 'var(--ink-secondary)' : 'var(--ink-quiet)', overflowWrap: 'anywhere' }}>{value || '—'}</div>;
  }
  const commit = () => {
    const next = (draft ?? '').trim();
    setDraft(null);
    if (requerido && !next) { onCancel?.(); return; }
    if (next !== value.trim() || requerido) onSave(next);
  };
  if (draft !== null) {
    return (
      <input
        autoFocus
        type={type}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setDraft(null); onCancel?.(); }
        }}
        style={{ ...inputStyle, borderColor: requerido ? 'var(--status-perdida)' : 'var(--accent)' }}
      />
    );
  }
  return (
    <div
      onClick={() => setDraft(value)}
      className="row-hover"
      title="Clic para editar"
      style={{
        font: 'var(--text-label)', color: value ? 'var(--ink)' : 'var(--ink-quiet)', cursor: 'text',
        padding: '5px 7px', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-subtle)',
        overflowWrap: 'anywhere', minHeight: 18,
      }}
    >
      {value || placeholder}
    </div>
  );
}

/** Resumen libre por producto+color (worker/lib/productoResumen.ts, nativo en
 * D1: el grupo producto+color no es una columna de Monday). Se edita en línea. */
function ResumenInline({ groupKey, resumen, canEdit, proyectoId, onSaved }: {
  groupKey: string; resumen: string; canEdit: boolean; proyectoId: string; onSaved: (resumen: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const guardar = async () => {
    if (draft === null) return;
    const next = draft.trim();
    if (next === resumen) { setDraft(null); return; }
    setSaving(true);
    setError(false);
    const [producto, color] = groupKey.split('|');
    try {
      await patchProductoResumen(proyectoId, producto, color, next);
      onSaved(next);
      setDraft(null);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  if (draft !== null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea
          autoFocus value={draft} rows={2} placeholder="Cómo va este producto…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) guardar();
            if (e.key === 'Escape') setDraft(null);
          }}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
        {error && <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>No se pudo guardar</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" style={btnStyle} onClick={saving ? undefined : () => setDraft(null)}>Cancelar</Button>
          <Button style={btnStyle} onClick={saving ? undefined : guardar}>{saving ? 'Guardando…' : 'Guardar'}</Button>
        </div>
      </div>
    );
  }
  if (!resumen && !canEdit) return null;
  return (
    <div
      onClick={canEdit ? () => setDraft(resumen) : undefined}
      title={canEdit ? 'Editar resumen del producto' : undefined}
      style={{
        display: 'flex', gap: 6, padding: '6px 8px', borderRadius: 'var(--radius-md)', background: 'var(--bg-sunken)',
        cursor: canEdit ? 'text' : 'default',
      }}
    >
      <span style={{ font: 'var(--text-caption-strong)', color: 'var(--ink-tertiary)', flexShrink: 0 }}>Resumen</span>
      <span style={{ font: 'var(--text-caption)', color: resumen ? 'var(--ink-secondary)' : 'var(--ink-quiet)', flex: 1 }}>
        {resumen || 'Sin resumen — clic para agregar'}
      </span>
    </div>
  );
}

interface LineaVista {
  row: ItemDTO;
  estado: string;
  comentario: string;
  entrega: string;
  ultimo?: EstadoHistorialEntryDTO;
}

/** Un renglón = una talla. Cambiar el estado guarda al instante (manda también
 * el comentario, que es lo que queda en el historial); Incidencia/Retraso abre
 * el comentario en rojo y no guarda hasta que se escriba qué pasó. */
function LineaRow({ l, canEdit, isMobile, selected, onToggle, saving, error, historial, verHist, onToggleHist, onGuardar }: {
  l: LineaVista; canEdit: boolean; isMobile: boolean; selected: boolean; onToggle: () => void;
  saving: boolean; error?: string; historial: EstadoHistorialEntryDTO[]; verHist: boolean; onToggleHist: () => void;
  onGuardar: (cambios: Override) => void;
}) {
  const [pendiente, setPendiente] = useState<string | null>(null);
  const estadoMostrado = pendiente ?? l.estado;
  const esIncidencia = estadoMostrado === INCIDENCIA;

  const cambiarEstado = (nuevo: string) => {
    if (nuevo === l.estado) { setPendiente(null); return; }
    // Incidencia pide contar qué pasó AHORA: el comentario anterior suele ser
    // de otro estado ("en producción…") y no explica el retraso.
    if (nuevo === INCIDENCIA) { setPendiente(nuevo); return; }
    setPendiente(null);
    onGuardar({ estado: nuevo, comentario: l.comentario });
  };
  const guardarComentario = (c: string) => {
    if (pendiente) {
      setPendiente(null);
      onGuardar({ estado: pendiente, comentario: c });
    } else {
      onGuardar({ comentario: c });
    }
  };

  const check = canEdit && (
    <input type="checkbox" checked={selected} onChange={onToggle} style={{ width: 16, height: 16, cursor: 'pointer', margin: 0 }} />
  );
  const talla = <span style={{ font: 'var(--text-label-strong)', color: 'var(--ink)' }}>{l.row.cols[S_TALLA]?.text || '—'}</span>;
  const cantidad = <span style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', textAlign: 'right' }}>{l.row.cols[S_CANTIDAD]?.text || '0'}</span>;
  const estado = (
    <div style={{ opacity: saving ? 0.6 : 1 }}>
      <EstadoSelect value={estadoMostrado} onChange={cambiarEstado} disabled={!canEdit || saving} />
    </div>
  );
  const comentario = (
    <TextoEnLinea
      key={pendiente ? 'obligatorio' : 'normal'}
      value={l.comentario}
      disabled={!canEdit}
      placeholder={pendiente ? 'Qué pasó (obligatorio) — Enter para guardar' : esIncidencia ? 'Qué pasó…' : 'Agregar comentario'}
      forzar={!!pendiente}
      requerido={!!pendiente}
      onCancel={() => setPendiente(null)}
      onSave={guardarComentario}
    />
  );
  const entrega = (
    <TextoEnLinea
      type="date" value={l.entrega} disabled={!canEdit} placeholder="Sin fecha"
      onSave={(v) => onGuardar({ entrega: v })}
    />
  );
  const ultimo = (
    <span
      onClick={onToggleHist}
      title="Ver historial de esta talla"
      style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
    >
      {saving ? 'Guardando…' : l.ultimo ? `${fechaCorta(l.ultimo.changedAt)}${quien(l.ultimo.changedBy) ? ` · ${quien(l.ultimo.changedBy)}` : ''}` : 'Historial'} ▾
    </span>
  );

  const bg = selected ? 'var(--accent-tint, #eef3ff)' : esIncidencia ? '#df2f4a0d' : undefined;
  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', background: bg }}>
      {isMobile ? (
        <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: canEdit ? '20px 40px 28px 1fr' : '40px 28px 1fr', gap: 8, alignItems: 'center' }}>
            {check}{talla}{cantidad}{estado}
          </div>
          <div style={{ paddingLeft: canEdit ? 28 : 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {comentario}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)', whiteSpace: 'nowrap' }}>Entrega</span>
                <div style={{ minWidth: 110 }}>{entrega}</div>
              </div>
              {ultimo}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: GRID(canEdit), gap: 10, padding: '4px 12px', alignItems: 'center' }}>
          {check}{talla}{cantidad}{estado}{comentario}{entrega}{ultimo}
        </div>
      )}
      {error && <div style={{ padding: '0 12px 6px', font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>{error}</div>}
      {verHist && (
        <div style={{ margin: '0 12px 10px', padding: 10, borderRadius: 'var(--radius-md)', background: 'var(--bg-sunken)' }}>
          {historial.length === 0 && <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>Sin cambios de estado registrados todavía.</div>}
          {historial.map((h, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '4px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
              <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', minWidth: 110 }}>
                {h.changedAt.slice(0, 16).replace('T', ' ')}{quien(h.changedBy) ? ` · ${quien(h.changedBy)}` : ''}
              </span>
              <span style={{ font: 'var(--text-caption-strong)', color: 'var(--ink)' }}>
                {h.estadoPrevio ? `${h.estadoPrevio} → ${h.estadoNuevo}` : h.estadoNuevo}
              </span>
              {h.comentario && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-secondary)' }}>“{h.comentario}”</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const GRID = (canEdit: boolean) => `${canEdit ? '20px ' : ''}64px 56px minmax(170px, 1.1fr) minmax(160px, 1.6fr) 130px 120px`;

/** Tabla de un producto+color: encabezado con batería, piezas, casilla de todo
 * el grupo y "Todas a…"; resumen libre; un renglón por talla. */
function GrupoTabla({ group, lineas, canEdit, isMobile, resumen, proyectoId, selected, setSelected, saving, errores, historial, verHist, setVerHist, onGuardar, onTodasA, onResumenSaved }: {
  group: TallaGroup; lineas: LineaVista[]; canEdit: boolean; isMobile: boolean; resumen: string; proyectoId: string;
  selected: Set<string>; setSelected: (fn: (prev: Set<string>) => Set<string>) => void;
  saving: Set<string>; errores: Record<string, string>; historial: EstadoHistorialEntryDTO[];
  verHist: string | null; setVerHist: (id: string | null) => void;
  onGuardar: (l: LineaVista, cambios: Override) => void;
  onTodasA: (lineas: LineaVista[], estado: string) => void;
  onResumenSaved: (resumen: string) => void;
}) {
  const [abierto, setAbierto] = useState(true);
  const groupKey = `${group.producto}|${group.color}`;
  const battery = batteryFromSubitems(lineas.map((l) => ({ estado: l.estado, cantidad: cantidadDe(l.row) })));
  const piezas = lineas.reduce((s, l) => s + cantidadDe(l.row), 0);
  const incidencias = lineas.filter((l) => l.estado === INCIDENCIA).length;
  const ids = lineas.map((l) => l.row.id);
  const todosSel = ids.length > 0 && ids.every((id) => selected.has(id));
  const algunoSel = ids.some((id) => selected.has(id));
  // Estado único del grupo (si todas las tallas van igual) — lo que muestra "Todas a…".
  const estadosGrupo = new Set(lineas.map((l) => l.estado));
  const estadoComun = estadosGrupo.size === 1 ? [...estadosGrupo][0] : '';

  const toggleGrupo = () => setSelected((prev) => {
    const next = new Set(prev);
    for (const id of ids) { if (todosSel) next.delete(id); else next.add(id); }
    return next;
  });

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', background: '#fff', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', flexWrap: 'wrap', background: 'var(--bg-raised, #fafbfc)' }}>
        {canEdit && (
          <input
            type="checkbox" checked={todosSel} title="Seleccionar todas las tallas de este producto"
            ref={(el) => { if (el) el.indeterminate = algunoSel && !todosSel; }}
            onChange={toggleGrupo} style={{ width: 16, height: 16, cursor: 'pointer', margin: 0 }}
          />
        )}
        <div onClick={() => setAbierto(!abierto)} style={{ flex: 1, minWidth: 180, cursor: 'pointer' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)', width: 12 }}>{abierto ? '▾' : '▸'}</span>
            <span style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{group.producto}</span>
            {group.color && <span style={{ font: 'var(--text-label)', color: 'var(--ink-tertiary)' }}>{group.color}</span>}
            {group.sku && <MonoTag>{group.sku}</MonoTag>}
          </div>
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginTop: 2, paddingLeft: 18 }}>
            {lineas.length} {lineas.length === 1 ? 'talla' : 'tallas'} · {piezas.toLocaleString('es-MX')} pzas
            {incidencias > 0 && <span style={{ color: '#df2f4a', fontWeight: 600 }}> · {incidencias} con incidencia</span>}
          </div>
        </div>
        <div style={{ width: isMobile ? '100%' : 150 }}><ProgressBattery data={battery} /></div>
        {canEdit && (
          <div style={{ width: isMobile ? '100%' : 210, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', whiteSpace: 'nowrap' }}>Todas a</span>
            <select
              value=""
              onChange={(e) => { if (e.target.value) onTodasA(lineas, e.target.value); }}
              style={{ ...inputStyle, padding: '4px 6px' }}
              title="Cambia el estado de todas las tallas de este producto"
            >
              <option value="">{estadoComun || 'Estados mezclados'}</option>
              {ESTADO_PRODUCTO_ORDER.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        )}
      </div>
      {abierto && (
        <>
          {(resumen || canEdit) && (
            <div style={{ padding: '0 12px 8px', background: 'var(--bg-raised, #fafbfc)' }}>
              <ResumenInline groupKey={groupKey} resumen={resumen} canEdit={canEdit} proyectoId={proyectoId} onSaved={onResumenSaved} />
            </div>
          )}
          {!isMobile && (
            <div style={{ display: 'grid', gridTemplateColumns: GRID(canEdit), gap: 10, padding: '6px 12px', borderTop: '1px solid var(--border-subtle)' }}>
              {canEdit && <span />}
              {['Talla', 'Cant.', 'Estado', 'Comentario', 'Entrega prov.', 'Último cambio'].map((h, i) => (
                <span key={h} style={{ font: 'var(--text-caption-strong)', color: 'var(--ink-tertiary)', textAlign: i === 1 ? 'right' : 'left' }}>{h}</span>
              ))}
            </div>
          )}
          {lineas.map((l) => (
            <LineaRow
              key={l.row.id} l={l} canEdit={canEdit} isMobile={isMobile}
              selected={selected.has(l.row.id)}
              onToggle={() => setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(l.row.id)) next.delete(l.row.id); else next.add(l.row.id);
                return next;
              })}
              saving={saving.has(l.row.id)} error={errores[l.row.id]}
              historial={historial.filter((h) => h.subItemId === l.row.id)}
              verHist={verHist === l.row.id}
              onToggleHist={() => setVerHist(verHist === l.row.id ? null : l.row.id)}
              onGuardar={(c) => onGuardar(l, c)}
            />
          ))}
        </>
      )}
    </div>
  );
}

/** Tab "Ejecución" del Proyecto: batería agregada + filtro por estado + tabla
 * por producto+color. Lectura para todos; edición (compras/admin) escribe
 * `color_mm0hqf79`/`text_mm20gzsb`/`date_mm20xdtm` vía el PATCH genérico, que ya
 * deja rastro en estado_producto_historial (worker/lib/estadoProducto.ts — el
 * comentario queda en el historial solo si viaja junto con el estado, por eso
 * todo cambio de estado lo manda), más el resumen por producto
 * (worker/lib/productoResumen.ts). */
export function EjecucionSection({ state, oppId: _oppId }: { state: ProyectoState; oppId: string | null }) {
  const me = useMe();
  const isMobile = useIsMobile();
  const canEdit = me?.role === 'compras' || me?.role === 'admin';
  const [historial, setHistorial] = useState<EstadoHistorialEntryDTO[]>([]);
  const [resumenMap, setResumenMap] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<string, Pendientes>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState<string | null>(null);
  const [verHist, setVerHist] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ estado: string; comentario: string; progreso?: string; error?: string }>({ estado: '', comentario: '' });
  const bulkComentarioRef = useRef<HTMLInputElement>(null);

  const proyectoId = state.proyecto?.id;
  const reloadHistorial = useCallback(() => {
    if (!proyectoId) return;
    getEstadoHistorial(proyectoId).then(setHistorial).catch(() => setHistorial([]));
  }, [proyectoId]);
  const reloadResumen = useCallback(() => {
    if (!proyectoId) return;
    getProductoResumen(proyectoId).then((rows) => {
      const map: Record<string, string> = {};
      for (const r of rows) map[`${r.producto}|${r.color}`] = r.resumen;
      setResumenMap(map);
    }).catch(() => setResumenMap({}));
  }, [proyectoId]);

  useEffect(reloadHistorial, [reloadHistorial]);
  useEffect(reloadResumen, [reloadResumen]);

  const lineas = useMemo(() => state.proyecto?.children ?? [], [state.proyecto]);

  const ultimoPorLinea = useMemo(() => {
    const m = new Map<string, EstadoHistorialEntryDTO>();
    for (const h of historial) if (!m.has(h.subItemId)) m.set(h.subItemId, h); // viene DESC
    return m;
  }, [historial]);

  const vista = (r: ItemDTO): LineaVista => {
    const o = overrides[r.id] ?? {};
    const val = (campo: Campo) => {
      const pend = o[campo];
      return pend && espejo(r, campo) === pend.base ? pend.v : espejo(r, campo);
    };
    return {
      row: r,
      estado: val('estado') || ESTADO_DEFAULT,
      comentario: val('comentario'),
      entrega: val('entrega'),
      ultimo: ultimoPorLinea.get(r.id),
    };
  };

  /** PATCH de una línea con preview optimista; regresa si salió bien. */
  const guardarUna = async (l: LineaVista, c: Override): Promise<boolean> => {
    const id = l.row.id;
    const cols: Record<string, string> = {};
    if (c.estado !== undefined) {
      cols[S_ESTADO] = c.estado;
      cols[S_COMENTARIO] = c.comentario ?? l.comentario;
    } else if (c.comentario !== undefined) {
      cols[S_COMENTARIO] = c.comentario;
    }
    if (c.entrega !== undefined) cols[S_ENTREGA_PROV] = c.entrega;
    const previo = overrides[id];
    const nuevos: Pendientes = {};
    for (const campo of Object.keys(c) as Campo[]) nuevos[campo] = { v: c[campo] ?? '', base: espejo(l.row, campo) };
    setOverrides((p) => ({ ...p, [id]: { ...p[id], ...nuevos } }));
    setSaving((p) => new Set(p).add(id));
    setErrores((p) => { const n = { ...p }; delete n[id]; return n; });
    try {
      await patchItem('proyectos_sub', id, cols);
      return true;
    } catch {
      setOverrides((p) => ({ ...p, [id]: previo ?? {} }));
      setErrores((p) => ({ ...p, [id]: 'No se pudo guardar — intenta otra vez' }));
      return false;
    } finally {
      setSaving((p) => { const n = new Set(p); n.delete(id); return n; });
    }
  };

  const refrescar = () => {
    state.reload();
    reloadHistorial();
  };

  const guardarLinea = async (l: LineaVista, c: Override) => {
    if (await guardarUna(l, c)) refrescar();
  };

  /** Mismo estado (y comentario, si se escribió) a varias tallas — de 4 en 4
   * para no soltar decenas de PATCH de golpe contra el outbox. */
  const aplicarVarias = async (objetivo: LineaVista[], estado: string, comentario: string) => {
    const pendientes = objetivo.filter((l) => l.estado !== estado || (comentario && l.comentario !== comentario));
    const fallidas: string[] = [];
    if (!pendientes.length) return fallidas;
    for (let i = 0; i < pendientes.length; i += 4) {
      const lote = pendientes.slice(i, i + 4);
      const res = await Promise.all(lote.map((l) => guardarUna(l, { estado, comentario: comentario || l.comentario })));
      res.forEach((ok, j) => { if (!ok) fallidas.push(lote[j].row.id); });
      setBulk((b) => ({ ...b, progreso: `Guardando ${Math.min(i + 4, pendientes.length)}/${pendientes.length}…` }));
    }
    refrescar();
    return fallidas;
  };

  const todasA = async (grupo: LineaVista[], estado: string) => {
    // Incidencia pide comentario: se seleccionan las tallas y se va a la barra.
    if (estado === INCIDENCIA) {
      setSelected(new Set(grupo.map((l) => l.row.id)));
      setBulk({ estado, comentario: '' });
      setTimeout(() => bulkComentarioRef.current?.focus(), 0);
      return;
    }
    await aplicarVarias(grupo, estado, '');
    setBulk((b) => ({ ...b, progreso: undefined }));
  };

  if (state.loading) return <Shell hint="Buscando el proyecto ligado…" />;
  if (!state.proyecto) {
    return <Shell hint="Esta oportunidad aún no tiene Proyecto en Monday — el seguimiento de ejecución arranca cuando se generan las órdenes de compra a proveedor." />;
  }
  const p = state.proyecto;
  const todas = lineas.map(vista);
  const battery = batteryFromSubitems(todas.map((l) => ({ estado: l.estado, cantidad: cantidadDe(l.row) })));
  const grupos = groupByProductoColor(lineas);
  const porId = new Map(todas.map((l) => [l.row.id, l]));

  // Conteo por estado para los filtros (en el orden canon).
  const conteo = new Map<string, number>();
  for (const l of todas) conteo.set(l.estado, (conteo.get(l.estado) ?? 0) + 1);
  const estadosPresentes = [...ESTADO_PRODUCTO_ORDER.filter((e) => conteo.has(e)), ...[...conteo.keys()].filter((e) => !ESTADO_PRODUCTO_ORDER.includes(e))];

  const seleccion = todas.filter((l) => selected.has(l.row.id));
  const aplicarSeleccion = async () => {
    if (!bulk.estado) { setBulk({ ...bulk, error: 'Elige el estado' }); return; }
    if (bulk.estado === INCIDENCIA && !bulk.comentario.trim()) {
      setBulk({ ...bulk, error: 'Cuenta qué pasó — obligatorio para marcar Incidencia/Retraso' });
      bulkComentarioRef.current?.focus();
      return;
    }
    setBulk({ ...bulk, error: undefined, progreso: 'Guardando…' });
    const fallidas = await aplicarVarias(seleccion, bulk.estado, bulk.comentario.trim());
    if (fallidas.length) {
      setBulk((b) => ({ ...b, progreso: undefined, error: `${fallidas.length} no se pudieron guardar — siguen seleccionadas` }));
      setSelected(new Set(fallidas));
    } else {
      setBulk({ estado: '', comentario: '' });
      setSelected(new Set());
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <ProgressBattery data={battery} size="full" />
      {lineas.length === 0 ? (
        <div style={{ marginTop: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
          Aún no hay líneas en el proyecto — importa las tallas primero.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
            <FiltroChip activo={filtro === null} onClick={() => setFiltro(null)} label={`Todas · ${todas.length}`} />
            {estadosPresentes.map((e) => (
              <FiltroChip
                key={e} activo={filtro === e} color={ESTADO_PRODUCTO_COLORS[e]}
                onClick={() => setFiltro(filtro === e ? null : e)} label={`${e} · ${conteo.get(e)}`}
              />
            ))}
          </div>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {grupos.map((g) => {
              const groupKey = `${g.producto}|${g.color}`;
              const ls = g.rows.map((r) => porId.get(r.id)!).filter((l) => !filtro || l.estado === filtro);
              if (!ls.length) return null;
              return (
                <GrupoTabla
                  key={groupKey} group={g} lineas={ls} canEdit={canEdit} isMobile={isMobile}
                  resumen={resumenMap[groupKey] ?? ''} proyectoId={p.id}
                  selected={selected} setSelected={setSelected} saving={saving} errores={errores}
                  historial={historial} verHist={verHist} setVerHist={setVerHist}
                  onGuardar={guardarLinea} onTodasA={todasA}
                  onResumenSaved={(r) => setResumenMap((prev) => ({ ...prev, [groupKey]: r }))}
                />
              );
            })}
          </div>
        </>
      )}
      {!canEdit && (
        <div style={{ marginTop: 14, font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>
          El estado lo actualiza Compras conforme avanza la entrega.
        </div>
      )}
      {canEdit && seleccion.length > 0 && (
        <div style={{
          position: 'sticky', bottom: 0, zIndex: 3, marginTop: 12, padding: 10,
          background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)',
          boxShadow: '0 -4px 16px rgba(0,0,0,.10)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <span style={{ font: 'var(--text-label-strong)', color: 'var(--ink)', whiteSpace: 'nowrap' }}>
            {seleccion.length} {seleccion.length === 1 ? 'talla' : 'tallas'} · {seleccion.reduce((s, l) => s + cantidadDe(l.row), 0).toLocaleString('es-MX')} pzas
          </span>
          <div style={{ width: isMobile ? '100%' : 220 }}>
            {bulk.estado
              ? <EstadoSelect value={bulk.estado} onChange={(v) => setBulk({ ...bulk, estado: v, error: undefined })} compact />
              : (
                <select value="" onChange={(e) => setBulk({ ...bulk, estado: e.target.value, error: undefined })} style={{ ...inputStyle, padding: '4px 6px' }}>
                  <option value="">Cambiar estado a…</option>
                  {ESTADO_PRODUCTO_ORDER.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              )}
          </div>
          <input
            ref={bulkComentarioRef}
            value={bulk.comentario}
            onChange={(e) => setBulk({ ...bulk, comentario: e.target.value, error: undefined })}
            onKeyDown={(e) => { if (e.key === 'Enter') aplicarSeleccion(); }}
            placeholder={bulk.estado === INCIDENCIA ? 'Qué pasó (obligatorio)' : 'Comentario para todas (opcional)'}
            style={{ ...inputStyle, flex: 1, minWidth: 160, width: 'auto', borderColor: bulk.estado === INCIDENCIA && !bulk.comentario.trim() ? 'var(--status-perdida)' : 'var(--border)' }}
          />
          <Button style={btnStyle} onClick={bulk.progreso ? undefined : aplicarSeleccion}>{bulk.progreso ?? 'Aplicar'}</Button>
          <Button variant="secondary" style={btnStyle} onClick={() => { setSelected(new Set()); setBulk({ estado: '', comentario: '' }); }}>Quitar selección</Button>
          {bulk.error && <div style={{ width: '100%', font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>{bulk.error}</div>}
        </div>
      )}
    </div>
  );
}

function FiltroChip({ label, activo, onClick, color }: { label: string; activo: boolean; onClick: () => void; color?: string }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
        font: 'var(--text-caption-strong)', color: activo ? (color ? textoSobre(color) : '#fff') : 'var(--ink-secondary)',
        background: activo ? (color ?? 'var(--ink)') : 'var(--bg-sunken)', border: '1px solid transparent',
      }}
    >
      {color && !activo && <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />}
      {label}
    </button>
  );
}
