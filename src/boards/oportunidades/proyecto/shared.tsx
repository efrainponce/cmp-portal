// Base común de la sección "Proyecto" (tabs Tallas, Órdenes de compra y
// Ejecución): los flujos de tallas/OC de cmp-tallas viven en el item Proyecto
// ligado a la oportunidad (Proyectos board_relation_mm0hf0y3), no en la
// Oportunidad. Botones espejo de los de Monday, gated por rol; las tallas
// importadas se muestran desde el mirror (proyectos_sub) — el objetivo es que
import { isNativeId } from '../../../../shared/nativeId';
// dejen de vivir solo en el Excel.
//
// Separado de las 3 secciones (TallasSection.tsx, OrdenesSection.tsx,
// EjecucionSection.tsx) para que cada una se pueda leer sin cargar las otras
// dos — antes las 3 vivían en un solo archivo de ~1200 líneas
// (ProyectoSection.tsx, que ahora es solo el barrel de re-exports).
import { useCallback, useEffect, useState } from 'react';
import { getProyecto, proyectoAction, type ItemDetailDTO, type ProyectoAction } from '../../../lib/api';
import { useMe } from '../../../lib/useMe';
import { ConfirmButton } from '../../../components/core/ConfirmButton';

// Proyectos (18395657594)
export const P_SHEET_LINK = 'link_mm1amwz8';     // Google Sheet de tallas
export const P_DRIVE_LINK = 'link_mm462saa';     // Carpeta Drive (visible Compras)
export const P_TALLAS_PDF = 'file_mm0hcrtz';     // PDFs relación de tallas (visible Compras)
export const P_OC_PDF = 'file_mm0hj9pn';         // PDFs órdenes de compra (visible Compras)
// OC/cotización/contrato firmado por el cliente (vendedor sube). En Monday se
// titula "OC/contrato/cotización firmada (oculto)" — es donde el equipo lo sube
// (ver worker/lib/portalFiles.ts PROYECTO_DOCUMENTO_COL, 2026-08-26).
export const P_OC_CLIENTE = 'file_mm33yv4p';
// A donde apuntaba el portal antes: solo lectura, para no esconder el documento
// de los proyectos que lo tienen ahí ("Cotización Firmada Institucion").
export const P_OC_CLIENTE_LEGADO = 'file_mm0hayh4';
export const P_METODO_PAGO = 'text_mm4cct6a';    // Método de pago (default del Proyecto, prellenado por tarjeta)
export const P_COND_PAGO = 'text_mm4cdyjb';      // Condiciones de pago (default del Proyecto, prellenado por tarjeta)

// Subelementos de Proyectos (18395657609)
export const S_PRODUCTO = 'text_mm0hs17x';
export const S_SKU = 'text_mm0hyrfs';
export const S_COLOR = 'text_mm0h4a1c';
export const S_TALLA = 'text_mm1antcb';
export const S_CANTIDAD = 'numeric_mm0hj2q4';
// Proveedor de la línea — visible solo compras/admin (shared/visibility.ts, grupo AC).
export const S_PROVEEDOR = 'board_relation_mm1cfgv5';
export const S_PROVEEDOR_RAZON = 'lookup_mm1d2y9b';
export const S_PROVEEDOR_CORREO = 'lookup_mm2145g';
export const S_ESTADO = 'color_mm0hqf79';
export const S_COSTO = 'numeric_mm1dj4fp';
export const S_DESCUENTO = 'numeric_mm1dmsaz';
export const S_MONEDA = 'text_mm1gdsvg';
export const S_ENTREGA_PROV = 'date_mm20xdtm';

