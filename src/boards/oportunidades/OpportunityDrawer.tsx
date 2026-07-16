// Shared full-tab detail drawer opened from every stage-filtered Oportunidades
// list (Oportunidades, Costeo, Validación Costeo, Documentación y Tallas,
// Órdenes de Compra, Logística) — same record, same tab set, per the design's
// "Board Tabs" component. Acciones por etapa = los mismos flujos de cmp-tallas
// que los botones de Monday (docs/cmp-tallas-endpoint-map.md): los botones se
// deshabilitan hasta que todo está listo y los rechazos se muestran legibles.
import { useEffect, useState } from 'react';
import { Button } from '../../components/core/Button';
import { ConfirmButton } from '../../components/core/ConfirmButton';
import { IconBack, IconLink } from '../../components/icons';
import { SyncIndicator } from '../../components/board/SyncIndicator';
import {
  useBoards, colForBoard, checkCosteo, enviarCosteo, generarCotizacion, getItemDetail, getVersiones,
  refreshItem, type ItemDetailDTO, type QuoteVersionDTO,
} from '../../lib/api';
import { statusIndex } from '../../lib/statusValue';
import { stageAtOrAfter, type StageBoardKey } from '../../lib/dealStages';
import { BoardTabsBar, type DrawerTabKey } from './BoardTabsBar';
import { CotizacionTab } from './tabs/CotizacionTab';
import { NuevaVersionForm } from './tabs/NuevaVersionForm';
import { EmbellecimientosTab } from './tabs/EmbellecimientosTab';
import { ActualizacionesTab } from './tabs/ActualizacionesTab';
import { NuevosProductosTab } from './tabs/NuevosProductosTab';
import { DocumentacionTab } from './tabs/DocumentacionTab';
import { TallasTab } from './tabs/TallasTab';
import { EmptyDocTab } from './tabs/EmptyDocTab';
import { useProyecto, ProyectoOrdenesSection } from './ProyectoSection';
import { PaymentRequestButton } from '../../components/board/PaymentRequestButton';

interface Props {
  id: string;
  backLabel: string;
  defaultTab: string;
  onBack: () => void;
  /** Origin board — drives the Cotizaciones variant (costeo boards see cost breakdown). */
  boardKey?: StageBoardKey;
}

const COSTEO_VARIANT_BOARDS: StageBoardKey[] = ['costeo', 'validacion'];
const PRECIO_COL = 'numeric_mkzneg3d';   // Precio de Venta C/U (subitems)

// SWR de sesión: al reabrir una oportunidad ya visitada, el drawer pinta al
// instante desde este cache y el fetch fresco lo corrige en background. Vive a
// nivel módulo (sobrevive mount/unmount del drawer, muere con el reload).
const detailCache = new Map<string, ItemDetailDTO>();
const versionsCache = new Map<string, QuoteVersionDTO[]>();

interface Notice { kind: 'ok' | 'error'; title: string; lines: string[] }

