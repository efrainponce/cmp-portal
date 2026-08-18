// Tab "Tallas" de la sección Proyecto — desglose de tallas importado del
import { isNativeId } from '../../../../shared/nativeId';
// archivo (Google Sheet) a Monday, mostrado como tarjetas editables por
// producto+color. `groupByProductoColor`/`TallaGroup`/`sortByTalla` también
// los usa EjecucionSection.tsx (mismo agrupado, distinto contenido de tarjeta).
import { useEffect, useState } from 'react';
import { type ItemDTO } from '../../../lib/api';
import { patchItem, reportarTallasIncorrectas, getCotizacionVirtual, type QuoteLineSnapshot } from '../../../lib/apiClient';
import { useMe } from '../../../lib/useMe';
import { ConfirmButton } from '../../../components/core/ConfirmButton';
import { MonoTag } from '../../../components/core/Badges';
import {
  type ProyectoState, P_TALLAS_PDF,
  ProyectoLinks, ProyectoActionBar, FileList, Shell, parseFiles, toR2Files,
  S_PRODUCTO, S_SKU, S_COLOR, S_TALLA, S_CANTIDAD,
} from './shared';

interface CantidadEdit { draft?: string; saving?: boolean; error?: string }

function norm(s: string): string {
  return s.trim().toLowerCase();
}

interface CotizadoMaps {
  byProductoColor: Map<string, number>;
  bySkuColor: Map<string, number>;
}

/** Dos índices sobre las líneas cotizadas: producto+color (nombre del subitem,
 * como lo captura TallaBoxesCapture) y sku+color de respaldo — el "Importar
 * tallas" de cmp-tallas puede reescribir el nombre del producto al copiarlo al
 * Proyecto, y ahí el SKU (más estable) es lo único que sigue cruzando.
 *
 * Lee de la cotización VIRTUAL del Proyecto (getCotizacionVirtual), no de los
 * subitems crudos de la Oportunidad: un "Editar/Dividir" hecho ya en el
 * Proyecto (post-venta) solo vive en `proyecto_cotizacion_ajustes` — nunca
 * toca Monday — así que leer los subitems reales dejaba el "Cotizado" de las
 * tallas pegado a la línea de antes de dividir (bug reportado por Pam,
 * 2026-08-11: dividió 150 multicam en 75+75 y el color nuevo salía "sin línea
 * de cotización para comparar"). Mientras nadie ajusta nada la vista virtual
 * es idéntica a la real, así que esto no cambia nada para el caso común. */
function cotizadoMapsFrom(lineas: QuoteLineSnapshot[]): CotizadoMaps {
  const byProductoColor = new Map<string, number>();
  const bySkuColor = new Map<string, number>();
  for (const l of lineas) {
    const color = norm(l.color || '');
    const cantidad = l.cantidad || 0;
    const pKey = `${norm(l.producto)}|${color}`;
    byProductoColor.set(pKey, (byProductoColor.get(pKey) ?? 0) + cantidad);
    if (l.sku?.trim()) {
      const sKey = `${norm(l.sku)}|${color}`;
      bySkuColor.set(sKey, (bySkuColor.get(sKey) ?? 0) + cantidad);
    }
  }
  return { byProductoColor, bySkuColor };
}

/** Cotizado de un grupo del Proyecto: primero por producto+color, con
 * respaldo por sku+color si el nombre no cruza. */
function lookupCotizado(group: TallaGroup, maps: CotizadoMaps): number | null {
  const color = norm(group.color);
  const byProducto = maps.byProductoColor.get(`${norm(group.producto)}|${color}`);
  if (byProducto !== undefined) return byProducto;
  if (group.sku) {
    const bySku = maps.bySkuColor.get(`${norm(group.sku)}|${color}`);
    if (bySku !== undefined) return bySku;
  }
  return null;
}

export interface TallaGroup { producto: string; sku?: string; color: string; rows: ItemDTO[] }

// Orden canónico de tallas alfabéticas — las numéricas (pantalón, etc.) y
// cualquier talla no reconocida se van al final, en orden alfabético.
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL', 'XXXXXL'];