// Estado del producto (color_mm0hqf79) — hex reales de shared/column-meta.gen.ts, no inventados.
export const ESTADO_PRODUCTO_COLORS: Record<string, string> = {
  'Con vendedor para entrega cliente': '#9d50dd',
  'En CMP para embellecer': '#74afcc',
  'En embellecimiento': '#5559df',
  'En CMP para entrega cliente': '#784bd1',
  'En produccion': '#a1e3f6',
  'Pendiente de Recolectar': '#c4c4c4',
  'Pendiente de Recoleccion': '#216edf',
  'Entregado': '#037f4c',
  'Incidencia/Retraso': '#df2f4a',
  'OC Proveedor enviada': '#a9bee8',
  'Pendiente OC al Prov': '#e484bd',
  'En tránsito': '#fdab3d',
  'ALMACEN CDMX': '#bb3354',
  'ALMACEN MERIDA': '#ff007f',
};

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
export function linkUrl(item: ItemDetailDTO, colId: string): string {
  const col = item.cols[colId];
  if (!col) return '';
  const v = col.value;
  if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') {
    return (v as { url: string }).url;
  }
  const m = (col.text ?? '').match(/https?:\/\/\S+/);
  return m ? m[0] : '';
}

/** La URL de Monday trae su propio id de asset justo antes del nombre
 * (`…/resources/<assetId>/<nombre>`). Se extrae porque el key de R2 lo lleva al
 * frente desde el 2026-08-25: sin él, dos archivos con el mismo nombre en la
 * misma categoría eran el mismo objeto (worker/lib/r2.ts). */
export function parseFiles(text?: string): { url: string; name: string; assetId?: string }[] {
  if (!text) return [];
  return text.split(',').map(s => s.trim()).filter(Boolean).map(url => ({
    url,
    name: decodeURIComponent(url.split('/').pop() || url),
    assetId: /\/resources\/(\d+)\//.exec(url)?.[1],
  }));
}

/** Reconstruye el key de R2 igual que DocumentacionTab.toR2Files — tallas/OC
 * viven en el Proyecto, así que el oppId no es directo (viene del lookup
 * inverso getProyectoOportunidad y puede tardar en resolver o venir null).
 *
 * Sin oppId el archivo cuelga del PROYECTO (`proyectos/<id>/…`,
 * worker/lib/r2.ts proyectoFileKey): es el caso normal de un proyecto hecho
 * desde cero, sin oportunidad (2026-08-26). Antes se dejaba el link de Monday
 * tal cual, que es un `protected_static` y pide sesión de Monday para abrirse
 * — la OC no la podía abrir nadie desde el portal. Sin ninguno de los dos ids
 * (el lookup todavía en vuelo) se deja el link del mirror, como antes. */
/** Categorías cuyo key lleva el assetId al frente (worker/lib/r2.ts): las que
 * suben PERSONAS, donde dos archivos distintos sí pueden llamarse igual (dos
 * fotos "IMG_0001.jpg"). Los documentos GENERADOS —cotización, tallas, OC— se
 * quedan sin prefijo a propósito: su nombre lleva folio, y volver a generarlos
 * con el mismo nombre es un reemplazo, no un archivo nuevo. */
function llevaAssetId(categoria: string): boolean {
  return categoria === 'inventario' || categoria === 'documento' || categoria.startsWith('logistica/');
}

export function toR2Files(
  files: { url: string; name: string; assetId?: string }[], oppId: string | null, categoria: string,
  proyectoId?: string | null,
): { url: string; name: string; assetId?: string }[] {
  const base = oppId ? `oportunidades/${oppId}` : proyectoId ? `proyectos/${proyectoId}` : null;
  if (!base) return files;
  const prefijo = (f: { assetId?: string }) => (llevaAssetId(categoria) && f.assetId ? `${f.assetId}-` : '');
  return files.map(f => ({
    ...f,
    url: `/api/files/${base}/${categoria}/${prefijo(f)}${encodeURIComponent(f.name)}`,
  }));
}

export interface ActionOutcome { kind: 'ok' | 'warn' | 'error'; text: string }

/** cmp-tallas devuelve `folio_orden`; el motor propio del portal, `folioOrden`. */
function foliosDe(res: Record<string, unknown>): string {
  const ordenes = Array.isArray(res.ordenes) ? res.ordenes as Record<string, unknown>[] : [];
  return ordenes.map(o => String(o.folio_orden ?? o.folioOrden ?? '')).filter(Boolean).join(', ');
}

