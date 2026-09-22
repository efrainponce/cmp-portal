// Tab "Ejecución" de la sección Proyecto — batería agregada + tarjetas por
// producto+color con resumen global y chips de estado por talla. Reusa el
// mismo agrupado por producto+color que TallasSection.tsx (groupByProductoColor/
// TallaGroup), con tarjetas de contenido distinto.
import { useCallback, useEffect, useState } from 'react';
import { getEstadoHistorial, getProductoResumen, patchProductoResumen, patchItem, type EstadoHistorialEntryDTO, type ItemDTO } from '../../../lib/api';
import { useMe } from '../../../lib/useMe';
import { Button } from '../../../components/core/Button';
import { MonoTag } from '../../../components/core/Badges';
import { ProgressBattery } from '../../../components/board/ProgressBattery';
import { batteryFromSubitems, ESTADO_PRODUCTO_ORDER } from '../../../lib/estadoProductoBuckets';
import { type ProyectoState, Shell, ESTADO_PRODUCTO_COLORS, S_ESTADO, S_CANTIDAD, S_TALLA } from './shared';
import { groupByProductoColor, type TallaGroup } from './TallasSection';

// Comentario de Estado (proyectos_sub) — junto con S_ESTADO, editables solo por
// compras/admin (shared/visibility.ts, grupo AC) desde el tab Ejecución.
const S_COMENTARIO = 'text_mm20gzsb';

interface EstadoEdit { nuevoEstado: string; comentario: string; saving: boolean; error?: string }

const chipBtnStyle = { padding: '6px 14px', font: 'var(--text-label)' } as const;

/** Un chip por línea (producto+color+talla): color = estado actual, cantidad
 * debajo de la talla. Editable solo por compras/admin — abre un popover angosto
 * con el selector de estado + comentario (obligatorio si el nuevo estado es
 * Incidencia/Retraso, mismo criterio que reportarTallasIncorrectas). El popover
 * abierto es UNO SOLO en todo el tab (Efraín, 2026-08-06: "no se cierran los pop
 * ups por elemento") — `isOpen`/`onOpen`/`onClose` vienen de EjecucionSection. */