export function OpportunityDrawer({ id, backLabel, defaultTab, onBack, boardKey }: Props) {
  const { boards } = useBoards();
  const subCols = colForBoard(boards, 'oportunidades_sub');
  const [item, setItem] = useState<ItemDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<DrawerTabKey>(defaultTab as DrawerTabKey);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Pre-chequeo de costeo (solo etapa 4): null = cargando; deshabilita el botón.
  const [costeoReady, setCosteoReady] = useState<{ ok: boolean; errors?: string[] } | null>(null);
  const [versions, setVersions] = useState<QuoteVersionDTO[]>([]);
  const [showNuevaVersion, setShowNuevaVersion] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const load = () => {
    setError(null);
    getItemDetail('oportunidades', id)
      .then(({ item: it }) => { detailCache.set(id, it); setItem(it); })
      .catch(() => setError('No se pudo cargar el detalle. Verifica tu acceso o que el servidor esté disponible.'));
  };
  const loadVersions = () => {
    getVersiones(id)
      .then((v) => { versionsCache.set(id, v); setVersions(v); })
      .catch(() => setVersions([]));
  };

  useEffect(() => {
    // Pinta primero lo cacheado (o limpia si es una oportunidad nueva) y
    // refresca en background — apertura instantánea en re-visitas.
    setItem(detailCache.get(id) ?? null);
    setVersions(versionsCache.get(id) ?? []);
    load();
    loadVersions();
  }, [id]);

  const stage = item?.cols.deal_stage ? statusIndex(item.cols.deal_stage) : undefined;

  // Evitar que den click: el check corre al abrir (y tras refrescar) y el botón
  // queda deshabilitado con la lista de pendientes visible.
  useEffect(() => {
    if (!item || stage !== '4') { setCosteoReady(null); return; }
    let cancelled = false;
    checkCosteo(id)
      .then(r => { if (!cancelled) setCosteoReady(r); })
      .catch(() => { if (!cancelled) setCosteoReady({ ok: true }); }); // el server re-valida al enviar
    return () => { cancelled = true; };
  }, [id, stage, item?.syncedAt]);

  const showPostventa = stageAtOrAfter(stage, '9');
  const proyecto = useProyecto(id, !!item && showPostventa);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await refreshItem('oportunidades', id); } catch { /* offline demo: ignore */ }
    load();
    proyecto.reload();
    setRefreshing(false);
  };

  const onCopyLink = async () => {
    const url = `${window.location.origin}/${boardKey ?? 'oportunidades'}/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch { /* clipboard no disponible (http o sin permiso) */ }
  };

  const onEnviarCosteo = async () => {
    setNotice(null);
    try {
      const res = await enviarCosteo(id);
      if (res.ok) {
        setNotice({ kind: 'ok', title: 'Solicitud de costeo enviada', lines: [res.folio ? `Se generó ${res.folio} y la etapa pasó a "En costeo".` : 'La etapa pasó a "En costeo".'] });
        load();
      } else {
        setNotice({ kind: 'error', title: 'No se puede mandar a costeo todavía:', lines: res.errors ?? ['No se pudo mandar a costeo.'] });
      }
    } catch {
      setNotice({ kind: 'error', title: 'No se puede mandar a costeo todavía:', lines: ['No se pudo mandar a costeo. Verifica tu conexión.'] });
    }
  };

  const onGenerarCotizacion = async () => {
    setNotice(null);
    try {
      const res = await generarCotizacion(id);
      if (res.ok && !res.skipped) {
        setNotice({
          kind: 'ok', title: 'Cotización generada',
          lines: [`${String(res.folio_cotizacion ?? '')} · total $${Number(res.total ?? 0).toLocaleString()} — enviada a firma del vendedor.`],
        });
        load();
        loadVersions();
      } else {
        setNotice({ kind: 'error', title: 'No se generó la cotización:', lines: [String(res.reason ?? 'Revisa el update en Monday.')] });
      }
    } catch {
      setNotice({ kind: 'error', title: 'No se generó la cotización:', lines: ['Verifica tu conexión.'] });
    }
  };

  if (error) return <div style={{ padding: 32, color: 'var(--ink-quiet)' }}>{error}</div>;
  if (!item) return <div style={{ padding: 32 }}>Cargando…</div>;

  const products = item.children ?? [];

  const showProyectos = stageAtOrAfter(stage, '8');
  const activeTab = (tab === 'documentacion' || tab === 'tallas') && !showPostventa ? 'cotizacion'
    : (tab === 'ordenes' || tab === 'logistica') && !showProyectos ? 'cotizacion'
    : tab;
  const cotizacionVariant = boardKey && COSTEO_VARIANT_BOARDS.includes(boardKey) ? 'costeo' : 'venta';

  // Generar cotización (etapa 7): cmp-tallas la omite si ningún producto tiene
  // precio — mejor deshabilitar el botón desde aquí con la razón visible.
  const hasPrecio = products.some(p => (Number((p.cols[PRECIO_COL]?.text ?? '').replace(/,/g, '')) || 0) > 0);
  const costeoPending = stage === '4' && costeoReady !== null && !costeoReady.ok;

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <div style={{ padding: '20px 32px 0' }}>
        <div onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', color: 'var(--ink-secondary)', font: 'var(--text-label-strong)' }}>
          <IconBack /> {backLabel}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 32px 20px', borderBottom: '1px solid var(--border)' }}>
        <div>
          <div style={{ font: 'var(--text-subtitle)', color: 'var(--ink)' }}>{item.name}</div>
          <SyncIndicator syncedAt={item.syncedAt} pending={item.pendingWrite ? 1 : 0} style={{ marginTop: 4 }} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {stage === '4' && (
            <ConfirmButton
              label="Mandar a costeo"
              confirmLabel="¿Enviar solicitud de costeo?"
              busyLabel="Validando y generando PDF…"
              disabled={costeoReady === null || !costeoReady.ok}
              title={costeoReady === null ? 'Verificando requisitos…' : !costeoReady.ok ? 'Faltan requisitos — revisa la lista abajo' : 'Genera el PDF de solicitud y pasa a "En costeo"'}
              onConfirm={onEnviarCosteo}
            />
          )}
          {stage === '7' && (
            <ConfirmButton
              label="Generar cotización"
              confirmLabel="¿Generar y mandar a firma?"
              busyLabel="Generando cotización…"
              disabled={!hasPrecio}
              title={hasPrecio ? 'PDFs con y sin precio + firma del vendedor (DocuSeal)' : 'Ningún producto tiene Precio de Venta — captúralo antes de cotizar'}
              onConfirm={onGenerarCotizacion}
            />
          )}
          <Button variant="secondary" onClick={onCopyLink}>
            <IconLink /> {linkCopied ? 'Copiado' : 'Copiar link'}
          </Button>
          <Button variant="secondary" onClick={onRefresh}>{refreshing ? 'Actualizando…' : 'Actualizar'}</Button>
        </div>
      </div>

      {costeoPending && !notice && (
        <div style={{
          margin: '14px 32px 0', padding: '12px 16px', border: '1px solid var(--status-esperando)',
          borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)',
        }}>
          <div style={{ font: 'var(--text-label-strong)', color: 'var(--status-esperando)', marginBottom: 6 }}>
            Para mandar a costeo falta:
          </div>
          {(costeoReady?.errors ?? []).map((e, i) => (
            <div key={i} style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', marginTop: 2 }}>• {e}</div>
          ))}
        </div>
      )}

      {notice && (
        <div style={{
          margin: '14px 32px 0', padding: '12px 16px',
          border: `1px solid ${notice.kind === 'ok' ? 'var(--status-ganada)' : 'var(--status-perdida)'}`,
          borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)',
        }}>
          <div style={{ font: 'var(--text-label-strong)', color: notice.kind === 'ok' ? 'var(--status-ganada)' : 'var(--status-perdida)', marginBottom: 6 }}>
            {notice.title}
          </div>
          {notice.lines.map((e, i) => (
            <div key={i} style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', marginTop: 2 }}>• {e}</div>
          ))}
        </div>
      )}

      <BoardTabsBar active={activeTab} onChange={setTab} showPostventa={showPostventa} showProyectos={showProyectos} />

      {activeTab === 'actualizaciones' && <ActualizacionesTab slug="oportunidades" itemId={id} />}
      {activeTab === 'cotizacion' && (
        <CotizacionTab
          subCols={subCols} products={products} variant={cotizacionVariant} onSaved={load} versions={versions}
          editable={stage !== '1' && stage !== '2'}
          onNuevaVersion={stage !== '1' && stage !== '2' && stage !== '4' ? () => setShowNuevaVersion(true) : undefined}
          stage={stage}
          oppId={id}
        />
      )}
      {activeTab === 'embellecimientos' && (
        <EmbellecimientosTab
          subCols={subCols} products={products} versions={versions}
          onNuevaVersion={stage !== '1' && stage !== '2' && stage !== '4' ? () => setShowNuevaVersion(true) : undefined}
        />
      )}
      {activeTab === 'nuevosproductos' && <NuevosProductosTab />}
      {activeTab === 'documentacion' && <DocumentacionTab item={item} />}
      {activeTab === 'tallas' && <TallasTab subCols={subCols} products={products} proyecto={showPostventa ? proyecto : undefined} />}
      {activeTab === 'ordenes' && (
        <div style={{ padding: '24px 32px 40px', maxWidth: 920, width: '100%', boxSizing: 'border-box' }}>
          <div style={{ font: 'var(--text-small-strong)', color: 'var(--ink)', marginBottom: 4 }}>Órdenes de compra a proveedores</div>
          <div style={{ font: 'var(--text-caption)', color: 'var(--ink-tertiary)', marginBottom: 10 }}>Cuando se mandan de CMP a los proveedores.</div>
          <PaymentRequestButton slug="oportunidades" itemId={id} kind="proveedor" />
          <ProyectoOrdenesSection state={proyecto} />
        </div>
      )}
      {activeTab === 'logistica' && (
        <EmptyDocTab
          title="Documentos de logística"
          subtitle="Guías de embarque, comprobantes de entrega y documentación de envío."
          uploadLabel="Subir documento de logística"
        />
      )}

      {showNuevaVersion && (
        <NuevaVersionForm
          itemId={id}
          currentProducts={versions.find((v) => v.status === 'vigente')?.products ?? []}
          onClose={() => setShowNuevaVersion(false)}
          onSaved={(label, costeo) => {
            setShowNuevaVersion(false);
            if (costeo?.ok) {
              setNotice({
                kind: 'ok', title: 'Nueva versión guardada y mandada a costeo',
                lines: [`${label}${costeo.folio ? ` — ${costeo.folio}` : ''} — la etapa regresó a "En costeo".`],
              });
            } else if (costeo && !costeo.ok) {
              setNotice({
                kind: 'error', title: `${label} guardada, pero no se pudo reenviar a costeo:`,
                lines: costeo.errors ?? ['Avísale a Compras manualmente.'],
              });
            } else {
              setNotice({ kind: 'ok', title: 'Nueva versión guardada', lines: [`${label} — se archivó la anterior y se actualizó Monday.`] });
            }
            load();
            loadVersions();
          }}
        />
      )}
    </div>
  );
}