export function describeResult(action: ProyectoAction, res: Record<string, unknown>): ActionOutcome {
  if (res.ok === true) {
    switch (action) {
      case 'tallas-regenerar': return { kind: 'ok', text: 'Archivo de tallas generado. El link aparece en unos segundos (Actualizar).' };
      case 'tallas-confirmar': return { kind: 'ok', text: `Tallas validadas (${String(res.validation ?? 'TODO CUADRA')}). PDF ${String(res.pdf_filename ?? '')} enviado a firma del vendedor.` };
      case 'tallas-importar': return { kind: 'ok', text: `Tallas importadas a Monday: ${String(res.talla_subitems ?? '?')} líneas + ${String(res.embell_subitems ?? 0)} embellecimientos.` };
      case 'generar-oc': {
        const folios = foliosDe(res);
        return { kind: 'ok', text: `Órdenes generadas y enviadas a firma${folios ? `: ${folios}` : ''}.` };
      }
      case 'generar-oc-portal': {
        const folios = foliosDe(res);
        return { kind: 'ok', text: `Orden generada por el portal${folios ? `: ${folios}` : ''}. Sin firma electrónica — se firma a mano sobre el PDF.` };
      }
      case 'generar-oc-portal-imagenes': {
        const folios = foliosDe(res);
        return { kind: 'ok', text: `Orden con imágenes generada${folios ? `: ${folios}` : ''}. La orden va primero y las fichas con foto como anexo. Se guardaron DOS copias del mismo folio: con costos y sin costos.` };
      }
    }
  }
  if (res.skipped) return { kind: 'warn', text: String(res.reason ?? 'No había nada que procesar.') };
  if (action === 'tallas-confirmar' && res.validation) {
    return { kind: 'warn', text: `El desglose no cuadra (${String(res.validation)}). Revisa el archivo de tallas y vuelve a intentar.` };
  }
  return { kind: 'error', text: String(res.reason ?? res.error ?? 'La acción no se pudo completar. Revisa el update en Monday.') };
}

export const OUTCOME_COLOR: Record<ActionOutcome['kind'], string> = {
  ok: 'var(--status-ganada)', warn: 'var(--status-esperando)', error: 'var(--status-perdida)',
};

/** Barra de acciones + resultado. `actions` decide qué botones mostrar. */
export function ProyectoActionBar({ proyecto, reload, actions }: {
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
  // Mismo criterio que el server (worker/lib/proyectoTallas.ts checkOcCliente):
  // cuenta la columna vigente o la de antes.
  const ocCliente = !!proyecto.cols[P_OC_CLIENTE]?.text || !!proyecto.cols[P_OC_CLIENTE_LEGADO]?.text;
  // Proyecto NATIVO (Zona Efrain): no existe en Monday, así que tampoco existe
  // el archivo de tallas de cmp-tallas — el desglose se captura por boxes desde
  // la Oportunidad. "Validar tallas" sí aplica (worker: confirmTallasNativeD1),
  // así que solo deja de exigir un Sheet que nunca va a haber (Efraín,
  // 2026-08-18: "escóndelo para que no confunda").
  const native = isNativeId(Number(proyecto.id));
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
            busyLabel="Validando… puede tardar unos minutos, no cierres esta pantalla"
            disabled={!canVendedor || !ocCliente || (!native && !sheetUrl)}
            title={!canVendedor ? 'Solo el vendedor valida las tallas' : !ocCliente ? 'Falta subir la orden de compra / cotización firmada / contrato del cliente (pestaña Documentación)' : (!native && !sheetUrl) ? 'Primero crea el archivo de tallas' : 'Valida el desglose y genera el PDF a firma'}
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
            label="Generar todas las OC pendientes (Monday)"
            confirmLabel="¿Generar? Se manda a firmas"
            busyLabel="Generando órdenes… puede tardar unos minutos, no cierres esta pantalla"
            variant="secondary"
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

export function ProyectoLinks({ proyecto }: { proyecto: ItemDetailDTO }) {
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

export function FileList({ label, files }: { label: string; files: { url: string; name: string }[] }) {
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

export function Shell({ hint }: { hint: string }) {
  return (
    <div style={{ marginTop: 16, font: 'var(--text-label)', color: 'var(--ink-quiet)' }}>{hint}</div>
  );
}