function sizeRank(raw: string): number {
  const s = raw.trim().toUpperCase();
  const idx = SIZE_ORDER.indexOf(s);
  if (idx !== -1) return idx;
  const nxl = s.match(/^(\d+)\s*X\s*L$/); // "2XL" == XXL, "3XL" == XXXL, ...
  if (nxl) return SIZE_ORDER.indexOf('XL') + Number(nxl[1]) - 1;
  return Infinity;
}

export function sortByTalla(rows: ItemDTO[]): ItemDTO[] {
  return [...rows].sort((a, b) => {
    const ta = a.cols[S_TALLA]?.text || '';
    const tb = b.cols[S_TALLA]?.text || '';
    const ra = sizeRank(ta);
    const rb = sizeRank(tb);
    if (ra !== rb) return ra - rb;
    return ta.localeCompare(tb, 'es', { numeric: true });
  });
}

/** Una tarjeta por producto+color (no solo producto): dos colores del mismo
 * producto son dos tarjetas, cada una con sus propias tallas — mismo criterio
 * de agrupado que TallaBoxesCapture (TallasTab.tsx), donde cada card ya es un
 * subitem de cotización = un producto+color específico. */
export function groupByProductoColor(lineas: ItemDTO[]): TallaGroup[] {
  const groups = new Map<string, TallaGroup>();
  for (const l of lineas) {
    const producto = l.cols[S_PRODUCTO]?.text || l.name;
    const color = l.cols[S_COLOR]?.text || '';
    const key = `${norm(producto)}|${norm(color)}`;
    if (!groups.has(key)) groups.set(key, { producto, sku: l.cols[S_SKU]?.text || undefined, color, rows: [] });
    groups.get(key)!.rows.push(l);
  }
  return [...groups.values()].map(g => ({ ...g, rows: sortByTalla(g.rows) }));
}

const boxInputStyle = {
  width: 52, textAlign: 'center' as const, font: 'var(--text-label-strong)', color: 'var(--ink)',
  padding: '6px 4px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: '#fff',
} as const;

type CardTone = 'empty' | 'unknown' | 'ok' | 'mismatch';

/** empty = nada capturado todavía (gris); unknown = sin línea de cotización
 * contra qué comparar (neutro); ok/mismatch = cuadra o no contra lo cotizado
 * (verde claro / rojo — Efraín, 2026-08-06). */
const CARD_TONE_STYLE: Record<CardTone, { border: string; background: string; text: string }> = {
  empty: { border: 'var(--border)', background: 'var(--bg-sunken)', text: 'var(--ink-tertiary)' },
  unknown: { border: 'var(--border)', background: '#fff', text: 'var(--ink-tertiary)' },
  ok: { border: 'var(--status-ganada)', background: 'var(--status-ganada-tint)', text: 'var(--status-ganada)' },
  mismatch: { border: 'var(--status-perdida)', background: 'var(--status-perdida-tint)', text: 'var(--status-perdida)' },
};

/** Tarjeta de un producto+color: una cajita editable por talla + "Cotizado" vs
 * lo ya asignado. Cantidad se guarda inline contra la línea del Proyecto en
 * Monday (sin tocar el Sheet, así que "Importar tallas a Monday" la vuelve a
 * pisar); "Reportar tallas incorrectas" avisa a Compras (Monday + WhatsApp,
 * worker/lib/proyectoTallas.ts) cuando el desglose no cuadra. */