function EstadoChip({ row, canEdit, onSaved, isOpen, onOpen, onClose }: {
  row: ItemDTO; canEdit: boolean; onSaved: () => void;
  isOpen: boolean; onOpen: () => void; onClose: () => void;
}) {
  const estado = row.cols[S_ESTADO]?.text || 'Pendiente OC al Prov';
  const color = ESTADO_PRODUCTO_COLORS[estado] ?? '#9aa5b1';
  const [edit, setEdit] = useState<EstadoEdit | null>(null);

  const abrir = () => {
    if (!canEdit) return;
    setEdit({ nuevoEstado: estado, comentario: row.cols[S_COMENTARIO]?.text || '', saving: false });
    onOpen();
  };

  const guardar = async () => {
    if (!edit) return;
    if (edit.nuevoEstado === 'Incidencia/Retraso' && !edit.comentario.trim()) {
      setEdit({ ...edit, error: 'Cuenta qué pasó — obligatorio para marcar Incidencia/Retraso' });
      return;
    }
    setEdit({ ...edit, saving: true, error: undefined });
    try {
      await patchItem('proyectos_sub', row.id, { [S_ESTADO]: edit.nuevoEstado, [S_COMENTARIO]: edit.comentario });
      onClose();
      onSaved();
    } catch {
      setEdit({ ...edit, saving: false, error: 'No se pudo guardar' });
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={abrir}
        title={canEdit ? `${estado} — toca para cambiar el estado` : (row.cols[S_COMENTARIO]?.text || estado)}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 50, maxWidth: 96,
          padding: '6px 10px', borderRadius: 'var(--radius-lg)', background: color + '22',
          border: `1px solid ${color}66`, cursor: canEdit ? 'pointer' : 'default', position: 'relative',
        }}
      >
        <span style={{ font: 'var(--text-label-strong)', color: 'var(--ink)' }}>{row.cols[S_TALLA]?.text || '—'}</span>
        <span style={{ font: 'var(--text-caption-strong)', color }}>{row.cols[S_CANTIDAD]?.text || '0'}</span>
        <span style={{ font: 'var(--text-caption)', color, opacity: 0.85, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{estado}</span>
        {canEdit && (
          <span style={{
            position: 'absolute', bottom: -6, right: -6, width: 16, height: 16, borderRadius: '50%',
            background: 'var(--bg-sunken)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', font: '9px sans-serif', color: 'var(--ink-tertiary)',
          }}>
            ✎
          </span>
        )}
      </div>
      {isOpen && edit && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 5, width: 250,
          background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)',
          boxShadow: '0 6px 20px rgba(0,0,0,.15)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <select
            value={edit.nuevoEstado}
            onChange={(e) => setEdit({ ...edit, nuevoEstado: e.target.value })}
            style={{ font: 'var(--text-label)', padding: '7px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}
          >
            {ESTADO_PRODUCTO_ORDER.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <textarea
            value={edit.comentario}
            onChange={(e) => setEdit({ ...edit, comentario: e.target.value })}
            placeholder={edit.nuevoEstado === 'Incidencia/Retraso' ? 'Qué pasó (obligatorio)' : 'Comentario (opcional)'}
            rows={2}
            style={{ font: 'var(--text-label)', padding: '7px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', resize: 'vertical' }}
          />
          {edit.error && <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>{edit.error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" style={chipBtnStyle} onClick={edit.saving ? undefined : onClose}>Cancelar</Button>
            <Button style={chipBtnStyle} onClick={edit.saving ? undefined : guardar}>{edit.saving ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Timeline de una línea — lee todo el historial del Proyecto (una sola llamada,
 * cacheada por EjecucionSection) y filtra por sub_item_id del lado del cliente. */
function HistorialPanel({ subItemId, historial, onClose }: {
  subItemId: string; historial: EstadoHistorialEntryDTO[]; onClose: () => void;
}) {
  const propios = historial.filter((h) => h.subItemId === subItemId);
  return (
    <div style={{
      position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 5, width: 280, maxHeight: 320, overflowY: 'auto',
      background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)',
      boxShadow: '0 6px 20px rgba(0,0,0,.15)', padding: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)' }}>Historial</div>
        <div onClick={onClose} style={{ cursor: 'pointer', font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>✕</div>
      </div>
      {propios.length === 0 && <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>Sin cambios de estado todavía.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {propios.map((h, i) => (
          <div key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', paddingTop: i === 0 ? 0 : 8 }}>
            <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>{h.changedAt.slice(0, 16).replace('T', ' ')}</div>
            <div style={{ font: 'var(--text-label)', color: 'var(--ink)' }}>
              {h.estadoPrevio ? `${h.estadoPrevio} → ${h.estadoNuevo}` : h.estadoNuevo}
            </div>
            {h.comentario && <div style={{ font: 'var(--text-caption)', color: 'var(--ink-secondary)', marginTop: 2 }}>{h.comentario}</div>}
            {h.changedBy && <div style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)', marginTop: 2 }}>{h.changedBy}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Resumen libre por producto+color — un texto global de la tarjeta, aparte del
 * comentario por talla (worker/lib/productoResumen.ts, nativo en D1: el grupo
 * producto+color no es una columna de Monday). Siempre visible (aunque esté
 * vacío) para que "de un vistazo" se entienda cómo va el producto sin abrir cada
 * talla; compras/admin lo edita con el mismo patrón select/textarea+Guardar. */
function ResumenBlock({ groupKey, resumen, canEdit, proyectoId, isOpen, onOpen, onClose, onSaved }: {
  groupKey: string; resumen: string; canEdit: boolean; proyectoId: string;
  isOpen: boolean; onOpen: () => void; onClose: () => void; onSaved: (resumen: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const abrir = () => {
    if (!canEdit) return;
    setDraft(resumen);
    setError(undefined);
    onOpen();
  };

  const guardar = async () => {
    setSaving(true);
    setError(undefined);
    const [producto, color] = groupKey.split('|');
    try {
      await patchProductoResumen(proyectoId, producto, color, draft.trim());
      setSaving(false);
      onSaved(draft.trim());
      onClose();
    } catch {
      setSaving(false);
      setError('No se pudo guardar');
    }
  };

  return (
    <div style={{ position: 'relative', marginTop: 10 }}>
      <div
        onClick={abrir}
        title={canEdit ? 'Editar resumen del producto' : undefined}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 8px',
          borderRadius: 'var(--radius-md)', background: 'var(--bg-sunken)',
          cursor: canEdit ? 'pointer' : 'default',
        }}
      >
        <span style={{ font: 'var(--text-caption-strong)', color: 'var(--ink-tertiary)', flexShrink: 0 }}>Resumen</span>
        <span style={{ font: 'var(--text-caption)', color: resumen ? 'var(--ink-secondary)' : 'var(--ink-quiet)', flex: 1 }}>
          {resumen || (canEdit ? 'Sin resumen — click para agregar' : 'Sin resumen todavía')}
        </span>
        {canEdit && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-quiet)', flexShrink: 0 }}>✎</span>}
      </div>
      {isOpen && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 5, width: '100%', minWidth: 260,
          background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)',
          boxShadow: '0 6px 20px rgba(0,0,0,.15)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Cómo va este producto…"
            rows={3}
            autoFocus
            style={{ font: 'var(--text-label)', padding: '7px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', resize: 'vertical' }}
          />
          {error && <div style={{ font: 'var(--text-caption)', color: 'var(--status-perdida)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" style={chipBtnStyle} onClick={saving ? undefined : onClose}>Cancelar</Button>
            <Button style={chipBtnStyle} onClick={saving ? undefined : guardar}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tarjeta de un producto+color: resumen global + chips de estado por talla (una
 * fila = una talla, ya resuelto estructuralmente por proyectos_sub — nunca una
 * columna por talla) + ícono de historial. Mismo agrupado que TallaBoxCard
 * (Tallas), distinto contenido. */
function EjecucionCard({ group, canEdit, historial, resumen, proyectoId, openPopover, setOpenPopover, onChanged, onResumenSaved }: {
  group: TallaGroup; canEdit: boolean; historial: EstadoHistorialEntryDTO[]; resumen: string; proyectoId: string;
  openPopover: string | null; setOpenPopover: (key: string | null) => void;
  onChanged: () => void; onResumenSaved: (groupKey: string, resumen: string) => void;
}) {
  const groupKey = `${group.producto}|${group.color}`;
  const resumenKey = `resumen:${groupKey}`;
  const cardBattery = batteryFromSubitems(group.rows.map((r) => ({
    estado: r.cols[S_ESTADO]?.text,
    cantidad: Number((r.cols[S_CANTIDAD]?.text || '0').replace(/,/g, '')) || 0,
  })));

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 14, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{group.producto}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
            {group.sku && <MonoTag>{group.sku}</MonoTag>}
            {group.color && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>{group.color}</span>}
          </div>
        </div>
        <div style={{ width: 140 }}><ProgressBattery data={cardBattery} /></div>
      </div>
      <ResumenBlock
        groupKey={groupKey}
        resumen={resumen}
        canEdit={canEdit}
        proyectoId={proyectoId}
        isOpen={openPopover === resumenKey}
        onOpen={() => setOpenPopover(resumenKey)}
        onClose={() => setOpenPopover(null)}
        onSaved={(r) => onResumenSaved(groupKey, r)}
      />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
        {group.rows.map((r) => {
          const chipKey = `chip:${r.id}`;
          const histKey = `hist:${r.id}`;
          return (
            <div key={r.id} style={{ position: 'relative' }}>
              <EstadoChip
                row={r} canEdit={canEdit} onSaved={onChanged}
                isOpen={openPopover === chipKey}
                onOpen={() => setOpenPopover(chipKey)}
                onClose={() => setOpenPopover(null)}
              />
              <div
                onClick={() => setOpenPopover(openPopover === histKey ? null : histKey)}
                title="Ver historial de esta línea"
                style={{
                  position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: '50%',
                  background: 'var(--bg-sunken)', border: '1px solid var(--border)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', font: '9px sans-serif', color: 'var(--ink-tertiary)',
                }}
              >
                ⏱
              </div>
              {openPopover === histKey && (
                <HistorialPanel subItemId={r.id} historial={historial} onClose={() => setOpenPopover(null)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Tab "Ejecución" del Proyecto: batería agregada (piezas entregadas/en camino/
 * incidencia) + tarjetas por producto+color con resumen global y chips de estado
 * por talla — pensado para verse "de un vistazo" en vez de clonar la tabla de
 * subitems de Monday (Efraín, 2026-08-05). Lectura para todos; edición (compras/
 * admin) escribe `color_mm0hqf79`/`text_mm20gzsb` vía el PATCH genérico, que ya
 * deja rastro en estado_producto_historial (worker/lib/estadoProducto.ts) sin
 * agregar columnas, más el resumen por producto (worker/lib/productoResumen.ts).
 * Un solo popover abierto a la vez en todo el tab — `openPopover` vive aquí y un
 * backdrop de página completa lo cierra al hacer click fuera (Efraín, 2026-08-06:
 * "no se cierran los pop ups por elemento, se quedan abiertos"). */
export function EjecucionSection({ state, oppId: _oppId }: { state: ProyectoState; oppId: string | null }) {
  const me = useMe();
  const canEdit = me?.role === 'compras' || me?.role === 'admin';
  const [historial, setHistorial] = useState<EstadoHistorialEntryDTO[]>([]);
  const [resumenMap, setResumenMap] = useState<Record<string, string>>({});
  const [openPopover, setOpenPopover] = useState<string | null>(null);

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

  if (state.loading) return <Shell hint="Buscando el proyecto ligado…" />;
  if (!state.proyecto) {
    return <Shell hint="Esta oportunidad aún no tiene Proyecto en Monday — el seguimiento de ejecución arranca cuando se generan las órdenes de compra a proveedor." />;
  }
  const p = state.proyecto;
  const lineas = p.children ?? [];
  const battery = batteryFromSubitems(lineas.map((l) => ({
    estado: l.cols[S_ESTADO]?.text,
    cantidad: Number((l.cols[S_CANTIDAD]?.text || '0').replace(/,/g, '')) || 0,
  })));
  const grupos = groupByProductoColor(lineas);

  const onChanged = () => {
    state.reload();
    reloadHistorial();
  };
  const onResumenSaved = (groupKey: string, r: string) => {
    setResumenMap((prev) => ({ ...prev, [groupKey]: r }));
  };

  return (
    <div style={{ marginTop: 16 }}>
      <ProgressBattery data={battery} size="full" />
      {canEdit && lineas.length > 0 && (
        <div style={{ marginTop: 10, font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>
          Toca la talla (el recuadro con el número) para cambiar su estado — el color y el texto debajo muestran el estado actual.
        </div>
      )}
      {lineas.length === 0 ? (
        <div style={{ marginTop: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
          Aún no hay líneas en el proyecto — importa las tallas primero.
        </div>
      ) : (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {grupos.map((g) => {
            const groupKey = `${g.producto}|${g.color}`;
            return (
              <EjecucionCard
                key={groupKey} group={g} canEdit={canEdit} historial={historial}
                resumen={resumenMap[groupKey] ?? ''} proyectoId={p.id}
                openPopover={openPopover} setOpenPopover={setOpenPopover}
                onChanged={onChanged} onResumenSaved={onResumenSaved}
              />
            );
          })}
        </div>
      )}
      {!canEdit && (
        <div style={{ marginTop: 14, font: 'var(--text-caption)', color: 'var(--ink-quiet)' }}>
          El estado lo actualiza Compras conforme avanza la entrega.
        </div>
      )}
      {openPopover && (
        <div onClick={() => setOpenPopover(null)} style={{ position: 'fixed', inset: 0, zIndex: 4 }} />
      )}
    </div>
  );
}
