// Shared full-tab detail drawer opened from every stage-filtered Oportunidades
// list (Oportunidades, Costeo, Validación Costeo, Documentación y Tallas,
// Órdenes de Compra, Logística) — same record, same tab set, per the design's
// "Board Tabs" component.
import { useEffect, useState } from 'react';
import { Button } from '../../components/core/Button';
import { IconBack } from '../../components/icons';
import { SyncIndicator } from '../../components/board/SyncIndicator';
import { useBoards, colForBoard, enviarCosteo, getItemDetail, refreshItem, type ItemDetailDTO } from '../../lib/api';
import { statusIndex } from '../../lib/statusValue';
import { stageAtOrAfter, type StageBoardKey } from '../../lib/dealStages';
import { BoardTabsBar, type DrawerTabKey } from './BoardTabsBar';
import { CotizacionTab } from './tabs/CotizacionTab';
import { EmbellecimientosTab } from './tabs/EmbellecimientosTab';
import { ActualizacionesTab } from './tabs/ActualizacionesTab';
import { NuevosProductosTab } from './tabs/NuevosProductosTab';
import { DocumentacionTab } from './tabs/DocumentacionTab';
import { TallasTab } from './tabs/TallasTab';
import { EmptyDocTab } from './tabs/EmptyDocTab';

interface Props {
  id: string;
  backLabel: string;
  defaultTab: string;
  onBack: () => void;
  /** Origin board — drives the Cotizaciones variant (costeo boards see cost breakdown). */
  boardKey?: StageBoardKey;
}

const COSTEO_VARIANT_BOARDS: StageBoardKey[] = ['costeo', 'validacion'];

export function OpportunityDrawer({ id, backLabel, defaultTab, onBack, boardKey }: Props) {
  const { boards } = useBoards();
  const subCols = colForBoard(boards, 'oportunidades_sub');
  const [item, setItem] = useState<ItemDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<DrawerTabKey>(defaultTab as DrawerTabKey);
  const [sending, setSending] = useState(false);
  const [costeoErrors, setCosteoErrors] = useState<string[] | null>(null);

  const load = () => {
    setError(null);
    getItemDetail('oportunidades', id)
      .then(({ item: it }) => setItem(it))
      .catch(() => setError('No se pudo cargar el detalle. Verifica tu acceso o que el servidor esté disponible.'));
  };

  useEffect(load, [id]);

  const onRefresh = async () => {
    setRefreshing(true);
    try { await refreshItem('oportunidades', id); } catch { /* offline demo: ignore */ }
    load();
    setRefreshing(false);
  };

  // Validaciones automáticas del lado del servidor: sin líneas, sin cantidad o
  // con color fuera de la lista del catálogo, la oportunidad NO pasa a costeo.
  const onEnviarCosteo = async () => {
    setSending(true);
    setCosteoErrors(null);
    try {
      const res = await enviarCosteo(id);
      if (res.ok) load();
      else setCosteoErrors(res.errors ?? ['No se pudo mandar a costeo.']);
    } catch {
      setCosteoErrors(['No se pudo mandar a costeo. Verifica tu conexión.']);
    } finally {
      setSending(false);
    }
  };

  if (error) return <div style={{ padding: 32, color: 'var(--ink-quiet)' }}>{error}</div>;
  if (!item) return <div style={{ padding: 32 }}>Cargando…</div>;

  const products = item.children ?? [];

  const stage = item.cols.deal_stage ? statusIndex(item.cols.deal_stage) : undefined;
  const showPostventa = stageAtOrAfter(stage, '9');
  const showProyectos = stageAtOrAfter(stage, '8');
  const activeTab = (tab === 'documentacion' || tab === 'tallas') && !showPostventa ? 'cotizacion'
    : (tab === 'ordenes' || tab === 'logistica') && !showProyectos ? 'cotizacion'
    : tab;
  const cotizacionVariant = boardKey && COSTEO_VARIANT_BOARDS.includes(boardKey) ? 'costeo' : 'venta';

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
            <Button variant="primary" onClick={sending ? undefined : onEnviarCosteo}>
              {sending ? 'Validando…' : 'Mandar a costeo'}
            </Button>
          )}
          <Button variant="secondary" onClick={onRefresh}>{refreshing ? 'Actualizando…' : 'Actualizar'}</Button>
        </div>
      </div>

      {costeoErrors && (
        <div style={{
          margin: '14px 32px 0', padding: '12px 16px', border: '1px solid var(--status-perdida)',
          borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)',
        }}>
          <div style={{ font: 'var(--text-label-strong)', color: 'var(--status-perdida)', marginBottom: 6 }}>
            No se puede mandar a costeo todavía:
          </div>
          {costeoErrors.map((e, i) => (
            <div key={i} style={{ font: 'var(--text-label)', color: 'var(--ink-secondary)', marginTop: 2 }}>• {e}</div>
          ))}
        </div>
      )}

      <BoardTabsBar active={activeTab} onChange={setTab} showPostventa={showPostventa} showProyectos={showProyectos} />

      {activeTab === 'actualizaciones' && <ActualizacionesTab slug="oportunidades" itemId={id} />}
      {activeTab === 'cotizacion' && <CotizacionTab subCols={subCols} products={products} variant={cotizacionVariant} />}
      {activeTab === 'embellecimientos' && <EmbellecimientosTab subCols={subCols} products={products} />}
      {activeTab === 'nuevosproductos' && <NuevosProductosTab />}
      {activeTab === 'documentacion' && <DocumentacionTab item={item} />}
      {activeTab === 'tallas' && <TallasTab subCols={subCols} products={products} />}
      {activeTab === 'ordenes' && (
        <EmptyDocTab
          title="Órdenes de compra a proveedores"
          subtitle="Cuando se mandan de CMP a los proveedores."
          uploadLabel="Subir orden de compra a proveedor"
          paymentRequest={{ slug: 'oportunidades', itemId: id }}
        />
      )}
      {activeTab === 'logistica' && (
        <EmptyDocTab
          title="Documentos de logística"
          subtitle="Guías de embarque, comprobantes de entrega y documentación de envío."
          uploadLabel="Subir documento de logística"
        />
      )}
    </div>
  );
}
