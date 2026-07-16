// Sección "Proyecto" compartida por las pestañas Tallas y Órdenes de compra:
// los flujos de tallas/OC de cmp-tallas viven en el item Proyecto ligado a la
// oportunidad (Proyectos board_relation_mm0hf0y3), no en la Oportunidad.
// Botones espejo de los de Monday, gated por rol; las tallas importadas se
// muestran desde el mirror (proyectos_sub) — el objetivo es que dejen de vivir
// solo en el Excel.
import { useCallback, useEffect, useState } from 'react';
import { getProyecto, proyectoAction, type ItemDetailDTO, type ItemDTO, type ProyectoAction } from '../../lib/api';
import { useMe } from '../../lib/useMe';
import { ConfirmButton } from '../../components/core/ConfirmButton';
import { MonoTag } from '../../components/core/Badges';

// Proyectos (18395657594)
const P_SHEET_LINK = 'link_mm1amwz8';     // Google Sheet de tallas
const P_DRIVE_LINK = 'link_mm462saa';     // Carpeta Drive (visible Compras)
const P_TALLAS_PDF = 'file_mm0hcrtz';     // PDFs relación de tallas (visible Compras)
const P_OC_PDF = 'file_mm0hj9pn';         // PDFs órdenes de compra (visible Compras)

// Subelementos de Proyectos (18395657609)
const S_PRODUCTO = 'text_mm0hs17x';
const S_SKU = 'text_mm0hyrfs';
const S_COLOR = 'text_mm0h4a1c';
const S_TALLA = 'text_mm1antcb';
const S_CANTIDAD = 'numeric_mm0hj2q4';

export interface ProyectoState {
  loading: boolean;
  proyecto: ItemDetailDTO | null;
  reload: () => void;
}

/** Carga el Proyecto ligado a la oportunidad (null si aún no existe). */
export function useProyecto(oppId: string, enabled: boolean): ProyectoState {
  const [proyecto, setProyecto] = useState<ItemDetailDTO | null>(null);
  const [loading, setLoading] = useState(enabled);

  const reload = useCallback(() => {
    if (!enabled) return;
    setLoading(true);
    getProyecto(oppId)
      .then(setProyecto)
      .catch(() => setProyecto(null))
      .finally(() => setLoading(false));
  }, [oppId, enabled]);

  useEffect(reload, [reload]);
  return { loading, proyecto, reload };
}

// Link columns llegan del serializer solo como texto "Etiqueta - https://…"
// (no están en PARSE_VALUE_TYPES) — se extrae la URL del texto.
function linkUrl(item: ItemDetailDTO, colId: string): string {
  const col = item.cols[colId];
  if (!col) return '';
  const v = col.value;
  if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') {
    return (v as { url: string }).url;
  }
  const m = (col.text ?? '').match(/https?:\/\/\S+/);
  return m ? m[0] : '';
}

function parseFiles(text?: string): { url: string; name: string }[] {
  if (!text) return [];
  return text.split(',').map(s => s.trim()).filter(Boolean).map(url => ({
    url,
    name: decodeURIComponent(url.split('/').pop() || url),
  }));
}

interface ActionOutcome { kind: 'ok' | 'warn' | 'error'; text: string }

function describeResult(action: ProyectoAction, res: Record<string, unknown>): ActionOutcome {
  if (res.ok === true) {
    switch (action) {
      case 'tallas-regenerar': return { kind: 'ok', text: 'Archivo de tallas generado. El link aparece en unos segundos (Actualizar).' };
      case 'tallas-confirmar': return { kind: 'ok', text: `Tallas validadas (${String(res.validation ?? 'TODO CUADRA')}). PDF ${String(res.pdf_filename ?? '')} enviado a firma del vendedor.` };
      case 'tallas-importar': return { kind: 'ok', text: `Tallas importadas a Monday: ${String(res.talla_subitems ?? '?')} líneas + ${String(res.embell_subitems ?? 0)} embellecimientos.` };
      case 'generar-oc': {
        const ordenes = Array.isArray(res.ordenes) ? res.ordenes as Record<string, unknown>[] : [];
        const folios = ordenes.map(o => String(o.folio_orden ?? '')).filter(Boolean).join(', ');
        return { kind: 'ok', text: `Órdenes generadas y enviadas a firma${folios ? `: ${folios}` : ''}.` };
      }
    }
  }
  if (res.skipped) return { kind: 'warn', text: String(res.reason ?? 'No había nada que procesar.') };
  if (action === 'tallas-confirmar' && res.validation) {
    return { kind: 'warn', text: `El desglose no cuadra (${String(res.validation)}). Revisa el archivo de tallas y vuelve a intentar.` };
  }
  return { kind: 'error', text: String(res.reason ?? res.error ?? 'La acción no se pudo completar. Revisa el update en Monday.') };
}