function TallaBoxCard({ group, cotizado, canEditCantidad, canReport, proyectoId, reload }: {
  group: TallaGroup; cotizado: number | null; canEditCantidad: boolean; canReport: boolean;
  proyectoId: string; reload: () => void;
}) {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, CantidadEdit>>({});
  const [reportOutcome, setReportOutcome] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const cantidadOf = (r: ItemDTO) => overrides[r.id] ?? r.cols[S_CANTIDAD]?.text ?? '0';

  const commit = async (row: ItemDTO) => {
    const draft = edits[row.id]?.draft;
    if (draft == null) return;
    const trimmed = draft.trim();
    const current = cantidadOf(row);
    if (trimmed === '' || trimmed === current) {
      setEdits(p => ({ ...p, [row.id]: { ...p[row.id], draft: undefined, error: undefined } }));
      return;
    }
    const n = Number(trimmed.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) {
      setEdits(p => ({ ...p, [row.id]: { ...p[row.id], error: 'Cantidad inválida' } }));
      return;
    }
    setEdits(p => ({ ...p, [row.id]: { ...p[row.id], saving: true, error: undefined } }));
    try {
      await patchItem('proyectos_sub', row.id, { [S_CANTIDAD]: String(n) });
      setOverrides(p => ({ ...p, [row.id]: String(n) }));
      setEdits(p => ({ ...p, [row.id]: { draft: undefined, saving: false } }));
      reload();
    } catch {
      setEdits(p => ({ ...p, [row.id]: { ...p[row.id], saving: false, error: 'No se pudo guardar' } }));
    }
  };

  const asignadas = group.rows.reduce((s, r) => s + (Number(cantidadOf(r).replace(/,/g, '')) || 0), 0);
  const cuadra = cotizado !== null && asignadas === cotizado;
  let progresoTexto: string;
  if (cotizado === null) {
    progresoTexto = `${asignadas} asignadas (sin línea de cotización para comparar)`;
  } else if (cuadra) {
    progresoTexto = `${asignadas} asignadas — cuadra con lo cotizado`;
  } else if (asignadas < cotizado) {
    progresoTexto = `Faltan ${cotizado - asignadas} de ${cotizado} (${asignadas} asignadas)`;
  } else {
    progresoTexto = `Sobran ${asignadas - cotizado} sobre los ${cotizado} cotizados (${asignadas} asignadas)`;
  }
  const cardTone: CardTone = asignadas === 0 ? 'empty' : cotizado === null ? 'unknown' : cuadra ? 'ok' : 'mismatch';
  const tone = CARD_TONE_STYLE[cardTone];

  const reportar = async () => {
    setReportOutcome(null);
    const res = await reportarTallasIncorrectas(proyectoId, group.producto, group.color || undefined);
    setReportOutcome(res.ok
      ? { kind: 'ok', text: 'Compras notificado (Monday + WhatsApp).' }
      : { kind: 'error', text: res.error ?? 'No se pudo reportar.' });
  };

  return (
    <div style={{ border: `1px solid ${tone.border}`, borderRadius: 'var(--radius-xl)', padding: 14, background: tone.background }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{group.producto}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
            {group.sku && <MonoTag>{group.sku}</MonoTag>}
            {group.color && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>{group.color}</span>}
            {cotizado !== null && <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>· Cotizado: {cotizado}</span>}
          </div>
        </div>
        {canReport && (
          <ConfirmButton
            label="Reportar tallas incorrectas"
            confirmLabel="¿Avisar a Compras que este desglose no cuadra?"
            busyLabel="Avisando…"
            variant="secondary"
            onConfirm={reportar}
          />
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {group.rows.map(r => {
          const st = edits[r.id];
          return (
            <label key={r.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>{r.cols[S_TALLA]?.text || '—'}</span>
              {canEditCantidad ? (
                <input
                  type="number" min={0} inputMode="numeric"
                  value={st?.draft ?? cantidadOf(r)}
                  onChange={e => setEdits(p => ({ ...p, [r.id]: { ...p[r.id], draft: e.target.value } }))}
                  onBlur={() => commit(r)}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  disabled={st?.saving}
                  style={{ ...boxInputStyle, border: `1px solid ${st?.error ? 'var(--status-perdida)' : 'var(--border)'}` }}
                />
              ) : (
                <div style={boxInputStyle}>{cantidadOf(r)}</div>
              )}
            </label>
          );
        })}
      </div>
      <div style={{ marginTop: 10, font: 'var(--text-caption-strong)', color: tone.text }}>{progresoTexto}</div>
      {reportOutcome && (
        <div style={{ marginTop: 6, font: 'var(--text-caption)', color: reportOutcome.kind === 'ok' ? 'var(--status-ganada)' : 'var(--status-perdida)' }}>
          {reportOutcome.text}
        </div>
      )}
    </div>
  );
}

/** Grid de tallas importadas (subitems del Proyecto): una tarjeta por
 * producto+color con una cajita editable por talla — mismo estilo que la
 * captura de tallas del vendedor (TallasTab.tsx), en vez de la lista de pills
 * anidados de antes. */
function TallasGrid({ lineas, cotizadoMaps, canEditCantidad, canReport, proyectoId, reload, native }: {
  lineas: ItemDTO[]; cotizadoMaps: CotizadoMaps; canEditCantidad: boolean; canReport: boolean;
  proyectoId: string; reload: () => void; native?: boolean;
}) {
  if (lineas.length === 0) {
    return (
      <div style={{ marginTop: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
        {native
          ? 'Aún no hay tallas capturadas — captúralas por tallas en la pestaña "Tallas" de la Oportunidad.'
          : 'Aún no hay tallas importadas en Monday — captura el desglose en el archivo de tallas y pide a Compras importarlo.'}
      </div>
    );
  }

  const grupos = groupByProductoColor(lineas);

  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {grupos.map(g => (
        <TallaBoxCard
          key={`${g.producto}|${g.color}`}
          group={g}
          cotizado={lookupCotizado(g, cotizadoMaps)}
          canEditCantidad={canEditCantidad}
          canReport={canReport}
          proyectoId={proyectoId}
          reload={reload}
        />
      ))}
    </div>
  );
}

const EMPTY_COTIZADO_MAPS: CotizadoMaps = { byProductoColor: new Map(), bySkuColor: new Map() };

export function ProyectoTallasSection({ state, oppId }: { state: ProyectoState; oppId: string | null }) {
  const me = useMe();
  const canEditCantidad = me?.role === 'vendedor' || me?.role === 'compras' || me?.role === 'admin';
  const [cotizadoMaps, setCotizadoMaps] = useState<CotizadoMaps>(EMPTY_COTIZADO_MAPS);
  const proyectoId = state.proyecto?.id ?? null;

  // Lo cotizado por producto+color viene de la cotización VIRTUAL del
  // Proyecto (un solo GET, 100% D1) para que un "Editar/Dividir" post-venta
  // ya hecho ahí se refleje aquí también — ver cotizadoMapsFrom.
  useEffect(() => {
    if (!proyectoId) { setCotizadoMaps(EMPTY_COTIZADO_MAPS); return; }
    getCotizacionVirtual(proyectoId)
      .then(d => setCotizadoMaps(cotizadoMapsFrom(d.lines ?? [])))
      .catch(() => setCotizadoMaps(EMPTY_COTIZADO_MAPS));
  }, [proyectoId]);

  if (state.loading) return <Shell hint="Buscando el proyecto ligado…" />;
  if (!state.proyecto) {
    return <Shell hint="Esta oportunidad aún no tiene Proyecto en Monday — se crea cuando se GANA la oportunidad, y ahí vive el desglose de tallas." />;
  }
  const p = state.proyecto;
  return (
    <div style={{ marginTop: 20 }}>
      <ProyectoLinks proyecto={p} />
      {/* Proyecto NATIVO (Zona Efrain): las dos acciones del Google Sheet
          ("Crear archivo de tallas" / "Importar tallas a Monday") no aplican —
          ese proyecto no existe en Monday y el desglose se captura por boxes
          desde la Oportunidad. Se esconden para no mandar a nadie a un camino
          muerto (Efraín, 2026-08-18, hallazgo de la prueba de UI). */}
      <ProyectoActionBar
        proyecto={p}
        reload={state.reload}
        actions={isNativeId(Number(p.id)) ? ['tallas-confirmar'] : ['tallas-regenerar', 'tallas-confirmar', 'tallas-importar']}
      />
      <TallasGrid
        native={isNativeId(Number(p.id))}
        lineas={p.children ?? []}
        cotizadoMaps={cotizadoMaps}
        canEditCantidad={canEditCantidad}
        canReport={canEditCantidad}
        proyectoId={p.id}
        reload={state.reload}
      />
      <FileList label="Relaciones de tallas (PDF)" files={toR2Files(parseFiles(p.cols[P_TALLAS_PDF]?.text), oppId, 'tallas')} />
    </div>
  );
}