const OUTCOME_COLOR: Record<ActionOutcome['kind'], string> = {
  ok: 'var(--status-ganada)', warn: 'var(--status-esperando)', error: 'var(--status-perdida)',
};

/** Barra de acciones + resultado. `actions` decide qué botones mostrar. */
function ProyectoActionBar({ proyecto, reload, actions }: {
  proyecto: ItemDetailDTO; reload: () => void; actions: ProyectoAction[];
}) {
  const me = useMe();
  const role = me?.role ?? 'vendedor';
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);

  const run = (action: ProyectoAction) => async () => {
    setOutcome(null);
    try {
      const res = await proyectoAction(proyecto.id, action);
      setOutcome(describeResult(action, res));
      reload();
    } catch {
      setOutcome({ kind: 'error', text: 'No se pudo ejecutar la acción. Verifica tu conexión.' });
    }
  };

  const sheetUrl = linkUrl(proyecto, P_SHEET_LINK);
  const canVendedor = role === 'vendedor' || role === 'admin';
  const canCompras = role === 'compras' || role === 'admin';

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {actions.includes('tallas-regenerar') && (
          <ConfirmButton
            label={sheetUrl ? 'Regenerar archivo de tallas' : 'Crear archivo de tallas'}
            confirmLabel="¿Regenerar? (conserva cantidades)"
            busyLabel="Generando archivo…"
            variant="secondary"
            onConfirm={run('tallas-regenerar')}
          />
        )}
        {actions.includes('tallas-confirmar') && (
          <ConfirmButton
            label="Validar tallas (vendedor)"
            confirmLabel="¿Validar y mandar a firma?"
            busyLabel="Validando…"
            disabled={!canVendedor || !sheetUrl}
            title={!canVendedor ? 'Solo el vendedor valida las tallas' : !sheetUrl ? 'Primero crea el archivo de tallas' : 'Valida el desglose y genera el PDF a firma'}
            onConfirm={run('tallas-confirmar')}
          />
        )}
        {actions.includes('tallas-importar') && (
          <ConfirmButton
            label="Importar tallas a Monday (compras)"
            confirmLabel="¿Importar? Reemplaza las líneas del proyecto"
            busyLabel="Importando…"
            variant="secondary"
            disabled={!canCompras || !sheetUrl}
            title={!canCompras ? 'Solo Compras importa las tallas' : !sheetUrl ? 'Primero crea el archivo de tallas' : 'Borra y recrea los subitems del proyecto desde el archivo'}
            onConfirm={run('tallas-importar')}
          />
        )}
        {actions.includes('generar-oc') && (
          <ConfirmButton
            label="Generar OC por proveedor"
            confirmLabel="¿Generar? Se manda a firmas"
            busyLabel="Generando órdenes…"
            disabled={!canCompras}
            title={!canCompras ? 'Solo Compras genera órdenes de compra' : 'Una OC por proveedor + firmas Elaborado→Revisado→Autorizado'}
            onConfirm={run('generar-oc')}
          />
        )}
      </div>
      {outcome && (
        <div style={{
          marginTop: 10, padding: '10px 14px', borderRadius: 'var(--radius-lg)',
          border: `1px solid ${OUTCOME_COLOR[outcome.kind]}`, background: 'var(--bg-raised)',
          font: 'var(--text-label)', color: 'var(--ink-secondary)',
        }}>
          {outcome.text}
        </div>
      )}
    </div>
  );
}

function ProyectoLinks({ proyecto }: { proyecto: ItemDetailDTO }) {
  const sheetUrl = linkUrl(proyecto, P_SHEET_LINK);
  const driveUrl = linkUrl(proyecto, P_DRIVE_LINK);
  if (!sheetUrl && !driveUrl) return null;
  const style = { font: 'var(--text-label-strong)', color: 'var(--accent)', textDecoration: 'none' } as const;
  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
      {sheetUrl && <a href={sheetUrl} target="_blank" rel="noreferrer" style={style}>Abrir archivo de tallas ↗</a>}
      {driveUrl && <a href={driveUrl} target="_blank" rel="noreferrer" style={style}>Carpeta Drive ↗</a>}
    </div>
  );
}

function FileList({ label, files }: { label: string; files: { url: string; name: string }[] }) {
  if (files.length === 0) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden' }}>
        {files.map((f, i) => (
          <a key={i} href={f.url} target="_blank" rel="noreferrer"
            style={{ padding: '10px 12px', borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', background: '#fff', textDecoration: 'none', font: 'var(--text-body-strong)', color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {f.name}
          </a>
        ))}
      </div>
    </div>
  );
}

/** Grid de tallas importadas (subitems del Proyecto) agrupado por producto. */
function TallasGrid({ lineas }: { lineas: ItemDTO[] }) {
  if (lineas.length === 0) {
    return (
      <div style={{ marginTop: 14, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>
        Aún no hay tallas importadas en Monday — captura el desglose en el archivo de tallas y pide a Compras importarlo.
      </div>
    );
  }

  const grupos = new Map<string, ItemDTO[]>();
  for (const l of lineas) {
    const key = l.cols[S_PRODUCTO]?.text || l.name;
    grupos.set(key, [...(grupos.get(key) ?? []), l]);
  }

  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[...grupos.entries()].map(([producto, rows]) => (
        <div key={producto} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', padding: 14, background: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ font: 'var(--text-body-strong)', color: 'var(--ink)' }}>{producto}</div>
            {rows[0].cols[S_SKU]?.text && <MonoTag>{rows[0].cols[S_SKU].text}</MonoTag>}
            <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)' }}>
              Total: {rows.reduce((s, r) => s + (Number(r.cols[S_CANTIDAD]?.text?.replace(/,/g, '')) || 0), 0)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {rows.map(r => (
              <div key={r.id} style={{
                border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)',
                padding: '6px 10px', background: 'var(--bg)', font: 'var(--text-label)', color: 'var(--ink-secondary)',
              }}>
                <span style={{ font: 'var(--text-label-strong)', color: 'var(--ink)' }}>{r.cols[S_TALLA]?.text || '—'}</span>
                {' · '}{r.cols[S_CANTIDAD]?.text || '0'}
                {r.cols[S_COLOR]?.text ? ` · ${r.cols[S_COLOR].text}` : ''}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProyectoTallasSection({ state }: { state: ProyectoState }) {
  if (state.loading) return <Shell hint="Buscando el proyecto ligado…" />;
  if (!state.proyecto) {
    return <Shell hint="Esta oportunidad aún no tiene Proyecto en Monday — se crea cuando se GANA la oportunidad, y ahí vive el desglose de tallas." />;
  }
  const p = state.proyecto;
  return (
    <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
      <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)', marginBottom: 2 }}>Proyecto {p.name}</div>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 10 }}>
        Desglose de tallas del proyecto — mismo flujo que los botones de Monday.
      </div>
      <ProyectoLinks proyecto={p} />
      <ProyectoActionBar proyecto={p} reload={state.reload} actions={['tallas-regenerar', 'tallas-confirmar', 'tallas-importar']} />
      <TallasGrid lineas={p.children ?? []} />
      <FileList label="Relaciones de tallas (PDF)" files={parseFiles(p.cols[P_TALLAS_PDF]?.text)} />
    </div>
  );
}

export function ProyectoOrdenesSection({ state }: { state: ProyectoState }) {
  if (state.loading) return <Shell hint="Buscando el proyecto ligado…" />;
  if (!state.proyecto) {
    return <Shell hint="Esta oportunidad aún no tiene Proyecto en Monday — se crea al GANAR la oportunidad; las órdenes de compra se generan desde el proyecto." />;
  }
  const p = state.proyecto;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 10 }}>
        Proyecto {p.name} — una OC por proveedor, con firmas Elaborado → Revisado → Autorizado (DocuSeal).
      </div>
      <ProyectoActionBar proyecto={p} reload={state.reload} actions={['generar-oc']} />
      <FileList label="Órdenes de compra (PDF)" files={parseFiles(p.cols[P_OC_PDF]?.text)} />
    </div>
  );
}

function Shell({ hint }: { hint: string }) {
  return (
    <div style={{ marginTop: 16, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>{hint}</div>
  );
}
